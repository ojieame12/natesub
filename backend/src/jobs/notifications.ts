// Notification Jobs for Subscriptions
// - Renewal reminders (3 days before)
// - Dunning emails (payment failed)

import { db } from '../db/client.js'
import {
  sendRenewalReminderEmail,
  sendPaymentFailedEmail,
  sendSubscriptionCanceledEmail,
} from '../services/email.js'
import { calculateServiceFee, calculateLegacyServiceFee, type FeeMode } from '../services/fees.js'
import { acquireLock, releaseLock } from '../services/lock.js'

interface NotificationResult {
  processed: number
  sent: number
  errors: Array<{ subscriptionId: string; error: string }>
}

/**
 * Send renewal reminders for subscriptions expiring in ~3 days
 * Run daily, ideally in the morning
 */
export async function sendRenewalReminders(): Promise<NotificationResult> {
  const result: NotificationResult = {
    processed: 0,
    sent: 0,
    errors: [],
  }

  const now = new Date()
  const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
  const fourDaysFromNow = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000)

  // Find active subscriptions expiring in 3-4 days
  const subscriptions = await db.subscription.findMany({
    where: {
      status: 'active',
      interval: 'month',
      currentPeriodEnd: {
        gte: threeDaysFromNow,
        lt: fourDaysFromNow,
      },
    },
    include: {
      subscriber: true,
      creator: {
        include: {
          profile: {
            select: {
              displayName: true,
              feeMode: true,
              purpose: true,
            },
          },
        },
      },
    },
  })

  console.log(`[notifications] Found ${subscriptions.length} subscriptions for renewal reminders`)

  for (const sub of subscriptions) {
    result.processed++

    if (!sub.subscriber.email || !sub.creator?.profile?.displayName) {
      continue
    }

    // Per-cycle idempotency key - includes the period end date to allow one reminder per billing cycle
    const periodKey = sub.currentPeriodEnd!.toISOString().slice(0, 10) // YYYY-MM-DD
    const idempotencyType = `renewal_reminder_${periodKey}`

    // Acquire lock to prevent race conditions between workers
    const lockKey = `notification:${sub.id}:${idempotencyType}`
    const lockToken = await acquireLock(lockKey, 30000) // 30 second TTL

    if (!lockToken) {
      console.log(`[notifications] Skipping sub ${sub.id} - locked by another worker`)
      continue
    }

    try {
      // Idempotency check - skip if already sent this period
      const existingLog = await db.notificationLog.findFirst({
        where: {
          subscriptionId: sub.id,
          type: idempotencyType,
        },
      })

      if (existingLog) {
        console.log(`[notifications] Skipping sub ${sub.id} - reminder already sent for period ${periodKey}`)
        await releaseLock(lockKey, lockToken)
        continue
      }

      // Calculate what the subscriber will actually pay
      // Uses subscription's feeModel to determine calculation method:
      // - split_v1: subscriber pays base + 4%
      // - legacy: respects profile's feeMode (absorb = no extra, pass_to_subscriber = +8%)
      const feeMode = (sub.creator.profile?.feeMode ?? 'split') as FeeMode
      const feeCalc = (sub as any).feeModel === 'split_v1'
        ? calculateServiceFee(sub.amount, sub.currency, sub.creator.profile?.purpose)
        : calculateLegacyServiceFee(sub.amount, sub.currency, sub.creator.profile?.purpose, feeMode)
      const subscriberAmount = feeCalc.grossCents

      await sendRenewalReminderEmail(
        sub.subscriber.email,
        sub.creator.profile.displayName,
        subscriberAmount,
        sub.currency,
        sub.currentPeriodEnd!
      )

      // Log the send for idempotency - use period-specific type
      await db.notificationLog.create({
        data: {
          subscriptionId: sub.id,
          type: idempotencyType,
        },
      })

      result.sent++
      console.log(`[notifications] Sent renewal reminder for sub ${sub.id}`)
    } catch (error: any) {
      result.errors.push({
        subscriptionId: sub.id,
        error: error.message || 'Unknown error',
      })
      console.error(`[notifications] Failed to send reminder for sub ${sub.id}:`, error.message)
    } finally {
      await releaseLock(lockKey, lockToken)
    }
  }

  return result
}

/**
 * Send dunning emails for subscriptions with past_due status
 * Run daily after billing retries
 */
