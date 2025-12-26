/**
 * Reminder System Types
 */

import type { ReminderType, ReminderChannel } from '@prisma/client'

export interface ReminderResult {
  processed: number
  sent: number
  failed: number
  errors: Array<{ reminderId: string; error: string }>
}

export interface ScheduleReminderParams {
  userId: string
  type: ReminderType
  scheduledFor: Date
  entityType: 'request' | 'invoice' | 'payout' | 'subscription' | 'payroll' | 'onboarding' | 'user'
  entityId: string
  channel?: ReminderChannel
}

export interface CancelReminderParams {
  userId: string
  type: ReminderType
  entityType: string
  entityId: string
}

export interface CancelAllRemindersParams {
  entityType: 'request' | 'invoice' | 'payout' | 'subscription' | 'payroll' | 'onboarding' | 'user'
  entityId: string
}

// Reminder types that are eligible for SMS delivery
export const SMS_ELIGIBLE_TYPES: ReminderType[] = [
  'invoice_due_1d',
  'invoice_overdue_1d',
  'invoice_overdue_7d',
  'request_expiring',
  'payout_completed',
  'payout_failed',
  'bank_setup_incomplete',
]
