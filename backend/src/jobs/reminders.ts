/**
 * Reminder System
 *
 * Unified scheduler and processor for all application reminders.
 * Run hourly via cron to process due reminders.
 * Supports multi-channel: email (default), SMS (for African markets).
 *
 * MODULE STRUCTURE:
 * ─────────────────
 * Lines 40-65:     Helpers & Types
 * Lines 66-222:    Core Scheduler (scheduleReminder, cancelReminder, cancelAllRemindersForEntity)
 * Lines 225-384:   Request Reminders (unopened, unpaid, expiring)
 * Lines 388-443:   Engagement Reminders (onboarding, no-subscribers)
 * Lines 445-586:   Subscription Reminders (renewal, payment failed, past due)
 * Lines 588-707:   Main Processor (processDueReminders - the cron job entry point)
 * Lines 710-889:   Notification Preferences & Router
 * Lines 892-1315:  Individual Reminder Processors (one per reminder type)
 * Lines 1318-1377: Recovery (scanAndScheduleMissedReminders)
 * Lines 1380+:     Subscription Processors
 *
 * FUTURE: Consider splitting into reminders/core.ts, reminders/request.ts, etc.
 *         See types at: src/jobs/reminders/types.ts
 */

import { db } from '../db/client.js'
import { env } from '../config/env.js'
import type { ReminderType, ReminderChannel } from '@prisma/client'
import {
  sendRequestUnopenedEmail,
  sendRequestUnpaidEmail,
  sendRequestExpiringEmail,
  sendInvoiceDueEmail,
  sendInvoiceOverdueEmail,
  sendPayoutCompletedEmail,
  sendPayoutFailedEmail,
  sendPayrollReadyEmail,
  sendOnboardingIncompleteEmail,
  sendBankSetupIncompleteEmail,
  sendNoSubscribersEmail,
  sendRenewalReminderEmail,
  sendPaymentFailedEmail,
} from '../services/email.js'
import { calculateServiceFee, calculateLegacyServiceFee } from '../services/fees.js'
import { isStripeCrossBorderSupported } from '../utils/constants.js'
import {
  isSmsEnabled,
  shouldUseSms,
  sendRequestReminderSms,
  sendInvoiceDueSms,
  sendInvoiceOverdueSms,
  sendPayoutCompletedSms,
  sendPayoutFailedSms,
  sendBankSetupReminderSms,
} from '../services/sms.js'
import { decrypt, decryptAccountNumber } from '../utils/encryption.js'
import { acquireLock, releaseLock } from '../services/lock.js'
import { logReminderSent, logReminderFailed } from '../services/systemLog.js'
import { generateCancelUrl } from '../utils/cancelToken.js'

// ============================================
// HELPERS
// ============================================

/**
 * Check if a request is still valid for reminders
 * Returns false if expired or not in 'sent' status
 */
function isRequestValidForReminder(request: { status: string; tokenExpiresAt: Date | null } | null): boolean {
  if (!request) return false
  if (request.status !== 'sent') return false
  if (request.tokenExpiresAt && request.tokenExpiresAt < new Date()) return false
  return true
}

// ============================================
// TYPES
// ============================================

interface ReminderResult {
  processed: number
  sent: number
  failed: number
  errors: Array<{ reminderId: string; error: string }>
}

// ============================================
// REMINDER SCHEDULING
// ============================================

/**
 * Determine the best channel for a user based on their country
 * African markets (NG, KE, ZA, GH, TZ, UG) prefer SMS for payment-critical messages
 */
async function getBestChannel(userId: string, reminderType: ReminderType): Promise<ReminderChannel> {
  // Only use SMS for payment-critical reminders
  const smsEligibleTypes: ReminderType[] = [
    'invoice_due_1d',
    'invoice_overdue_1d',
    'invoice_overdue_7d',
    'request_expiring',
    'payout_completed',
    'payout_failed',
    'bank_setup_incomplete',
  ]

  if (!smsEligibleTypes.includes(reminderType)) {
    return 'email'
  }

  if (!isSmsEnabled()) {
    return 'email'
  }

  // Get user's country from profile
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { countryCode: true },
  })

  if (profile && shouldUseSms(profile.countryCode)) {
    return 'sms'
  }

  return 'email'
}

