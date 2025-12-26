// Recurring Billing Job for Paystack Subscriptions
// Run daily via cron or scheduled task manager

import { db } from '../db/client.js'
import { chargeAuthorization } from '../services/paystack.js'
import { calculateServiceFee, type FeeMode } from '../services/fees.js'
import { decryptAuthorizationCode, encryptAuthorizationCode } from '../utils/encryption.js'
import { acquireLock, releaseLock } from '../services/lock.js'
import {
  scheduleSubscriptionRenewalReminders,
  schedulePaymentFailedReminder,
  schedulePastDueReminder,
} from './reminders.js'
import { getReportingCurrencyData } from '../services/fx.js'

// Configuration
const MAX_RETRY_ATTEMPTS = 3
const RETRY_DELAYS_MS = [0, 60 * 60 * 1000, 24 * 60 * 60 * 1000] // Immediate, 1 hour, 24 hours
const GRACE_PERIOD_DAYS = 3 // Days before marking as past_due after all retries fail

/**
 * Add months to a date without day overflow
 * Per Paystack docs: subscriptions created 29th-31st bill on 28th of subsequent months
 */
function addMonthSafe(date: Date, months: number): Date {
  const result = new Date(date)
  const targetMonth = result.getMonth() + months
  result.setMonth(targetMonth)

  // Check if day overflowed to next month (e.g., Jan 31 + 1 month = March 2/3)
  // If so, set to last day of the intended month
  const expectedMonth = (date.getMonth() + months) % 12
  if (result.getMonth() !== expectedMonth) {
    // Overflow occurred - set to last day of previous month (day 0 of next month)
    result.setDate(0)
  }

  // Per Paystack: for days 29-31, cap at 28th for consistent billing
  if (date.getDate() >= 29 && result.getDate() > 28) {
    result.setDate(28)
  }

  return result
}

export interface BillingResult {
  processed: number
  succeeded: number
  failed: number
  skipped: number
  errors: Array<{ subscriptionId: string; error: string }>
}

// Batch size for processing subscriptions (prevents memory issues at scale)
const BILLING_BATCH_SIZE = 100

/**
 * Process recurring billing for Paystack subscriptions
 * Should be run daily, ideally at 00:00 UTC
 * Uses cursor-based pagination to handle large volumes
 */
