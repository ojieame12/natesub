/**
 * Reminders Module
 *
 * Unified scheduler and processor for all application reminders.
 * Run hourly via cron to process due reminders.
 * Supports multi-channel: email (default), SMS (for African markets).
 */

// Types
export * from './types.js'
export type { ReminderResult } from './processor/index.js'

// Core scheduling primitives
export {
  scheduleReminder,
  cancelReminder,
  cancelAllRemindersForEntity,
  isRequestValidForReminder,
  getBestChannel,
} from './core.js'

// Request/Invoice reminder scheduling
export {
  scheduleRequestReminders,
  scheduleRequestUnpaidReminder,
} from './request.js'

// Engagement reminder scheduling
export {
  scheduleOnboardingReminders,
  cancelOnboardingReminders,
  scheduleNoSubscribersReminder,
} from './engagement.js'

// Subscription reminder scheduling
export {
  scheduleSubscriptionRenewalReminders,
  schedulePaymentFailedReminder,
  schedulePastDueReminder,
  cancelSubscriptionReminders,
} from './subscription.js'

// Main processor (cron entry point)
export { processDueReminders } from './processor/index.js'

// Recovery (one-time setup)
export { scanAndScheduleMissedReminders } from './recovery.js'