/**
 * Schedule a reminder for future sending
 * Uses upsert to prevent duplicates (unique constraint on entityType + entityId + type)
 * Auto-detects best channel (SMS for African markets on critical reminders)
 * Uses distributed lock to prevent TOCTOU race conditions
 */
export async function scheduleReminder(params: {
  userId: string
  entityType: string
  entityId: string
  type: ReminderType
  scheduledFor: Date
  channel?: 'email' | 'sms' | 'push'
}): Promise<void> {
  const { userId, entityType, entityId, type, scheduledFor } = params

  // Auto-detect channel if not specified
  const channel = params.channel || await getBestChannel(userId, type)

  // Use distributed lock to prevent TOCTOU race between check and upsert
  const lockKey = `reminder:schedule:${entityType}:${entityId}:${type}`
  const lockToken = await acquireLock(lockKey, 10000) // 10 second TTL

  if (!lockToken) {
    console.log(`[reminders] Could not acquire lock for ${lockKey}, skipping`)
    return
  }

  try {
    // Check if reminder exists and is already sent (inside lock)
    const existing = await db.reminder.findUnique({
      where: {
        entityType_entityId_type: {
          entityType,
          entityId,
          type,
        },
      },
    })

    // Don't resurrect already-sent reminders
    if (existing && existing.status === 'sent') {
      return
    }

    await db.reminder.upsert({
      where: {
        entityType_entityId_type: {
          entityType,
          entityId,
          type,
        },
      },
      create: {
        userId,
        entityType,
        entityId,
        type,
        channel,
        scheduledFor,
        status: 'scheduled',
      },
      update: {
        // Only update scheduledFor, don't change status if already sent
        scheduledFor,
        // Only set to scheduled if currently canceled (allow rescheduling)
        ...(existing?.status === 'canceled' && { status: 'scheduled' }),
      },
    })
  } finally {
    await releaseLock(lockKey, lockToken)
  }
}

/**
 * Cancel a scheduled reminder (e.g., when user takes action before reminder fires)
 */
export async function cancelReminder(params: {
  entityType: string
  entityId: string
  type: ReminderType
}): Promise<void> {
  const { entityType, entityId, type } = params

  await db.reminder.updateMany({
    where: {
      entityType,
      entityId,
      type,
      status: 'scheduled',
    },
    data: {
      status: 'canceled',
    },
  })
}

/**
 * Cancel all reminders for an entity (e.g., when request is accepted)
 */
export async function cancelAllRemindersForEntity(params: {
  entityType: string
  entityId: string
}): Promise<void> {
  const { entityType, entityId } = params

  await db.reminder.updateMany({
    where: {
      entityType,
      entityId,
      status: 'scheduled',
    },
    data: {
      status: 'canceled',
    },
  })
}

// ============================================
// REQUEST/INVOICE REMINDER SCHEDULING
// ============================================

/**
 * Schedule reminders when a request is sent
 * Call this from the request routes when status changes to 'sent'
 */