export async function sendDunningEmails(): Promise<NotificationResult> {
  const result: NotificationResult = {
    processed: 0,
    sent: 0,
    errors: [],
  }

  const now = new Date()
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  // Find subscriptions that became past_due in the last 24 hours
  // Check for failed payments instead since past_due update might not have timestamp
  const failedPayments = await db.payment.findMany({
    where: {
      status: 'failed',
      type: 'recurring',
      createdAt: { gte: oneDayAgo },
    },
    include: {
      subscription: {
        include: {
          subscriber: true,
          creator: {
            include: {
              profile: {
                select: {
                  displayName: true,
                  feeMode: true,
                  purpose: true,
                },
              },
            },
          },
        },
      },
    },
    distinct: ['subscriptionId'],
  })

  console.log(`[notifications] Found ${failedPayments.length} failed payments for dunning`)

  for (const payment of failedPayments) {
    const sub = payment.subscription
    if (!sub || !sub.subscriber.email || !sub.creator?.profile?.displayName) {
      continue
    }

    result.processed++

    // Idempotency check - use payment ID in type to allow one email per failed payment
    const idempotencyType = `payment_failed_${payment.id}`

    // Acquire lock to prevent race conditions between workers
    const lockKey = `notification:${sub.id}:${idempotencyType}`
    const lockToken = await acquireLock(lockKey, 30000) // 30 second TTL

    if (!lockToken) {
      console.log(`[notifications] Skipping sub ${sub.id} - locked by another worker`)
      continue
    }

    try {
      // Idempotency check inside lock to prevent TOCTOU race
      const existingLog = await db.notificationLog.findFirst({
        where: {
          subscriptionId: sub.id,
          type: idempotencyType,
        },
      })

      if (existingLog) {
        console.log(`[notifications] Skipping sub ${sub.id} - dunning already sent for this payment`)
        await releaseLock(lockKey, lockToken)
        continue
      }

      // Calculate next retry date (1 day after failure)
      const retryDate = new Date(payment.createdAt.getTime() + 24 * 60 * 60 * 1000)

      // Calculate what the subscriber will actually pay
      // Uses subscription's feeModel to determine calculation method:
      // - split_v1: subscriber pays base + 4%
      // - legacy: respects profile's feeMode (absorb = no extra, pass_to_subscriber = +8%)
      const feeMode = (sub.creator.profile?.feeMode ?? 'split') as FeeMode
      const feeCalc = (sub as any).feeModel === 'split_v1'
        ? calculateServiceFee(sub.amount, sub.currency, sub.creator.profile?.purpose)
        : calculateLegacyServiceFee(sub.amount, sub.currency, sub.creator.profile?.purpose, feeMode)
      const subscriberAmount = feeCalc.grossCents

      await sendPaymentFailedEmail(
        sub.subscriber.email,
        sub.creator.profile.displayName,
        subscriberAmount,
        sub.currency,
        retryDate
      )

      await db.notificationLog.create({
        data: {
          subscriptionId: sub.id,
          type: idempotencyType,
        },
      })

      result.sent++
      console.log(`[notifications] Sent dunning email for sub ${sub.id}`)
    } catch (error: any) {
      result.errors.push({
        subscriptionId: sub.id,
        error: error.message || 'Unknown error',
      })
      console.error(`[notifications] Failed to send dunning email for sub ${sub.id}:`, error.message)
    } finally {
      await releaseLock(lockKey, lockToken)
    }
  }

  return result
}

/**
 * Send cancellation emails for subscriptions that were canceled due to payment failure
 * Run after grace period expires
 */
export async function sendCancellationEmails(): Promise<NotificationResult> {
  const result: NotificationResult = {
    processed: 0,
    sent: 0,
    errors: [],
  }

  const now = new Date()
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  // Find subscriptions canceled in the last 24 hours
  const subscriptions = await db.subscription.findMany({
    where: {
      status: 'canceled',
      canceledAt: { gte: oneDayAgo },
    },
    include: {
      subscriber: true,
      creator: {
        include: { profile: true },
      },
    },
  })

  console.log(`[notifications] Found ${subscriptions.length} cancellations for notification`)

  for (const sub of subscriptions) {
    if (!sub.subscriber.email || !sub.creator?.profile?.displayName) {
      continue
    }

    result.processed++

    const idempotencyType = 'subscription_canceled'

    // Acquire lock to prevent race conditions between workers
    const lockKey = `notification:${sub.id}:${idempotencyType}`
    const lockToken = await acquireLock(lockKey, 30000) // 30 second TTL

    if (!lockToken) {
      console.log(`[notifications] Skipping sub ${sub.id} - locked by another worker`)
      continue
    }

    try {
      // Idempotency check inside lock to prevent TOCTOU race
      const existingLog = await db.notificationLog.findUnique({
        where: {
          subscriptionId_type: {
            subscriptionId: sub.id,
            type: idempotencyType,
          },
        },
      })

      if (existingLog) {
        console.log(`[notifications] Skipping sub ${sub.id} - cancellation already sent`)
        await releaseLock(lockKey, lockToken)
        continue
      }

      // Determine cancellation reason by checking for recent failed payments
      const recentFailedPayment = await db.payment.findFirst({
        where: {
          subscriptionId: sub.id,
          status: 'failed',
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
        },
      })

      const cancellationReason = recentFailedPayment
        ? 'payment_failed' as const
        : 'other' as const

      await sendSubscriptionCanceledEmail(
        sub.subscriber.email,
        sub.creator.profile.displayName,
        cancellationReason
      )

      await db.notificationLog.create({
        data: {
          subscriptionId: sub.id,
          type: idempotencyType,
        },
      })

      result.sent++
      console.log(`[notifications] Sent cancellation email for sub ${sub.id}`)
    } catch (error: any) {
      result.errors.push({
        subscriptionId: sub.id,
        error: error.message || 'Unknown error',
      })
      console.error(`[notifications] Failed to send cancellation email for sub ${sub.id}:`, error.message)
    } finally {
      await releaseLock(lockKey, lockToken)
    }
  }

  return result
}

// Export for cron/scheduler
export default {
  sendRenewalReminders,
  sendDunningEmails,
  sendCancellationEmails,
}
