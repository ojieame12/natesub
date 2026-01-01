/**
 * Subscription Reminder Scheduling
 *
 * Reminders for subscription lifecycle:
 * - Renewal reminders (7d, 3d, 1d before - Visa VAMP compliant)
 * - Payment failed notification
 * - Past due notification
 */

import { db } from '../../db/client.js'
import { scheduleReminder, cancelReminder, cancelAllRemindersForEntity } from './core.js'

/**
 * Schedule renewal reminders for a subscription
 * Call this after subscription creation or successful renewal
 */
export async function scheduleSubscriptionRenewalReminders(subscriptionId: string): Promise<void> {
  const subscription = await db.subscription.findUnique({
    where: { id: subscriptionId },
    select: {
      id: true,
      subscriberId: true,
      interval: true,
      currentPeriodEnd: true,
      status: true,
      cancelAtPeriodEnd: true,
    },
  })

  // Don't schedule for one-time, canceled, or pending cancellation
  if (!subscription) return
  if (subscription.interval === 'one_time') return
  if (subscription.status !== 'active') return
  if (subscription.cancelAtPeriodEnd) return
  if (!subscription.currentPeriodEnd) return

  const renewalDate = subscription.currentPeriodEnd

  // Cancel any existing renewal reminders first (in case of re-scheduling)
  await cancelReminder({
    entityType: 'subscription',
    entityId: subscriptionId,
    type: 'subscription_renewal_7d',
  })
  await cancelReminder({
    entityType: 'subscription',
    entityId: subscriptionId,
    type: 'subscription_renewal_3d',
  })
  await cancelReminder({
    entityType: 'subscription',
    entityId: subscriptionId,
    type: 'subscription_renewal_1d',
  })

  // 7 days before renewal (Visa-compliant: "at least 7 days before")
  const sevenDaysBefore = new Date(renewalDate.getTime() - 7 * 24 * 60 * 60 * 1000)
  if (sevenDaysBefore > new Date()) {
    await scheduleReminder({
      userId: subscription.subscriberId,
      entityType: 'subscription',
      entityId: subscriptionId,
      type: 'subscription_renewal_7d',
      scheduledFor: sevenDaysBefore,
    })
  }

  // 3 days before renewal
  const threeDaysBefore = new Date(renewalDate.getTime() - 3 * 24 * 60 * 60 * 1000)
  if (threeDaysBefore > new Date()) {
    await scheduleReminder({
      userId: subscription.subscriberId,
      entityType: 'subscription',
      entityId: subscriptionId,
      type: 'subscription_renewal_3d',
      scheduledFor: threeDaysBefore,
    })
  }

  // 1 day before renewal
  const oneDayBefore = new Date(renewalDate.getTime() - 24 * 60 * 60 * 1000)
  if (oneDayBefore > new Date()) {
    await scheduleReminder({
      userId: subscription.subscriberId,
      entityType: 'subscription',
      entityId: subscriptionId,
      type: 'subscription_renewal_1d',
      scheduledFor: oneDayBefore,
    })
  }

  console.log(`[reminders] Scheduled renewal reminders for subscription ${subscriptionId}`)
}

/**
 * Schedule a failed payment notification
 * Call this from billing job when charge fails
 */
export async function schedulePaymentFailedReminder(
  subscriptionId: string,
  _retryDate: Date | null
): Promise<void> {
  const subscription = await db.subscription.findUnique({
    where: { id: subscriptionId },
    select: { subscriberId: true },
  })

  if (!subscription) return

  // Schedule immediately (will be processed in next reminder run)
  await scheduleReminder({
    userId: subscription.subscriberId,
    entityType: 'subscription',
    entityId: subscriptionId,
    type: 'subscription_payment_failed',
    scheduledFor: new Date(), // Immediate
  })
}

/**
 * Schedule a past due notification
 * Call this when subscription is marked past_due
 */
export async function schedulePastDueReminder(subscriptionId: string): Promise<void> {
  const subscription = await db.subscription.findUnique({
    where: { id: subscriptionId },
    select: { subscriberId: true },
  })

  if (!subscription) return

  await scheduleReminder({
    userId: subscription.subscriberId,
    entityType: 'subscription',
    entityId: subscriptionId,
    type: 'subscription_past_due',
    scheduledFor: new Date(), // Immediate
  })
}

/**
 * Cancel all renewal reminders for a subscription
 * Call this when subscription is canceled
 */
export async function cancelSubscriptionReminders(subscriptionId: string): Promise<void> {
  await cancelAllRemindersForEntity({
    entityType: 'subscription',
    entityId: subscriptionId,
  })
}