export async function scheduleRequestReminders(requestId: string): Promise<void> {
  const request = await db.request.findUnique({
    where: { id: requestId },
    include: {
      creator: {
        include: { profile: true },
      },
    },
  })

  // Don't schedule email reminders if:
  // - No request found
  // - sendMethod is 'link' (creator chose to share link manually, not email)
  // - No email or phone to send to
  if (!request) return
  if (request.sendMethod === 'link') {
    console.log(`[reminders] Skipping reminders for request ${requestId} - sendMethod is 'link'`)
    return
  }
  if (!request.recipientEmail && !request.recipientPhone) return

  const now = new Date()

  // For requests with no userId (recipient not a user), use creator's ID for tracking
  const userId = request.creatorId

  // Schedule 24h reminder
  await scheduleReminder({
    userId,
    entityType: 'request',
    entityId: requestId,
    type: 'request_unopened_24h',
    scheduledFor: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  })

  // Schedule 72h reminder
  await scheduleReminder({
    userId,
    entityType: 'request',
    entityId: requestId,
    type: 'request_unopened_72h',
    scheduledFor: new Date(now.getTime() + 72 * 60 * 60 * 1000),
  })

  // Schedule expiry reminder (24h before token expires)
  if (request.tokenExpiresAt) {
    const expiryReminderTime = new Date(request.tokenExpiresAt.getTime() - 24 * 60 * 60 * 1000)
    if (expiryReminderTime > now) {
      await scheduleReminder({
        userId,
        entityType: 'request',
        entityId: requestId,
        type: 'request_expiring',
        scheduledFor: expiryReminderTime,
      })
    }
  }

  // If it's an invoice with a due date, schedule due date reminders
  if (request.dueDate) {
    const dueDate = new Date(request.dueDate)

    // 7 days before
    const sevenDaysBefore = new Date(dueDate.getTime() - 7 * 24 * 60 * 60 * 1000)
    if (sevenDaysBefore > now) {
      await scheduleReminder({
        userId,
        entityType: 'request',
        entityId: requestId,
        type: 'invoice_due_7d',
        scheduledFor: sevenDaysBefore,
      })
    }

    // 3 days before
    const threeDaysBefore = new Date(dueDate.getTime() - 3 * 24 * 60 * 60 * 1000)
    if (threeDaysBefore > now) {
      await scheduleReminder({
        userId,
        entityType: 'request',
        entityId: requestId,
        type: 'invoice_due_3d',
        scheduledFor: threeDaysBefore,
      })
    }

    // 1 day before
    const oneDayBefore = new Date(dueDate.getTime() - 24 * 60 * 60 * 1000)
    if (oneDayBefore > now) {
      await scheduleReminder({
        userId,
        entityType: 'request',
        entityId: requestId,
        type: 'invoice_due_1d',
        scheduledFor: oneDayBefore,
      })
    }

    // 1 day after (overdue)
    await scheduleReminder({
      userId,
      entityType: 'request',
      entityId: requestId,
      type: 'invoice_overdue_1d',
      scheduledFor: new Date(dueDate.getTime() + 24 * 60 * 60 * 1000),
    })

    // 7 days after (overdue)
    await scheduleReminder({
      userId,
      entityType: 'request',
      entityId: requestId,
      type: 'invoice_overdue_7d',
      scheduledFor: new Date(dueDate.getTime() + 7 * 24 * 60 * 60 * 1000),
    })
  }

  console.log(`[reminders] Scheduled reminders for request ${requestId}`)
}

/**
 * Schedule "request not paid" reminder when request is viewed but not paid
 * Call this when PageView.reachedPayment becomes true
 */
export async function scheduleRequestUnpaidReminder(requestId: string): Promise<void> {
  const request = await db.request.findUnique({
    where: { id: requestId },
  })

  if (!request || request.status !== 'sent') return

  const now = new Date()

  // Cancel unopened reminders (they've opened it)
  await cancelReminder({
    entityType: 'request',
    entityId: requestId,
    type: 'request_unopened_24h',
  })
  await cancelReminder({
    entityType: 'request',
    entityId: requestId,
    type: 'request_unopened_72h',
  })

  // Schedule unpaid reminder for 3 days later
  await scheduleReminder({
    userId: request.creatorId,
    entityType: 'request',
    entityId: requestId,
    type: 'request_unpaid_3d',
    scheduledFor: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
  })
}

// ============================================
// ONBOARDING REMINDER SCHEDULING
// ============================================

/**
 * Schedule onboarding reminders when a user signs up but doesn't complete
 * Call this after user creation if no profile exists
 */
export async function scheduleOnboardingReminders(userId: string): Promise<void> {
  const now = new Date()

  // 24h reminder
  await scheduleReminder({
    userId,
    entityType: 'profile',
    entityId: userId,
    type: 'onboarding_incomplete_24h',
    scheduledFor: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  })

  // 72h reminder
  await scheduleReminder({
    userId,
    entityType: 'profile',
    entityId: userId,
    type: 'onboarding_incomplete_72h',
    scheduledFor: new Date(now.getTime() + 72 * 60 * 60 * 1000),
  })

  console.log(`[reminders] Scheduled onboarding reminders for user ${userId}`)
}

