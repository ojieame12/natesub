/**
 * System Logging Service
 *
 * Centralized logging for admin monitoring:
 * - Emails sent/failed
 * - Reminders triggered
 * - Updates sent
 * - User errors
 * - Payment events
 */

import { db } from '../db/client.js'
import type { SystemLogType, SystemLogLevel } from '@prisma/client'

interface LogOptions {
  type: SystemLogType
  level?: SystemLogLevel
  userId?: string
  entityType?: string
  entityId?: string
  message: string
  metadata?: Record<string, any>
  errorCode?: string
  errorMessage?: string
  stackTrace?: string
}

/**
 * Write a system log entry
 * Non-blocking - failures are logged to console but don't throw
 */
export async function logSystem(options: LogOptions): Promise<void> {
  try {
    await db.systemLog.create({
      data: {
        type: options.type,
        level: options.level || 'info',
        userId: options.userId,
        entityType: options.entityType,
        entityId: options.entityId,
        message: options.message,
        metadata: options.metadata,
        errorCode: options.errorCode,
        errorMessage: options.errorMessage,
        stackTrace: options.stackTrace,
      },
    })
  } catch (err) {
    // Don't let logging failures break the app
    console.error('[systemLog] Failed to write log:', err)
  }
}

// ============================================
// EMAIL LOGGING
// ============================================

export async function logEmailSent(params: {
  to: string
  subject: string
  template: string
  messageId?: string
  userId?: string
}): Promise<void> {
  await logSystem({
    type: 'email_sent',
    level: 'info',
    userId: params.userId,
    message: `Email sent: ${params.subject}`,
    metadata: {
      to: params.to,
      subject: params.subject,
      template: params.template,
      messageId: params.messageId,
    },
  })
}

export async function logEmailFailed(params: {
  to: string
  subject: string
  template: string
  error: string
  userId?: string
}): Promise<void> {
  await logSystem({
    type: 'email_failed',
    level: 'error',
    userId: params.userId,
    message: `Email failed: ${params.subject}`,
    metadata: {
      to: params.to,
      subject: params.subject,
      template: params.template,
    },
    errorMessage: params.error,
  })
}

// ============================================
// REMINDER LOGGING
// ============================================

export async function logReminderSent(params: {
  reminderId: string
  type: string
  channel: string
  userId: string
  entityType: string
  entityId: string
}): Promise<void> {
  await logSystem({
    type: 'reminder_sent',
    level: 'info',
    userId: params.userId,
    entityType: params.entityType,
    entityId: params.entityId,
    message: `Reminder sent: ${params.type} via ${params.channel}`,
    metadata: {
      reminderId: params.reminderId,
      reminderType: params.type,
      channel: params.channel,
    },
  })
}

export async function logReminderFailed(params: {
  reminderId: string
  type: string
  userId: string
  error: string
}): Promise<void> {
  await logSystem({
    type: 'reminder_failed',
    level: 'error',
    userId: params.userId,
    message: `Reminder failed: ${params.type}`,
    metadata: {
      reminderId: params.reminderId,
      reminderType: params.type,
    },
    errorMessage: params.error,
  })
}

// ============================================
// UPDATE LOGGING
// ============================================

export async function logUpdateSent(params: {
  updateId: string
  creatorId: string
  recipientCount: number
  title?: string
}): Promise<void> {
  await logSystem({
    type: 'update_sent',
    level: 'info',
    userId: params.creatorId,
    entityType: 'update',
    entityId: params.updateId,
    message: `Update sent to ${params.recipientCount} subscribers`,
    metadata: {
      recipientCount: params.recipientCount,
      title: params.title,
    },
  })
}

// ============================================
// INVOICE LOGGING
// ============================================

export async function logInvoiceCreated(params: {
  requestId: string
  creatorId: string
  amountCents: number
  currency: string
  recipientEmail?: string
}): Promise<void> {
  await logSystem({
    type: 'invoice_created',
    level: 'info',
    userId: params.creatorId,
    entityType: 'request',
    entityId: params.requestId,
    message: `Invoice created: ${params.amountCents} ${params.currency}`,
    metadata: {
      amountCents: params.amountCents,
      currency: params.currency,
      recipientEmail: params.recipientEmail,
    },
  })
}

