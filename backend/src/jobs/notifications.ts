// Notification Jobs for Subscriptions
// - Renewal reminders (3 days before)
// - Dunning emails (payment failed)

import { db } from '../db/client.js'
import {
  sendRenewalReminderEmail,
  sendPaymentFailedEmail,
  sendSubscriptionCanceledEmail,
} from '../services/email.js'

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
        include: { profile: true },
      },
    },
  })

  console.log(`[notifications] Found ${subscriptions.length} subscriptions for renewal reminders`)

  for (const sub of subscriptions) {
    result.processed++

    if (!sub.subscriber.email || !sub.creator?.profile?.displayName) {
      continue
    }

    // Idempotency check - skip if already sent this period
    const existingLog = await db.notificationLog.findUnique({
      where: {
        subscriptionId_type: {
          subscriptionId: sub.id,
          type: 'renewal_reminder',
        },
      },
    })

    if (existingLog) {
      console.log(`[notifications] Skipping sub ${sub.id} - reminder already sent`)
      continue
    }

    try {
      await sendRenewalReminderEmail(
        sub.subscriber.email,
        sub.creator.profile.displayName,
        sub.amount,
        sub.currency,
        sub.currentPeriodEnd!
      )

      // Log the send for idempotency
      await db.notificationLog.create({
        data: {
          subscriptionId: sub.id,
          type: 'renewal_reminder',
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
            include: { profile: true },
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
    const existingLog = await db.notificationLog.findFirst({
      where: {
        subscriptionId: sub.id,
        type: idempotencyType,
      },
    })

    if (existingLog) {
      console.log(`[notifications] Skipping sub ${sub.id} - dunning already sent for this payment`)
      continue
    }

    // Calculate next retry date (1 day after failure)
    const retryDate = new Date(payment.createdAt.getTime() + 24 * 60 * 60 * 1000)

    try {
      await sendPaymentFailedEmail(
        sub.subscriber.email,
        sub.creator.profile.displayName,
        sub.amount,
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

    // Idempotency check
    const existingLog = await db.notificationLog.findUnique({
      where: {
        subscriptionId_type: {
          subscriptionId: sub.id,
          type: 'subscription_canceled',
        },
      },
    })

    if (existingLog) {
      console.log(`[notifications] Skipping sub ${sub.id} - cancellation already sent`)
      continue
    }

    try {
      await sendSubscriptionCanceledEmail(
        sub.subscriber.email,
        sub.creator.profile.displayName
      )

      await db.notificationLog.create({
        data: {
          subscriptionId: sub.id,
          type: 'subscription_canceled',
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