/**
 * Cancel onboarding reminders when profile is completed
 */
export async function cancelOnboardingReminders(userId: string): Promise<void> {
  await cancelAllRemindersForEntity({
    entityType: 'profile',
    entityId: userId,
  })
}

/**
 * Schedule "no subscribers" reminder 7 days after profile creation
 */
export async function scheduleNoSubscribersReminder(userId: string): Promise<void> {
  const now = new Date()

  await scheduleReminder({
    userId,
    entityType: 'profile',
    entityId: userId,
    type: 'no_subscribers_7d',
    scheduledFor: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
  })
}

// ============================================
// SUBSCRIPTION RENEWAL REMINDERS
// ============================================

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
  retryDate: Date | null
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

// ============================================
// REMINDER PROCESSING (CRON JOB)
// ============================================

/**
 * Process all due reminders
 * Run this hourly via cron
 * Uses distributed locking to prevent duplicate processing across workers
 */
export async function processDueReminders(): Promise<ReminderResult> {
  const result: ReminderResult = {
    processed: 0,
    sent: 0,
    failed: 0,
    errors: [],
  }

  const now = new Date()

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
// Pre-billing notifications must be sent; cannot be opted out of
const SYSTEM_ALERT_TYPES: ReminderType[] = [
  'onboarding_incomplete_24h',
  'onboarding_incomplete_72h',
  'bank_setup_incomplete',
  'no_subscribers_7d',
  'payroll_ready',
  // Visa VAMP compliance: pre-billing notifications are legally required
  // Subscribers cannot opt out of these (FTC Negative Option Rule compliance)
  'subscription_renewal_7d',
  'subscription_renewal_3d',
  'subscription_renewal_1d',
  'subscription_payment_failed',
  'subscription_past_due',
]

/**
 * Check if user has opted in to receive this type of notification
 * Returns true if reminder should be sent, false to skip
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

/**
 * Process a single reminder - returns true if message was sent
 * Routes to email or SMS based on reminder channel
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
// INDIVIDUAL REMINDER PROCESSORS
// ============================================

async function processRequestUnopenedReminder(
  requestId: string,
  isSecondReminder: boolean,
  channel: ReminderChannel
): Promise<boolean> {
  const request = await db.request.findUnique({
    where: { id: requestId },
    include: {
      creator: { include: { profile: true } },
    },
  })

  // Don't send if request is no longer pending, missing recipient, or expired
  if (!request || !isRequestValidForReminder(request)) {
    return false
  }

  const senderName = request.creator.profile?.displayName || 'Someone'

  // Get request link from decrypted token (not the hash!)
  const rawToken = request.publicToken ? decrypt(request.publicToken) : null
  if (!rawToken) {
    console.warn(`[reminders] Request ${requestId} missing publicToken, cannot generate link`)
    return false
  }
  const requestLink = `${env.PUBLIC_PAGE_URL}/r/${rawToken}`

  if (channel === 'sms' && request.recipientPhone) {
    await sendRequestReminderSms(request.recipientPhone, senderName, isSecondReminder)
  } else if (request.recipientEmail) {
    await sendRequestUnopenedEmail(
      request.recipientEmail,
      senderName,
      requestLink,
      isSecondReminder
    )
  } else {
    return false
  }

  return true
}

async function processRequestUnpaidReminder(
  requestId: string,
  channel: ReminderChannel
): Promise<boolean> {
  const request = await db.request.findUnique({
    where: { id: requestId },
    include: {
      creator: { include: { profile: true } },
    },
  })

  // Don't send if already paid, declined, or expired
  if (!request || !isRequestValidForReminder(request)) {
    return false
  }

  const senderName = request.creator.profile?.displayName || 'Someone'

  // Get request link from decrypted token
  const rawToken = request.publicToken ? decrypt(request.publicToken) : null
  if (!rawToken) {
    console.warn(`[reminders] Request ${requestId} missing publicToken, cannot generate link`)
    return false
  }
  const requestLink = `${env.PUBLIC_PAGE_URL}/r/${rawToken}`

  if (channel === 'sms' && request.recipientPhone) {
    // For unpaid, use the invoice due SMS as it's more appropriate
    await sendInvoiceDueSms(
      request.recipientPhone,
      senderName,
      request.amountCents,
      request.currency,
      3 // 3 days urgency
    )
  } else if (request.recipientEmail) {
    await sendRequestUnpaidEmail(
      request.recipientEmail,
      senderName,
      request.amountCents,
      request.currency,
      requestLink
    )
  } else {
    return false
  }

  return true
}

async function processRequestExpiringReminder(
  requestId: string,
  channel: ReminderChannel
): Promise<boolean> {
  const request = await db.request.findUnique({
    where: { id: requestId },
    include: {
      creator: { include: { profile: true } },
    },
  })

  // Don't send if already responded or expired
  if (!request || !isRequestValidForReminder(request)) {
    return false
  }

  const senderName = request.creator.profile?.displayName || 'Someone'

  // Get request link from decrypted token
  const rawToken = request.publicToken ? decrypt(request.publicToken) : null
  if (!rawToken) {
    console.warn(`[reminders] Request ${requestId} missing publicToken, cannot generate link`)
    return false
  }
  const requestLink = `${env.PUBLIC_PAGE_URL}/r/${rawToken}`

  if (channel === 'sms' && request.recipientPhone) {
    await sendRequestReminderSms(request.recipientPhone, senderName, true) // urgent
  } else if (request.recipientEmail) {
    await sendRequestExpiringEmail(request.recipientEmail, senderName, requestLink)
  } else {
    return false
  }

  return true
}

async function processInvoiceDueReminder(
  requestId: string,
  daysUntilDue: number,
  channel: ReminderChannel
): Promise<boolean> {
  const request = await db.request.findUnique({
    where: { id: requestId },
    include: {
      creator: { include: { profile: true } },
    },
  })

  // Don't send if already paid, no due date, or token expired
  if (!request || !isRequestValidForReminder(request) || !request.dueDate) {
    return false
  }

  const senderName = request.creator.profile?.displayName || 'Someone'

  // Get request link from decrypted token
  const rawToken = request.publicToken ? decrypt(request.publicToken) : null
  if (!rawToken) {
    console.warn(`[reminders] Request ${requestId} missing publicToken, cannot generate link`)
    return false
  }
  const requestLink = `${env.PUBLIC_PAGE_URL}/r/${rawToken}`

  if (channel === 'sms' && request.recipientPhone) {
    await sendInvoiceDueSms(
      request.recipientPhone,
      senderName,
      request.amountCents,
      request.currency,
      daysUntilDue
    )
  } else if (request.recipientEmail) {
    await sendInvoiceDueEmail(
      request.recipientEmail,
      senderName,
      request.amountCents,
      request.currency,
      request.dueDate,
      daysUntilDue,
      requestLink
    )
  } else {
    return false
  }

  return true
}

async function processInvoiceOverdueReminder(
  requestId: string,
  daysOverdue: number,
  channel: ReminderChannel
): Promise<boolean> {
  const request = await db.request.findUnique({
    where: { id: requestId },
    include: {
      creator: { include: { profile: true } },
    },
  })

  // Don't send if already paid, no due date, or token expired
  if (!request || !isRequestValidForReminder(request) || !request.dueDate) {
    return false
  }

  const senderName = request.creator.profile?.displayName || 'Someone'

  // Get request link from decrypted token
  const rawToken = request.publicToken ? decrypt(request.publicToken) : null
  if (!rawToken) {
    console.warn(`[reminders] Request ${requestId} missing publicToken, cannot generate link`)
    return false
  }
  const requestLink = `${env.PUBLIC_PAGE_URL}/r/${rawToken}`

  if (channel === 'sms' && request.recipientPhone) {
    await sendInvoiceOverdueSms(
      request.recipientPhone,
      senderName,
      request.amountCents,
      request.currency,
      daysOverdue
    )
  } else if (request.recipientEmail) {
    await sendInvoiceOverdueEmail(
      request.recipientEmail,
      senderName,
      request.amountCents,
      request.currency,
      request.dueDate,
      daysOverdue,
      requestLink
    )
  } else {
    return false
  }

  return true
}

async function processPayoutCompletedReminder(
  paymentId: string,
  channel: ReminderChannel
): Promise<boolean> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
  })

  if (!payment || payment.type !== 'payout' || payment.status !== 'succeeded') {
    return false
  }

  const user = await db.user.findUnique({
    where: { id: payment.creatorId },
    include: { profile: true },
  })

  if (!user || !user.profile) return false

  // Get phone number for SMS (stored in profile)
  const phone = user.profile.phone || null

  // Decrypt account number and get last 4 digits
  const accountNumber = decryptAccountNumber(user.profile.paystackAccountNumber)
  const bankLast4 = accountNumber?.slice(-4) || null

  if (channel === 'sms' && phone) {
    await sendPayoutCompletedSms(phone, payment.amountCents, payment.currency)
  } else {
    await sendPayoutCompletedEmail(
      user.email,
      user.profile.displayName,
      payment.amountCents,
      payment.currency,
      bankLast4
    )
  }

  return true
}

async function processPayoutFailedReminder(
  paymentId: string,
  channel: ReminderChannel
): Promise<boolean> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
  })

  if (!payment || payment.type !== 'payout' || payment.status !== 'failed') {
    return false
  }

  const user = await db.user.findUnique({
    where: { id: payment.creatorId },
    include: { profile: true },
  })

  if (!user || !user.profile) return false

  // Get phone number for SMS (stored in profile)
  const phone = user.profile.phone || null

  if (channel === 'sms' && phone) {
    await sendPayoutFailedSms(phone, payment.amountCents, payment.currency)
  } else {
    await sendPayoutFailedEmail(
      user.email,
      user.profile.displayName,
      payment.amountCents,
      payment.currency
    )
  }

  return true
}

async function processPayrollReadyReminder(payrollPeriodId: string): Promise<boolean> {
  const period = await db.payrollPeriod.findUnique({
    where: { id: payrollPeriodId },
    include: {
      user: { include: { profile: true } },
    },
  })

  if (!period || !period.user.profile) return false

  await sendPayrollReadyEmail(
    period.user.email,
    period.user.profile.displayName,
    period.periodStart,
    period.periodEnd,
    period.netCents,
    period.currency
  )

  return true
}

async function processOnboardingIncompleteReminder(
  userId: string,
  isSecondReminder: boolean
): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  })

  // Don't send if user has completed profile
  if (!user || user.profile) {
    return false
  }

  await sendOnboardingIncompleteEmail(user.email, isSecondReminder)

  return true
}

async function processBankSetupIncompleteReminder(
  userId: string,
  channel: ReminderChannel
): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  })

  if (!user || !user.profile) return false

  // Check if bank details are missing
  const hasBankDetails =
    (user.profile.paymentProvider === 'paystack' && user.profile.paystackAccountNumber) ||
    (user.profile.paymentProvider === 'stripe' && user.profile.stripeAccountId)

  if (hasBankDetails) return false

  // Calculate pending earnings
  const pendingPayments = await db.payment.aggregate({
    where: {
      creatorId: userId,
      status: 'succeeded',
      type: { in: ['recurring', 'one_time'] },
    },
    _sum: { netCents: true },
  })

  const pendingAmount = pendingPayments._sum.netCents || 0
  if (pendingAmount === 0) return false

  // Get phone number for SMS (stored in profile)
  const phone = user.profile.phone || null

  if (channel === 'sms' && phone) {
    await sendBankSetupReminderSms(phone, pendingAmount, user.profile.currency)
  } else {
    await sendBankSetupIncompleteEmail(
      user.email,
      user.profile.displayName,
      pendingAmount,
      user.profile.currency
    )
  }

  return true
}

async function processNoSubscribersReminder(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  })

  if (!user || !user.profile) return false

  // Check if user has any subscribers
  const subscriberCount = await db.subscription.count({
    where: { creatorId: userId },
  })

  if (subscriberCount > 0) return false

  const shareUrl = user.profile.shareUrl || `${env.PUBLIC_PAGE_URL}/${user.profile.username}`

  await sendNoSubscribersEmail(user.email, user.profile.displayName, shareUrl)

  return true
}

// ============================================
// SCAN FOR MISSED REMINDERS (ONE-TIME SETUP)
// ============================================

/**
 * Scan for entities that should have reminders but don't
 * Run this once on deployment to catch any missed reminders
 */
export async function scanAndScheduleMissedReminders(): Promise<number> {
  let scheduled = 0
  const now = new Date()

  // Find sent requests without reminders
  const pendingRequests = await db.request.findMany({
    where: {
      status: 'sent',
      sentAt: { not: null },
    },
    select: { id: true },
  })

  for (const request of pendingRequests) {
    const existingReminder = await db.reminder.findFirst({
      where: {
        entityType: 'request',
        entityId: request.id,
      },
    })

    if (!existingReminder) {
      await scheduleRequestReminders(request.id)
      scheduled++
    }
  }

  // Find users without profiles (incomplete onboarding)
  const incompleteUsers = await db.user.findMany({
    where: {
      profile: null,
      createdAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) }, // Older than 24h
    },
    select: { id: true },
  })

  for (const user of incompleteUsers) {
    const existingReminder = await db.reminder.findFirst({
      where: {
        entityType: 'profile',
        entityId: user.id,
      },
    })

    if (!existingReminder) {
      await scheduleOnboardingReminders(user.id)
      scheduled++
    }
  }

  console.log(`[reminders] Scheduled ${scheduled} missed reminders`)
  return scheduled
}