export async function processRecurringBilling(): Promise<BillingResult> {
  const result: BillingResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  }

  const now = new Date()
  let cursor: string | undefined
  let totalFound = 0

  // Process subscriptions in batches using cursor-based pagination
  while (true) {
    // Find subscriptions due for renewal
    // IMPORTANT: Only renew subscriptions that haven't been canceled
    const subscriptions = await db.subscription.findMany({
      where: {
        status: 'active',
        interval: 'month',
        currentPeriodEnd: { lte: now },
        paystackAuthorizationCode: { not: null },
        cancelAtPeriodEnd: false, // Don't renew subscriptions pending cancellation
      },
      include: {
        creator: {
          include: { profile: true },
        },
        subscriber: true,
      },
      take: BILLING_BATCH_SIZE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
    })

    if (subscriptions.length === 0) break

    totalFound += subscriptions.length
    cursor = subscriptions[subscriptions.length - 1].id

    console.log(`[billing] Processing batch of ${subscriptions.length} subscriptions (total found: ${totalFound})`)

    for (const sub of subscriptions) {
    result.processed++

    // DISTRIBUTED LOCK: Prevent concurrent processing of same subscription
    // IMPORTANT: Use same lock key pattern as webhook handler to prevent race conditions
    // where both billing job and webhook could charge the same subscription
    // Webhook uses: `sub:${subscriberId}:${creatorId}:${interval}`
    const lockKey = `sub:${sub.subscriberId}:${sub.creatorId}:${sub.interval}`
    const lockToken = await acquireLock(lockKey, 60000) // 60 second TTL

    if (!lockToken) {
      result.skipped++
      console.log(`[billing] Skipping sub ${sub.id}: lock not acquired (another process handling)`)
      continue
    }

    try {
      // Skip if no authorization code
      if (!sub.paystackAuthorizationCode) {
        result.skipped++
        console.log(`[billing] Skipping sub ${sub.id}: missing auth code`)
        continue
      }

      // Skip if no subaccount (required for Paystack auto-split)
      if (!sub.creator?.profile?.paystackSubaccountCode) {
        result.skipped++
        console.log(`[billing] Skipping sub ${sub.id}: missing subaccount code`)
        continue
      }

      // Check retry count from metadata or create tracking
      let retryAttempt = 0

      // Check if we have a failed payment record for current period
      const lastFailedPayment = await db.payment.findFirst({
        where: {
          subscriptionId: sub.id,
          status: 'failed',
          createdAt: { gte: sub.currentPeriodEnd || now },
        },
        orderBy: { createdAt: 'desc' },
      })

      if (lastFailedPayment) {
        // Count previous attempts
        const failedAttempts = await db.payment.count({
          where: {
            subscriptionId: sub.id,
            status: 'failed',
            createdAt: { gte: sub.currentPeriodEnd || now },
          },
        })
        retryAttempt = failedAttempts

        // Check if we've exceeded max retries
        if (retryAttempt >= MAX_RETRY_ATTEMPTS) {
          // Mark as past_due after grace period
          const gracePeriodEnd = new Date(sub.currentPeriodEnd || now)
          gracePeriodEnd.setDate(gracePeriodEnd.getDate() + GRACE_PERIOD_DAYS)

          if (now >= gracePeriodEnd) {
            await db.subscription.update({
              where: { id: sub.id },
              data: { status: 'past_due' },
            })

            // Schedule past due notification (fire and forget)
            schedulePastDueReminder(sub.id).catch(err =>
              console.error(`[billing] Failed to schedule past due reminder for ${sub.id}:`, err.message)
            )

            result.failed++
            console.log(`[billing] Sub ${sub.id} marked past_due after ${MAX_RETRY_ATTEMPTS} failed attempts`)
            continue
          }
        }
      }

      // Generate deterministic reference for idempotency
      // If we retry the same billing cycle, Paystack will reject the duplicate
      const billingMonth = (sub.currentPeriodEnd || now).toISOString().slice(0, 7) // YYYY-MM
      const reference = `REC-${sub.id.slice(0, 8)}-${billingMonth.replace('-', '')}${retryAttempt > 0 ? `-R${retryAttempt}` : ''}`

      // Calculate fees using current fee model
      // Subaccount percentage_charge handles the actual split
      const creatorPurpose = sub.creator.profile.purpose
      const subscriptionFeeMode = (sub.feeMode || sub.creator.profile.feeMode) as FeeMode
      const feeCalc = calculateServiceFee(sub.amount, sub.currency, creatorPurpose, subscriptionFeeMode)
      const grossCents = feeCalc.grossCents // Total to charge subscriber
      const feeCents = feeCalc.feeCents
      const netCents = feeCalc.netCents // What creator receives (tracked for records)
      const feeModel = feeCalc.feeModel
      const feeEffectiveRate = feeCalc.effectiveRate
      const feeWasCapped = false

      // SECURITY: Decrypt authorization code before use
      const authCode = decryptAuthorizationCode(sub.paystackAuthorizationCode)
      if (!authCode) {
        result.skipped++
        console.error(`[billing] Skipping sub ${sub.id}: failed to decrypt authorization code`)
        continue
      }

      // Charge subscriber with subaccount split
      // Paystack automatically splits based on subaccount's percentage_charge
      const chargeResult = await chargeAuthorization({
        authorizationCode: authCode,
        email: sub.subscriber.email,
        amount: grossCents,
        currency: sub.currency,
        subaccountCode: sub.creator.profile.paystackSubaccountCode!, // Split to creator
        metadata: {
          subscriptionId: sub.id,
          creatorId: sub.creatorId,
          subscriberId: sub.subscriberId,
          interval: 'month',
          isRecurring: true,
          feeModel,
          creatorAmount: netCents,
          serviceFee: feeCents,
        },
        reference,
      })

      // Update subscription period and capture any new authorization code
      const newPeriodEnd = addMonthSafe(sub.currentPeriodEnd || now, 1)

      await db.subscription.update({
        where: { id: sub.id },
        data: {
          currentPeriodEnd: newPeriodEnd,
          ltvCents: { increment: netCents }, // LTV is creator's earnings
          // Update authorization code if Paystack rotated it (encrypt at rest)
          paystackAuthorizationCode: chargeResult.authorization?.authorization_code
            ? encryptAuthorizationCode(chargeResult.authorization.authorization_code)
            : sub.paystackAuthorizationCode,
        },
      })

      // Create successful payment record
      // Use paid_at from Paystack response if available, otherwise current time
      const paidAt = chargeResult.paid_at ? new Date(chargeResult.paid_at) : new Date()

      // Get reporting currency data (USD conversion) for admin dashboard
      const reportingData = await getReportingCurrencyData(grossCents, feeCents, netCents, sub.currency)

      await db.payment.create({
        data: {
          subscriptionId: sub.id,
          creatorId: sub.creatorId,
          subscriberId: sub.subscriberId,
          grossCents,
          amountCents: grossCents || sub.amount,
          currency: sub.currency,
          feeCents,
          netCents,
          feeModel,
          feeEffectiveRate,
          feeWasCapped,
          type: 'recurring',
          status: 'succeeded',
          occurredAt: paidAt,
          paystackEventId: chargeResult.id?.toString(),
          paystackTransactionRef: reference,
          // Reporting currency fields (USD normalized)
          ...reportingData,
        },
      })

      // Note: Creator payout is handled automatically by Paystack subaccount split
      // No manual transfer needed - Paystack sends creator's share directly on T+1

      // Create activity log
      await db.activity.create({
        data: {
          userId: sub.creatorId,
          type: 'payment_received',
          payload: {
            subscriptionId: sub.id,
            amount: sub.amount,
            currency: sub.currency,
            provider: 'paystack',
            isRecurring: true,
          },
        },
      })

      result.succeeded++
      console.log(`[billing] Sub ${sub.id} charged successfully: ${reference}`)

      // Schedule reminders for next renewal (fire and forget)
      scheduleSubscriptionRenewalReminders(sub.id).catch(err =>
        console.error(`[billing] Failed to schedule renewal reminders for ${sub.id}:`, err.message)
      )
    } catch (error: any) {
      // Create failed payment record for retry tracking
      await db.payment.create({
        data: {
          subscriptionId: sub.id,
          creatorId: sub.creatorId,
          subscriberId: sub.subscriberId,
          amountCents: sub.amount,
          currency: sub.currency,
          feeCents: 0,
          netCents: 0,
          type: 'recurring',
          status: 'failed',
          occurredAt: new Date(),
        },
      })

      // Schedule payment failed notification (fire and forget)
      // Use 24h as default retry interval
      const nextRetryDate = new Date(Date.now() + 24 * 60 * 60 * 1000)
      schedulePaymentFailedReminder(sub.id, nextRetryDate).catch(err =>
        console.error(`[billing] Failed to schedule payment failed reminder for ${sub.id}:`, err.message)
      )

      result.errors.push({
        subscriptionId: sub.id,
        error: error.message || 'Unknown error',
      })

      // Log without PII
      console.error(`[billing] Sub ${sub.id} charge failed:`, error.message)
      result.failed++
    } finally {
      // Always release the lock (with ownership token)
      await releaseLock(lockKey, lockToken)
    }
  }
  } // End of while (true) pagination loop

  console.log(`[billing] Complete: ${result.succeeded} succeeded, ${result.failed} failed, ${result.skipped} skipped`)

  return result
}

