/**
 * Reminder Processor - Main Entry Point
 *
 * Processes due reminders via cron job.
 * Routes each reminder type to its specific processor.
 */

import { db } from '../../../db/client.js'
import type { ReminderType, ReminderChannel } from '@prisma/client'
import { acquireLock, releaseLock } from '../../../services/lock.js'
import { logReminderSent, logReminderFailed } from '../../../services/systemLog.js'

import {
  processRequestUnopenedReminder,
  processRequestUnpaidReminder,
  processRequestExpiringReminder,
  processInvoiceDueReminder,
  processInvoiceOverdueReminder,
} from './request.js'

import {
  processOnboardingIncompleteReminder,
  processBankSetupIncompleteReminder,
  processNoSubscribersReminder,
  processPayrollReadyReminder,
} from './engagement.js'

import {
  processSubscriptionRenewalReminder,
  processSubscriptionPaymentFailedReminder,
  processSubscriptionPastDueReminder,
  processPayoutCompletedReminder,
  processPayoutFailedReminder,
} from './subscription.js'

// ============================================
// TYPES
// ============================================

interface ReminderResult {
  processed: number
  sent: number
  failed: number
  errors: Array<{ reminderId: string; error: string }>
}

// Re-export for use by other modules
export type { ReminderResult }

// ============================================
// NOTIFICATION PREFERENCE CHECKING
// ============================================

interface NotificationPrefs {
  push?: boolean
  email?: boolean
  subscriberAlerts?: boolean
  paymentAlerts?: boolean
}

// Reminder types that require paymentAlerts preference
const PAYMENT_ALERT_TYPES: ReminderType[] = [
  'invoice_due_7d',
  'invoice_due_3d',
  'invoice_due_1d',
  'invoice_overdue_1d',
  'invoice_overdue_7d',
  'payout_completed',
  'payout_failed',
  'request_expiring',
]

// Reminder types that require subscriberAlerts preference
const SUBSCRIBER_ALERT_TYPES: ReminderType[] = [
  'request_unopened_24h',
  'request_unopened_72h',
  'request_unpaid_3d',
]

// System/onboarding types that always send (critical for platform function)
// Includes subscription renewal reminders - these are REQUIRED for Visa VAMP compliance
const SYSTEM_ALERT_TYPES: ReminderType[] = [
  'onboarding_incomplete_24h',
  'onboarding_incomplete_72h',
  'bank_setup_incomplete',
  'no_subscribers_7d',
  'payroll_ready',
  // Visa VAMP compliance: pre-billing notifications are legally required
  'subscription_renewal_7d',
  'subscription_renewal_3d',
  'subscription_renewal_1d',
  'subscription_payment_failed',
  'subscription_past_due',
]

/**
 * Check if user has opted in to receive this type of notification
 */
async function checkNotificationPreferences(
  userId: string,
  reminderType: ReminderType,
  channel: ReminderChannel
): Promise<boolean> {
  // System alerts always send (critical for platform function)
  if (SYSTEM_ALERT_TYPES.includes(reminderType)) {
    return true
  }

  // Fetch user's notification preferences
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { notificationPrefs: true },
  })

  const prefs = (profile?.notificationPrefs as NotificationPrefs) || {}

  // Check channel preference (email/push)
  if (channel === 'email' && prefs.email === false) {
    return false
  }
  if (channel === 'push' && prefs.push === false) {
    return false
  }

  // Check category-specific preferences
  if (PAYMENT_ALERT_TYPES.includes(reminderType) && prefs.paymentAlerts === false) {
    return false
  }
  if (SUBSCRIBER_ALERT_TYPES.includes(reminderType) && prefs.subscriberAlerts === false) {
    return false
  }

  return true
}

// ============================================
// REMINDER ROUTING
// ============================================

/**
 * Process a single reminder - returns true if message was sent
 * Routes to appropriate processor based on reminder type
 */
