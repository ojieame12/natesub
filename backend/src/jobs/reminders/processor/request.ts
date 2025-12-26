/**
 * Request/Invoice Reminder Processors
 *
 * Handles sending notifications for request and invoice reminders.
 */

import { db } from '../../../db/client.js'
import { env } from '../../../config/env.js'
import type { ReminderChannel } from '@prisma/client'
import {
  sendRequestUnopenedEmail,
  sendRequestUnpaidEmail,
  sendRequestExpiringEmail,
  sendInvoiceDueEmail,
  sendInvoiceOverdueEmail,
} from '../../../services/email.js'
import {
  sendRequestReminderSms,
  sendInvoiceDueSms,
  sendInvoiceOverdueSms,
} from '../../../services/sms.js'
import { decrypt } from '../../../utils/encryption.js'
import { isRequestValidForReminder } from '../core.js'

export async function processRequestUnopenedReminder(
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

export async function processRequestUnpaidReminder(
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

export async function processRequestExpiringReminder(
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

export async function processInvoiceDueReminder(
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

export async function processInvoiceOverdueReminder(
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
