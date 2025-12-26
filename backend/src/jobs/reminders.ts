/**
 * Reminder System - Legacy Export
 *
 * This file re-exports from the modularized reminders/ directory.
 * Import from './reminders/index.js' for new code.
 *
 * @deprecated Import from './reminders/index.js' instead
 */

export {
  // Types
  type ReminderResult,
  type ScheduleReminderParams,
  type CancelReminderParams,
  type CancelAllRemindersParams,
  SMS_ELIGIBLE_TYPES,

  // Core
  scheduleReminder,
  cancelReminder,
  cancelAllRemindersForEntity,

  // Request
  scheduleRequestReminders,
  scheduleRequestUnpaidReminder,

  // Engagement
  scheduleOnboardingReminders,
  cancelOnboardingReminders,
  scheduleNoSubscribersReminder,

  // Subscription
  scheduleSubscriptionRenewalReminders,
  schedulePaymentFailedReminder,
  schedulePastDueReminder,
  cancelSubscriptionReminders,

  // Processor
  processDueReminders,

  // Recovery
  scanAndScheduleMissedReminders,
} from './reminders/index.js'

// Default export for backwards compatibility
import {
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
} from './reminders/index.js'

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