// ============================================
// SUBSCRIPTION REMINDER PROCESSORS
// ============================================

async function processSubscriptionRenewalReminder(
  subscriptionId: string,
  daysUntilRenewal: number
): Promise<boolean> {
  const subscription = await db.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      subscriber: true,
      creator: {
        include: {
          profile: {
            select: {
              displayName: true,
              purpose: true,
              countryCode: true, // Needed for cross-border fee calculation
            },
          },
        },
      },
    },
  })

  // Don't send if subscription is no longer active
  if (!subscription || subscription.status !== 'active') {
    return false
  }

  // Don't send if pending cancellation
  if (subscription.cancelAtPeriodEnd) {
    return false
  }

  const providerName = subscription.creator.profile?.displayName || 'a creator'
  const renewalDate = subscription.currentPeriodEnd || new Date()

  // Calculate the fee-inclusive amount the subscriber actually pays
  // subscription.amount is the BASE amount - we need to add subscriber fees
  const baseAmount = subscription.amount
  let chargeAmount: number

  // Check cross-border status for correct fee buffer (NG/GH/KE have higher Stripe fees)
  const countryCode = subscription.creator?.profile?.countryCode
  const isCrossBorder = countryCode ? isStripeCrossBorderSupported(countryCode) : false

  if (subscription.feeModel === 'split_v1') {
    // Split model: subscriber pays base + 4% (or more for cross-border)
    const feeCalc = calculateServiceFee(
      baseAmount,
      subscription.currency,
      subscription.creator.profile?.purpose,
      undefined, // feeMode - not used for split_v1
      isCrossBorder
    )
    chargeAmount = feeCalc.grossCents
  } else if (subscription.feeModel && subscription.feeMode === 'pass_to_subscriber') {
    // Legacy pass_to_subscriber: subscriber pays base + 8%
    const legacyFee = calculateLegacyServiceFee(
      baseAmount,
      subscription.currency,
      subscription.creator.profile?.purpose as 'personal' | 'service' | null
    )
    chargeAmount = legacyFee.grossCents
  } else {
    // Legacy absorb or no feeModel: subscriber pays base only
    chargeAmount = baseAmount
  }

  // Generate signed cancel URL for 1-click cancellation without login
  // This is Visa-compliant: subscriber can easily cancel before being charged
  const cancelUrl = generateCancelUrl(subscriptionId)

  await sendRenewalReminderEmail(
    subscription.subscriber.email,
    providerName,
    chargeAmount,
    subscription.currency,
    renewalDate,
    cancelUrl
  )

  return true
}

