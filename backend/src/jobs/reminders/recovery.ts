/**
 * Reminder Recovery
 *
 * Scans for entities that should have reminders but don't.
 * Run once on deployment to catch any missed reminders.
 */

import { db } from '../../db/client.js'
import { scheduleRequestReminders } from './request.js'
import { scheduleOnboardingReminders } from './engagement.js'

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
