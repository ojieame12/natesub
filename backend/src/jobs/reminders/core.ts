/**
 * Core Reminder Scheduling Functions
 *
 * Low-level primitives for scheduling, canceling, and managing reminders.
 * Used by domain-specific modules (request.ts, subscription.ts, etc.)
 */

import { db } from '../../db/client.js'
import type { ReminderType, ReminderChannel } from '@prisma/client'
import { isSmsEnabled, shouldUseSms } from '../../services/sms.js'
import { acquireLock, releaseLock } from '../../services/lock.js'

// ============================================
// HELPERS
// ============================================

/**
 * Check if a request is still valid for reminders
 * Returns false if expired or not in 'sent' status
 */
export function isRequestValidForReminder(
  request: { status: string; tokenExpiresAt: Date | null } | null
): boolean {
  if (!request) return false
  if (request.status !== 'sent') return false
  if (request.tokenExpiresAt && request.tokenExpiresAt < new Date()) return false
  return true
}

// ============================================
// CHANNEL SELECTION
// ============================================

// Reminder types eligible for SMS delivery
const SMS_ELIGIBLE_TYPES: ReminderType[] = [
  'invoice_due_1d',
  'invoice_overdue_1d',
  'invoice_overdue_7d',
  'request_expiring',
  'payout_completed',
  'payout_failed',
  'bank_setup_incomplete',
]

/**
 * Determine the best channel for a user based on their country
 * African markets (NG, KE, ZA, GH, TZ, UG) prefer SMS for payment-critical messages
 */
export async function getBestChannel(
  userId: string,
  reminderType: ReminderType
): Promise<ReminderChannel> {
  // Only use SMS for payment-critical reminders
  if (!SMS_ELIGIBLE_TYPES.includes(reminderType)) {
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

// ============================================
// CORE SCHEDULING
// ============================================

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
  const channel = params.channel || (await getBestChannel(userId, type))

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
