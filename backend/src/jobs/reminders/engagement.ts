/**
 * Engagement Reminder Scheduling
 *
 * Reminders for user engagement and onboarding:
 * - Onboarding incomplete (24h, 72h)
 * - No subscribers after 7 days
 */

import { scheduleReminder, cancelAllRemindersForEntity } from './core.js'

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