/**
 * Retry failed charges with exponential backoff
 * Run this job more frequently (hourly) to process retries
 */
export async function processRetries(): Promise<BillingResult> {
  const result: BillingResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  }

  const now = new Date()

  // Find subscriptions with recent failed charges that are due for retry
  const failedPayments = await db.payment.findMany({
    where: {
      status: 'failed',
      type: 'recurring',
      createdAt: {
        gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
      },
    },
    include: {
      subscription: {
        include: {
          creator: { include: { profile: true } },
          subscriber: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    distinct: ['subscriptionId'],
  })

  for (const payment of failedPayments) {
    const sub = payment.subscription
    if (!sub || sub.status !== 'active') continue

    // Count total attempts
    const attemptCount = await db.payment.count({
      where: {
        subscriptionId: sub.id,
        status: 'failed',
        createdAt: { gte: sub.currentPeriodEnd || now },
      },
    })

    if (attemptCount >= MAX_RETRY_ATTEMPTS) continue

    // Check if enough time has passed for retry
    const timeSinceLastAttempt = now.getTime() - payment.createdAt.getTime()
    const requiredDelay = RETRY_DELAYS_MS[attemptCount] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]

    if (timeSinceLastAttempt < requiredDelay) {
      result.skipped++
      continue
    }

    // DISTRIBUTED LOCK: Prevent concurrent retry processing
    // Use same lock key pattern as webhook handler to prevent race conditions
    const lockKey = `sub:${sub.subscriberId}:${sub.creatorId}:${sub.interval}`
    const lockToken = await acquireLock(lockKey, 60000) // 60 second TTL

    if (!lockToken) {
      result.skipped++
      console.log(`[billing] Skipping retry for sub ${sub.id}: lock not acquired (another process handling)`)
      continue
    }

    try {
      result.processed++

      // Skip if missing required credentials
      if (!sub.paystackAuthorizationCode) {
        result.skipped++
        continue
      }

      if (!sub.creator?.profile?.paystackSubaccountCode) {
        result.skipped++
        continue
      }

      // Generate deterministic reference for idempotency
      const billingMonth = (sub.currentPeriodEnd || now).toISOString().slice(0, 7)
      const reference = `RET-${sub.id.slice(0, 8)}-${billingMonth.replace('-', '')}-R${attemptCount + 1}`

      // Calculate fees using current fee model
      const creatorPurpose = sub.creator?.profile?.purpose
      const subscriptionFeeMode = (sub.feeMode || sub.creator?.profile?.feeMode) as FeeMode
      const feeCalc = calculateServiceFee(sub.amount, sub.currency, creatorPurpose, subscriptionFeeMode)
      const grossCents = feeCalc.grossCents
      const feeCents = feeCalc.feeCents
      const netCents = feeCalc.netCents
      const feeModel = feeCalc.feeModel
      const feeEffectiveRate = feeCalc.effectiveRate
      const feeWasCapped = false

      // SECURITY: Decrypt authorization code
      const authCode = decryptAuthorizationCode(sub.paystackAuthorizationCode)
      if (!authCode) {
        result.skipped++
        console.error(`[billing] Skipping retry for sub ${sub.id}: failed to decrypt authorization code`)
        continue
      }

      // Charge with subaccount split
      const chargeResult = await chargeAuthorization({
        authorizationCode: authCode,
        email: sub.subscriber.email,
        amount: grossCents,
        currency: sub.currency,
        subaccountCode: sub.creator.profile.paystackSubaccountCode!,
        metadata: {
          subscriptionId: sub.id,
          creatorId: sub.creatorId,
          subscriberId: sub.subscriberId,
          interval: 'month',
          isRetry: true,
          retryAttempt: attemptCount + 1,
          feeModel,
          creatorAmount: netCents,
          serviceFee: feeCents,
        },
        reference,
      })

      // Update subscription
      const newPeriodEnd = addMonthSafe(sub.currentPeriodEnd || now, 1)

      await db.subscription.update({
        where: { id: sub.id },
        data: {
          currentPeriodEnd: newPeriodEnd,
          ltvCents: { increment: netCents },
          // Update authorization code if Paystack rotated it (encrypt at rest)
          paystackAuthorizationCode: chargeResult.authorization?.authorization_code
            ? encryptAuthorizationCode(chargeResult.authorization.authorization_code)
            : sub.paystackAuthorizationCode,
        },
      })

      // Use paid_at from Paystack response if available
      const paidAt = chargeResult.paid_at ? new Date(chargeResult.paid_at) : new Date()

      // Get reporting currency data (USD conversion) for admin dashboard
      const retryReportingData = await getReportingCurrencyData(grossCents, feeCents, netCents, sub.currency)

      await db.payment.create({
        data: {
          subscriptionId: sub.id,
          creatorId: sub.creatorId,
          subscriberId: sub.subscriberId,
          grossCents,
          amountCents: grossCents || sub.amount,
          currency: sub.currency,
          feeCents,
          netCents,
          feeModel,
          feeEffectiveRate,
          feeWasCapped,
          type: 'recurring',
          status: 'succeeded',
          occurredAt: paidAt,
          paystackEventId: chargeResult.id?.toString(),
          paystackTransactionRef: reference,
          // Reporting currency fields (USD normalized)
          ...retryReportingData,
        },
      })

      // Note: Creator payout handled automatically by Paystack subaccount split

      result.succeeded++
      console.log(`[billing] Retry ${attemptCount + 1} succeeded for sub ${sub.id}`)
    } catch (error: any) {
      await db.payment.create({
        data: {
          subscriptionId: sub.id,
          creatorId: sub.creatorId,
          subscriberId: sub.subscriberId,
          amountCents: sub.amount,
          currency: sub.currency,
          feeCents: 0,
          netCents: 0,
          type: 'recurring',
          status: 'failed',
          occurredAt: new Date(),
        },
      })

      result.errors.push({
        subscriptionId: sub.id,
        error: error.message || 'Unknown error',
      })

      console.error(`[billing] Retry ${attemptCount + 1} failed for sub ${sub.id}:`, error.message)
      result.failed++
    } finally {
      // Always release the lock (with ownership token)
      await releaseLock(lockKey, lockToken)
    }
  }

  return result
}

// Export for cron/scheduler
export default {
  processRecurringBilling,
  processRetries,
}