async function processReminder(reminder: {
  id: string
  userId: string
  entityType: string
  entityId: string
  type: ReminderType
  channel: ReminderChannel
}): Promise<boolean> {
  const { userId, entityId, type, channel } = reminder

  // Check user notification preferences before sending
  const shouldSend = await checkNotificationPreferences(userId, type, channel)
  if (!shouldSend) {
    console.log(`[reminders] Skipping reminder ${type} for user ${userId} - opted out`)
    return false
  }

  switch (type) {
    // Request reminders
    case 'request_unopened_24h':
    case 'request_unopened_72h':
      return await processRequestUnopenedReminder(entityId, type === 'request_unopened_72h', channel)

    case 'request_unpaid_3d':
      return await processRequestUnpaidReminder(entityId, channel)

    case 'request_expiring':
      return await processRequestExpiringReminder(entityId, channel)

    // Invoice reminders
    case 'invoice_due_7d':
      return await processInvoiceDueReminder(entityId, 7, channel)

    case 'invoice_due_3d':
      return await processInvoiceDueReminder(entityId, 3, channel)

    case 'invoice_due_1d':
      return await processInvoiceDueReminder(entityId, 1, channel)

    case 'invoice_overdue_1d':
      return await processInvoiceOverdueReminder(entityId, 1, channel)

    case 'invoice_overdue_7d':
      return await processInvoiceOverdueReminder(entityId, 7, channel)

    // Payout reminders
    case 'payout_completed':
      return await processPayoutCompletedReminder(entityId, channel)

    case 'payout_failed':
      return await processPayoutFailedReminder(entityId, channel)

    // Payroll reminders (email only)
    case 'payroll_ready':
      return await processPayrollReadyReminder(entityId)

    // Onboarding reminders (email only)
    case 'onboarding_incomplete_24h':
    case 'onboarding_incomplete_72h':
      return await processOnboardingIncompleteReminder(entityId, type === 'onboarding_incomplete_72h')

    case 'bank_setup_incomplete':
      return await processBankSetupIncompleteReminder(entityId, channel)

    case 'no_subscribers_7d':
      return await processNoSubscribersReminder(entityId)

    // Subscription renewal reminders
    case 'subscription_renewal_7d':
      return await processSubscriptionRenewalReminder(entityId, 7)

    case 'subscription_renewal_3d':
      return await processSubscriptionRenewalReminder(entityId, 3)

    case 'subscription_renewal_1d':
      return await processSubscriptionRenewalReminder(entityId, 1)

    case 'subscription_payment_failed':
      return await processSubscriptionPaymentFailedReminder(entityId)

    case 'subscription_past_due':
      return await processSubscriptionPastDueReminder(entityId)

    default:
      console.warn(`[reminders] Unknown reminder type: ${type}`)
      return false
  }
}

// ============================================
// MAIN PROCESSOR
// ============================================

/**
 * Process all due reminders
 * Run this hourly via cron
 * Uses distributed locking to prevent duplicate processing across workers
 *
 * @param effectiveNow - Optional time override for E2E testing
 */
export async function processDueReminders(effectiveNow?: Date): Promise<ReminderResult> {
  const result: ReminderResult = {
    processed: 0,
    sent: 0,
    failed: 0,
    errors: [],
  }

  const now = effectiveNow || new Date()

  // Find all scheduled reminders that are due
  const dueReminders = await db.reminder.findMany({
    where: {
      status: 'scheduled',
      scheduledFor: { lte: now },
    },
    orderBy: { scheduledFor: 'asc' },
    take: 100, // Process in batches
  })

  console.log(`[reminders] Found ${dueReminders.length} due reminders`)

  for (const reminder of dueReminders) {
    // Acquire lock for this specific reminder to prevent duplicate processing
    const lockKey = `reminder:${reminder.id}`
    const lockToken = await acquireLock(lockKey, 60000) // 1 minute TTL

    if (!lockToken) {
      // Another worker is processing this reminder
      console.log(`[reminders] Skipping reminder ${reminder.id} - locked by another worker`)
      continue
    }

    result.processed++

    try {
      // Double-check the reminder is still scheduled (another worker may have processed it)
      const currentReminder = await db.reminder.findUnique({
        where: { id: reminder.id },
      })

      if (!currentReminder || currentReminder.status !== 'scheduled') {
        console.log(`[reminders] Skipping reminder ${reminder.id} - already processed`)
        await releaseLock(lockKey, lockToken)
        continue
      }

      const sent = await processReminder(reminder)

      if (sent) {
        await db.reminder.update({
          where: { id: reminder.id },
          data: {
            status: 'sent',
            sentAt: now,
          },
        })
        result.sent++

        // Log successful reminder
        logReminderSent({
          reminderId: reminder.id,
          type: reminder.type,
          channel: reminder.channel,
          userId: reminder.userId,
          entityType: reminder.entityType,
          entityId: reminder.entityId,
        })
      } else {
        // Mark as canceled if entity no longer needs reminder
        await db.reminder.update({
          where: { id: reminder.id },
          data: { status: 'canceled' },
        })
      }
    } catch (error: any) {
      result.failed++
      result.errors.push({
        reminderId: reminder.id,
        error: error.message || 'Unknown error',
      })

      // Log failed reminder
      logReminderFailed({
        reminderId: reminder.id,
        type: reminder.type,
        userId: reminder.userId,
        error: error.message || 'Unknown error',
      })

      // Update retry count
      await db.reminder.update({
        where: { id: reminder.id },
        data: {
          retryCount: { increment: 1 },
          errorMessage: error.message || 'Unknown error',
          // Mark as failed after 3 retries
          status: reminder.retryCount >= 2 ? 'failed' : 'scheduled',
          // Retry in 1 hour
          scheduledFor: new Date(now.getTime() + 60 * 60 * 1000),
        },
      })

      console.error(`[reminders] Failed to process reminder ${reminder.id}:`, error.message)
    } finally {
      await releaseLock(lockKey, lockToken)
    }
  }

  console.log(`[reminders] Processed: ${result.sent} sent, ${result.failed} failed`)
  return result
}
