// Recurring Billing Job for Paystack Subscriptions
// Run daily via cron or scheduled task manager

import { db } from '../db/client.js'
import { chargeAuthorization, generateReference, initiateTransfer, createTransferRecipient } from '../services/paystack.js'
import { calculateServiceFee, calculateLegacyFee, type FeeMode } from '../services/fees.js'
import { decryptAccountNumber } from '../utils/encryption.js'
import { acquireLock, releaseLock } from '../services/lock.js'

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

    // DISTRIBUTED LOCK: Prevent concurrent processing of same subscription
    // This prevents double-charging if billing job runs while webhook is processing
    const lockKey = `billing:${sub.id}`
    const lockAcquired = await acquireLock(lockKey, 60000) // 60 second TTL

    if (!lockAcquired) {
      result.skipped++
      console.log(`[billing] Skipping sub ${sub.id}: lock not acquired (another process handling)`)
      continue
    }

    try {
      // Check fee model to determine requirements
      // Both 'flat' and 'progressive' are new models
      const isNewFeeModel = sub.feeModel === 'flat' || sub.feeModel?.startsWith('progressive')

      // Skip if no authorization code
      // For new model: need bank details for transfer; for legacy: need subaccount
      if (!sub.paystackAuthorizationCode) {
        result.skipped++
        console.log(`[billing] Skipping sub ${sub.id}: missing auth code`)
        continue
      }

      if (isNewFeeModel) {
        // New model requires bank details for transfer
        if (!sub.creator?.profile?.paystackBankCode || !sub.creator?.profile?.paystackAccountNumber) {
          result.skipped++
          console.log(`[billing] Skipping sub ${sub.id}: missing bank details for transfer`)
          continue
        }
      } else {
        // Legacy model requires subaccount
        if (!sub.creator?.profile?.paystackSubaccountCode) {
          result.skipped++
          console.log(`[billing] Skipping sub ${sub.id}: missing subaccount code`)
          continue
        }
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
            result.failed++
            console.log(`[billing] Sub ${sub.id} marked past_due after ${MAX_RETRY_ATTEMPTS} failed attempts`)
            continue
          }
        }
      }
      const reference = generateReference('REC')

      // Calculate fees based on subscription's fee model
      let feeCents: number
      let netCents: number
      let grossCents: number | null = null
      let feeModel: string | null = null
      let feeEffectiveRate: number | null = null
      const feeWasCapped = false  // Flat fee model has no caps

      if (isNewFeeModel) {
        // New model: flat fee based on creator's purpose and feeMode
        // Use subscription's feeMode (locked at creation) with fallback to profile for legacy subs
        const creatorPurpose = sub.creator.profile.purpose
        const subscriptionFeeMode = (sub.feeMode || sub.creator.profile.feeMode) as FeeMode
        const feeCalc = calculateServiceFee(sub.amount, sub.currency, creatorPurpose, subscriptionFeeMode)
        grossCents = feeCalc.grossCents // Total to charge subscriber
        feeCents = feeCalc.feeCents
        netCents = feeCalc.netCents // What creator receives
        feeModel = feeCalc.feeModel
        feeEffectiveRate = feeCalc.effectiveRate
      } else {
        // Legacy model: percentage-based fee deducted from creator
        const creatorPurpose = sub.creator.profile.purpose as 'personal' | 'service' | null
        const legacyFees = calculateLegacyFee(sub.amount, creatorPurpose)
        feeCents = legacyFees.feeCents
        netCents = legacyFees.netCents
      }

      // Charge the subscriber
      // New model: charge full amount (gross), then transfer to creator
      // Legacy model: use subaccount split
      const chargeResult = await chargeAuthorization({
        authorizationCode: sub.paystackAuthorizationCode,
        email: sub.subscriber.email,
        amount: isNewFeeModel ? grossCents! : sub.amount,
        currency: sub.currency,
        subaccountCode: isNewFeeModel ? undefined : (sub.creator.profile?.paystackSubaccountCode || undefined), // Omit for new model
        metadata: {
          subscriptionId: sub.id,
          creatorId: sub.creatorId,
          subscriberId: sub.subscriberId,
          interval: 'month',
          isRecurring: true,
          feeModel: feeModel || undefined,
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
          // Update authorization code if Paystack rotated it
          paystackAuthorizationCode: chargeResult.authorization?.authorization_code || sub.paystackAuthorizationCode,
        },
      })

      // Create successful payment record
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
          paystackEventId: chargeResult.id?.toString(),
          paystackTransactionRef: reference,
        },
      })

      // For new fee model: initiate transfer to creator
      if (isNewFeeModel && sub.creator.profile.paystackBankCode && sub.creator.profile.paystackAccountNumber) {
        // Paystack only allows alphanumeric and hyphens (no underscores)
        const payoutReference = `PAYOUT-${reference}`

        // Idempotency check: ensure we don't double-transfer
        const existingPayout = await db.payment.findFirst({
          where: {
            paystackTransactionRef: payoutReference,
            type: 'payout',
          },
        })

        if (existingPayout) {
          console.log(`[billing] Payout ${payoutReference} already exists, skipping transfer`)
        } else {
          try {
            const accountNumber = decryptAccountNumber(sub.creator.profile.paystackAccountNumber)
            if (accountNumber) {
              // IMPORTANT: Create payout record FIRST before initiating transfer
              // This ensures we always have a record even if transfer succeeds but DB write fails later
              const payoutRecord = await db.payment.create({
                data: {
                  subscriptionId: sub.id,
                  creatorId: sub.creatorId,
                  subscriberId: sub.subscriberId,
                  amountCents: netCents,
                  currency: sub.currency,
                  feeCents: 0,
                  netCents,
                  feeModel,
                  feeEffectiveRate,
                  feeWasCapped,
                  type: 'payout',
                  status: 'pending',
                  paystackTransactionRef: payoutReference,
                },
              })

              try {
                const { recipientCode } = await createTransferRecipient({
                  name: sub.creator.profile.displayName,
                  accountNumber,
                  bankCode: sub.creator.profile.paystackBankCode,
                  currency: sub.currency,
                })

                await initiateTransfer({
                  amount: netCents,
                  recipientCode,
                  reason: `Recurring payment from ${sub.subscriber.email}`,
                  reference: payoutReference,
                })

                console.log(`[billing] Initiated transfer of ${netCents} to creator ${sub.creatorId}`)
              } catch (transferErr: any) {
                // Transfer failed - update payout record to reflect failure
                await db.payment.update({
                  where: { id: payoutRecord.id },
                  data: { status: 'failed' },
                })
                console.error(`[billing] Transfer failed for sub ${sub.id}:`, transferErr.message)
              }
            }
          } catch (dbErr: any) {
            // DB write failed - log but don't fail the overall charge
            console.error(`[billing] Failed to create payout record for sub ${sub.id}:`, dbErr.message)
          }
        }
      }

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
      console.error(`[billing] Sub ${sub.id} charge failed:`, error.message)
      result.failed++
    } finally {
      // Always release the lock
      await releaseLock(lockKey)
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

    // DISTRIBUTED LOCK: Prevent concurrent retry processing
    const lockKey = `billing:${sub.id}`
    const lockAcquired = await acquireLock(lockKey, 60000) // 60 second TTL

    if (!lockAcquired) {
      result.skipped++
      console.log(`[billing] Skipping retry for sub ${sub.id}: lock not acquired (another process handling)`)
      continue
    }

    try {
      result.processed++

      // Check fee model to determine requirements
      // Both 'flat' and 'progressive' are new models
      const isNewFeeModel = sub.feeModel === 'flat' || sub.feeModel?.startsWith('progressive')

      // Skip if missing required credentials
      if (!sub.paystackAuthorizationCode) {
        result.skipped++
        continue
      }

      if (isNewFeeModel) {
        // New model requires bank details for transfer
        if (!sub.creator?.profile?.paystackBankCode || !sub.creator?.profile?.paystackAccountNumber) {
          result.skipped++
          continue
        }
      } else {
        // Legacy model requires subaccount
        if (!sub.creator?.profile?.paystackSubaccountCode) {
          result.skipped++
          continue
        }
      }
      const reference = generateReference('RET')

      // Calculate fees based on subscription's fee model
      let feeCents: number
      let netCents: number
      let grossCents: number | null = null
      let feeModel: string | null = null
      let feeEffectiveRate: number | null = null
      const feeWasCapped = false  // Flat fee model has no caps

      if (isNewFeeModel) {
        // Use subscription's feeMode (locked at creation) with fallback to profile for legacy subs
        const creatorPurpose = sub.creator?.profile?.purpose
        const subscriptionFeeMode = (sub.feeMode || sub.creator?.profile?.feeMode) as FeeMode
        const feeCalc = calculateServiceFee(sub.amount, sub.currency, creatorPurpose, subscriptionFeeMode)
        grossCents = feeCalc.grossCents
        feeCents = feeCalc.feeCents
        netCents = feeCalc.netCents
        feeModel = feeCalc.feeModel
        feeEffectiveRate = feeCalc.effectiveRate
      } else {
        const creatorPurpose = sub.creator?.profile?.purpose as 'personal' | 'service' | null
        const legacyFees = calculateLegacyFee(sub.amount, creatorPurpose)
        feeCents = legacyFees.feeCents
        netCents = legacyFees.netCents
      }

      const chargeResult = await chargeAuthorization({
        authorizationCode: sub.paystackAuthorizationCode,
        email: sub.subscriber.email,
        amount: isNewFeeModel ? grossCents! : sub.amount,
        currency: sub.currency,
        subaccountCode: isNewFeeModel ? undefined : (sub.creator.profile?.paystackSubaccountCode || undefined),
        metadata: {
          subscriptionId: sub.id,
          creatorId: sub.creatorId,
          subscriberId: sub.subscriberId,
          interval: 'month',
          isRetry: true,
          retryAttempt: attemptCount + 1,
          feeModel: feeModel || undefined,
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
          paystackAuthorizationCode: chargeResult.authorization?.authorization_code || sub.paystackAuthorizationCode,
        },
      })

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
          paystackEventId: chargeResult.id?.toString(),
          paystackTransactionRef: reference,
        },
      })

      // For new fee model: initiate transfer to creator
      if (isNewFeeModel && sub.creator?.profile?.paystackBankCode && sub.creator?.profile?.paystackAccountNumber) {
        // Paystack only allows alphanumeric and hyphens (no underscores)
        const payoutReference = `PAYOUT-${reference}`

        // Idempotency check: ensure we don't double-transfer
        const existingPayout = await db.payment.findFirst({
          where: {
            paystackTransactionRef: payoutReference,
            type: 'payout',
          },
        })

        if (existingPayout) {
          console.log(`[billing] Payout ${payoutReference} already exists, skipping transfer`)
        } else {
          try {
            const accountNumber = decryptAccountNumber(sub.creator.profile.paystackAccountNumber)
            if (accountNumber) {
              const { recipientCode } = await createTransferRecipient({
                name: sub.creator.profile.displayName,
                accountNumber,
                bankCode: sub.creator.profile.paystackBankCode,
                currency: sub.currency,
              })

              await initiateTransfer({
                amount: netCents,
                recipientCode,
                reason: `Retry payment from ${sub.subscriber.email}`,
                reference: payoutReference,
              })

              // Record payout for idempotency tracking (with fee audit metadata)
              await db.payment.create({
                data: {
                  subscriptionId: sub.id,
                  creatorId: sub.creatorId,
                  subscriberId: sub.subscriberId,
                  amountCents: netCents,
                  currency: sub.currency,
                  feeCents: 0,
                  netCents,
                  feeModel,
                  feeEffectiveRate,
                  feeWasCapped,
                  type: 'payout',
                  status: 'pending',
                  paystackTransactionRef: payoutReference,
                },
              })

              console.log(`[billing] Initiated retry transfer of ${netCents} to creator ${sub.creatorId}`)
            }
          } catch (transferErr: any) {
            console.error(`[billing] Transfer failed for retry sub ${sub.id}:`, transferErr.message)
          }
        }
      }

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
      result.failed++
    } finally {
      // Always release the lock
      await releaseLock(lockKey)
    }
  }

  return result
}

// Export for cron/scheduler
export default {
  processRecurringBilling,
  processRetries,
}