export async function logInvoiceSent(params: {
  requestId: string
  creatorId: string
  recipientEmail: string
}): Promise<void> {
  await logSystem({
    type: 'invoice_sent',
    level: 'info',
    userId: params.creatorId,
    entityType: 'request',
    entityId: params.requestId,
    message: `Invoice sent to ${params.recipientEmail}`,
    metadata: {
      recipientEmail: params.recipientEmail,
    },
  })
}

// ============================================
// ERROR LOGGING
// ============================================

export async function logUserError(params: {
  userId?: string
  error: Error | string
  context?: string
  metadata?: Record<string, any>
}): Promise<void> {
  const err = params.error instanceof Error ? params.error : new Error(String(params.error))

  await logSystem({
    type: 'user_error',
    level: 'error',
    userId: params.userId,
    message: params.context ? `${params.context}: ${err.message}` : err.message,
    metadata: params.metadata,
    errorMessage: err.message,
    stackTrace: err.stack,
  })
}

export async function logPaymentError(params: {
  userId?: string
  subscriptionId?: string
  paymentId?: string
  error: Error | string
  provider?: string
}): Promise<void> {
  const err = params.error instanceof Error ? params.error : new Error(String(params.error))

  await logSystem({
    type: 'payment_error',
    level: 'error',
    userId: params.userId,
    entityType: params.subscriptionId ? 'subscription' : 'payment',
    entityId: params.subscriptionId || params.paymentId,
    message: `Payment error: ${err.message}`,
    metadata: {
      provider: params.provider,
      subscriptionId: params.subscriptionId,
      paymentId: params.paymentId,
    },
    errorMessage: err.message,
    stackTrace: err.stack,
  })
}

export async function logWebhookError(params: {
  provider: string
  eventType: string
  eventId: string
  error: Error | string
}): Promise<void> {
  const err = params.error instanceof Error ? params.error : new Error(String(params.error))

  await logSystem({
    type: 'webhook_error',
    level: 'error',
    message: `Webhook error: ${params.provider} ${params.eventType}`,
    metadata: {
      provider: params.provider,
      eventType: params.eventType,
      eventId: params.eventId,
    },
    errorMessage: err.message,
    stackTrace: err.stack,
  })
}

// ============================================
// PAYOUT LOGGING
// ============================================

export async function logPayoutInitiated(params: {
  paymentId: string
  userId: string
  amountCents: number
  currency: string
  provider: string
}): Promise<void> {
  await logSystem({
    type: 'payout_initiated',
    level: 'info',
    userId: params.userId,
    entityType: 'payment',
    entityId: params.paymentId,
    message: `Payout initiated: ${params.amountCents} ${params.currency} via ${params.provider}`,
    metadata: {
      amountCents: params.amountCents,
      currency: params.currency,
      provider: params.provider,
    },
  })
}

export async function logPayoutCompleted(params: {
  paymentId: string
  userId: string
  amountCents: number
  currency: string
}): Promise<void> {
  await logSystem({
    type: 'payout_completed',
    level: 'info',
    userId: params.userId,
    entityType: 'payment',
    entityId: params.paymentId,
    message: `Payout completed: ${params.amountCents} ${params.currency}`,
    metadata: {
      amountCents: params.amountCents,
      currency: params.currency,
    },
  })
}

export async function logPayoutFailed(params: {
  paymentId: string
  userId: string
  amountCents: number
  currency: string
  error: string
}): Promise<void> {
  await logSystem({
    type: 'payout_failed',
    level: 'error',
    userId: params.userId,
    entityType: 'payment',
    entityId: params.paymentId,
    message: `Payout failed: ${params.amountCents} ${params.currency}`,
    metadata: {
      amountCents: params.amountCents,
      currency: params.currency,
    },
    errorMessage: params.error,
  })
}
