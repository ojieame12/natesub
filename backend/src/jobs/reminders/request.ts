/**
 * Request/Invoice Reminder Scheduling
 *
 * Schedules reminders for payment requests and invoices:
 * - Unopened request reminders (24h, 72h)
 * - Unpaid request reminder (3d after viewing)
 * - Expiry reminder (24h before token expires)
 * - Invoice due reminders (7d, 3d, 1d before)
 * - Invoice overdue reminders (1d, 7d after)
 */

import { db } from '../../db/client.js'
import { scheduleReminder, cancelReminder } from './core.js'

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
