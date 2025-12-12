// Recurring Billing Job for Paystack Subscriptions
// Run daily via cron or scheduled task manager

import { db } from '../db/client.js'
import { chargeAuthorization, generateReference } from '../services/paystack.js'
import { calculateFees, type UserPurpose } from '../services/pricing.js'

// Configuration
const MAX_RETRY_ATTEMPTS = 3
const RETRY_DELAYS_MS = [0, 60 * 60 * 1000, 24 * 60 * 60 * 1000] // Immediate, 1 hour, 24 hours
const GRACE_PERIOD_DAYS = 3 // Days before marking as past_due after all retries fail

interface BillingResult {
  processed: number
  succeeded: number
  failed: number
  skipped: number
  errors: Array<{ subscriptionId: string; error: string }>
}

/**
 * Process recurring billing for Paystack subscriptions
 * Should be run daily, ideally at 00:00 UTC
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

  // Find subscriptions due for renewal
  const subscriptions = await db.subscription.findMany({
    where: {
      status: 'active',
      interval: 'month',
      currentPeriodEnd: { lte: now },
      paystackAuthorizationCode: { not: null },
    },
    include: {
      creator: {
        include: { profile: true },
      },
      subscriber: true,
    },
  })

  console.log(`[billing] Found ${subscriptions.length} subscriptions due for renewal`)

  for (const sub of subscriptions) {
    result.processed++

    // Skip if no authorization code or creator profile
    if (!sub.paystackAuthorizationCode || !sub.creator?.profile?.paystackSubaccountCode) {
      result.skipped++
      console.log(`[billing] Skipping sub ${sub.id}: missing auth code or subaccount`)
      continue
    }

    // Check retry count from metadata or create tracking
    const retryKey = `billing_retry_${sub.id}`
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
          result.failed++
          console.log(`[billing] Sub ${sub.id} marked past_due after ${MAX_RETRY_ATTEMPTS} failed attempts`)
          continue
        }
      }
    }

    try {
      const reference = generateReference('REC')

      const chargeResult = await chargeAuthorization({
        authorizationCode: sub.paystackAuthorizationCode,
        email: sub.subscriber.email,
        amount: sub.amount,
        currency: sub.currency,
        subaccountCode: sub.creator.profile.paystackSubaccountCode,
        metadata: {
          subscriptionId: sub.id,
          creatorId: sub.creatorId,
          subscriberId: sub.subscriberId,
          interval: 'month',
          isRecurring: true,
        },
        reference,
      })

      // Update subscription period and capture any new authorization code
      const newPeriodEnd = new Date(sub.currentPeriodEnd || now)
      newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1)

      await db.subscription.update({
        where: { id: sub.id },
        data: {
          currentPeriodEnd: newPeriodEnd,
          ltvCents: { increment: sub.amount },
          // Update authorization code if Paystack rotated it
          paystackAuthorizationCode: chargeResult.authorization?.authorization_code || sub.paystackAuthorizationCode,
        },
      })

      // Calculate fees based on creator's purpose (personal: 10%, service: 8%)
      const creatorPurpose = sub.creator.profile.purpose as UserPurpose
      const { totalFeeCents: feeCents, netCents } = calculateFees(sub.amount, creatorPurpose)

      // Create successful payment record
      await db.payment.create({
        data: {
          subscriptionId: sub.id,
          creatorId: sub.creatorId,
          subscriberId: sub.subscriberId,
          amountCents: sub.amount,
          currency: sub.currency,
          feeCents,
          netCents,
          type: 'recurring',
          status: 'succeeded',
          paystackEventId: chargeResult.id?.toString(),
          paystackTransactionRef: reference,
        },
      })

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
        },
      })

      result.errors.push({
        subscriptionId: sub.id,
        error: error.message || 'Unknown error',
      })

      // Log without PII
      console.error(`[billing] Sub ${sub.id} charge failed (attempt ${retryAttempt + 1}/${MAX_RETRY_ATTEMPTS}):`, error.message)
    }
  }

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

    result.processed++

    if (!sub.paystackAuthorizationCode || !sub.creator?.profile?.paystackSubaccountCode) {
      result.skipped++
      continue
    }

    try {
      const reference = generateReference('RET')

      const chargeResult = await chargeAuthorization({
        authorizationCode: sub.paystackAuthorizationCode,
        email: sub.subscriber.email,
        amount: sub.amount,
        currency: sub.currency,
        subaccountCode: sub.creator.profile.paystackSubaccountCode,
        metadata: {
          subscriptionId: sub.id,
          creatorId: sub.creatorId,
          subscriberId: sub.subscriberId,
          interval: 'month',
          isRetry: true,
          retryAttempt: attemptCount + 1,
        },
        reference,
      })

      // Update subscription
      const newPeriodEnd = new Date(sub.currentPeriodEnd || now)
      newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1)

      await db.subscription.update({
        where: { id: sub.id },
        data: {
          currentPeriodEnd: newPeriodEnd,
          ltvCents: { increment: sub.amount },
          paystackAuthorizationCode: chargeResult.authorization?.authorization_code || sub.paystackAuthorizationCode,
        },
      })

      // Calculate fees based on creator's purpose (personal: 10%, service: 8%)
      const creatorPurpose = sub.creator?.profile?.purpose as UserPurpose
      const { totalFeeCents: feeCents, netCents } = calculateFees(sub.amount, creatorPurpose)

      await db.payment.create({
        data: {
          subscriptionId: sub.id,
          creatorId: sub.creatorId,
          subscriberId: sub.subscriberId,
          amountCents: sub.amount,
          currency: sub.currency,
          feeCents,
          netCents,
          type: 'recurring',
          status: 'succeeded',
          paystackEventId: chargeResult.id?.toString(),
          paystackTransactionRef: reference,
        },
      })

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
        },
      })

      result.errors.push({
        subscriptionId: sub.id,
        error: error.message || 'Unknown error',
      })

      console.error(`[billing] Retry ${attemptCount + 1} failed for sub ${sub.id}:`, error.message)
    }
  }

  return result
}

// Export for cron/scheduler
export default {
  processRecurringBilling,
  processRetries,
}