async function processSubscriptionPaymentFailedReminder(
  subscriptionId: string
): Promise<boolean> {
  const subscription = await db.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      subscriber: true,
      creator: {
        include: {
          profile: {
            select: {
              displayName: true,
              purpose: true,
              countryCode: true, // Needed for cross-border fee calculation
            },
          },
        },
      },
    },
  })

  if (!subscription) return false

  const providerName = subscription.creator.profile?.displayName || 'a creator'

  // Calculate next retry date (24h from now if still retrying)
  const retryDate = subscription.status === 'active'
    ? new Date(Date.now() + 24 * 60 * 60 * 1000)
    : null

  // Calculate the fee-inclusive amount (same logic as renewal reminder)
  const baseAmount = subscription.amount
  let chargeAmount: number

  // Check cross-border status for correct fee buffer (NG/GH/KE have higher Stripe fees)
  const countryCode = subscription.creator?.profile?.countryCode
  const isCrossBorder = countryCode ? isStripeCrossBorderSupported(countryCode) : false

  if (subscription.feeModel === 'split_v1') {
    const feeCalc = calculateServiceFee(
      baseAmount,
      subscription.currency,
      subscription.creator.profile?.purpose,
      undefined, // feeMode - not used for split_v1
      isCrossBorder
    )
    chargeAmount = feeCalc.grossCents
  } else if (subscription.feeModel && subscription.feeMode === 'pass_to_subscriber') {
    const legacyFee = calculateLegacyServiceFee(
      baseAmount,
      subscription.currency,
      subscription.creator.profile?.purpose as 'personal' | 'service' | null
    )
    chargeAmount = legacyFee.grossCents
  } else {
    chargeAmount = baseAmount
  }

  await sendPaymentFailedEmail(
    subscription.subscriber.email,
    providerName,
    chargeAmount,
    subscription.currency,
    retryDate
  )

  return true
}

async function processSubscriptionPastDueReminder(
  subscriptionId: string
): Promise<boolean> {
  const subscription = await db.subscription.findUnique({
    where: { id: subscriptionId },
    include: {
      subscriber: true,
      creator: {
        include: {
          profile: {
            select: {
              displayName: true,
              purpose: true,
              countryCode: true, // Needed for cross-border fee calculation
            },
          },
        },
      },
    },
  })

  if (!subscription || subscription.status !== 'past_due') {
    return false
  }

  const providerName = subscription.creator.profile?.displayName || 'a creator'

  // Calculate the fee-inclusive amount (same logic as renewal reminder)
  const baseAmount = subscription.amount
  let chargeAmount: number

  // Check cross-border status for correct fee buffer (NG/GH/KE have higher Stripe fees)
  const countryCode = subscription.creator?.profile?.countryCode
  const isCrossBorder = countryCode ? isStripeCrossBorderSupported(countryCode) : false

  if (subscription.feeModel === 'split_v1') {
    const feeCalc = calculateServiceFee(
      baseAmount,
      subscription.currency,
      subscription.creator.profile?.purpose,
      undefined, // feeMode - not used for split_v1
      isCrossBorder
    )
    chargeAmount = feeCalc.grossCents
  } else if (subscription.feeModel && subscription.feeMode === 'pass_to_subscriber') {
    const legacyFee = calculateLegacyServiceFee(
      baseAmount,
      subscription.currency,
      subscription.creator.profile?.purpose as 'personal' | 'service' | null
    )
    chargeAmount = legacyFee.grossCents
  } else {
    chargeAmount = baseAmount
  }

  // Send payment failed with no retry date (indicating it's past due)
  await sendPaymentFailedEmail(
    subscription.subscriber.email,
    providerName,
    chargeAmount,
    subscription.currency,
    null // No more retries
  )

  return true
}

// Export for cron/scheduler
export default {
  processDueReminders,
  scanAndScheduleMissedReminders,
  scheduleRequestReminders,
  scheduleRequestUnpaidReminder,
  scheduleOnboardingReminders,
  cancelOnboardingReminders,
  scheduleNoSubscribersReminder,
  scheduleSubscriptionRenewalReminders,
  schedulePaymentFailedReminder,
  schedulePastDueReminder,
  cancelSubscriptionReminders,
  cancelReminder,
  cancelAllRemindersForEntity,
}
