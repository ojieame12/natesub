/**
 * Dead Letter Queue (DLQ) Service
 *
 * Handles failed webhook processing by queuing events for retry.
 * Uses the webhookEvent table with 'failed' status for persistence.
 */

import { db } from '../db/client.js'

const MAX_RETRIES = 5
const RETRY_DELAYS = [
  60 * 1000,        // 1 minute
  5 * 60 * 1000,    // 5 minutes
  30 * 60 * 1000,   // 30 minutes
  60 * 60 * 1000,   // 1 hour
  4 * 60 * 60 * 1000, // 4 hours
]

/**
 * Get failed webhook events that are ready for retry
 */
export async function getFailedWebhooksForRetry(): Promise<{
  id: string
  provider: string
  eventId: string
  eventType: string
  payload: any
  retryCount: number
  createdAt: Date
  error: string | null
}[]> {
  const now = new Date()

  // Get failed events that haven't exceeded max retries
  const failedEvents = await db.webhookEvent.findMany({
    where: {
      status: 'failed',
      retryCount: { lt: MAX_RETRIES },
    },
    orderBy: { createdAt: 'asc' },
    take: 50, // Process in batches
  })

  // Filter events that are ready for retry based on backoff
  return failedEvents.filter(event => {
    const lastAttempt = event.processedAt || event.createdAt
    const retryDelay = RETRY_DELAYS[Math.min(event.retryCount, RETRY_DELAYS.length - 1)]
    const retryAfter = new Date(lastAttempt.getTime() + retryDelay)

    return now >= retryAfter
  })
}

/**
 * Mark a webhook event for retry
 */
export async function markWebhookForRetry(id: string): Promise<void> {
  await db.webhookEvent.update({
    where: { id },
    data: {
      status: 'pending_retry',
    },
  })
}

/**
 * Mark a webhook as permanently failed (exceeded max retries)
 */
export async function markWebhookPermanentlyFailed(id: string, reason: string): Promise<void> {
  await db.webhookEvent.update({
    where: { id },
    data: {
      status: 'dead_letter',
      error: `Exceeded max retries: ${reason}`,
    },
  })
}

/**
 * Get count of failed webhooks by provider
 */
export async function getFailedWebhookCounts(): Promise<{
  stripe: number
  paystack: number
  total: number
}> {
  const [stripeCount, paystackCount] = await Promise.all([
    db.webhookEvent.count({
      where: { provider: 'stripe', status: 'failed' },
    }),
    db.webhookEvent.count({
      where: { provider: 'paystack', status: 'failed' },
    }),
  ])

  return {
    stripe: stripeCount,
    paystack: paystackCount,
    total: stripeCount + paystackCount,
  }
}

/**
 * Get webhooks in dead letter state (exceeded max retries)
 */
export async function getDeadLetterWebhooks(): Promise<{
  id: string
  provider: string
  eventId: string
  eventType: string
  error: string | null
  createdAt: Date
}[]> {
  return db.webhookEvent.findMany({
    where: {
      status: 'dead_letter',
    },
    select: {
      id: true,
      provider: true,
      eventId: true,
      eventType: true,
      error: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
}

/**
 * Retry a specific webhook event (for manual intervention)
 */
export async function retryWebhook(id: string): Promise<{ success: boolean; error?: string }> {
  const event = await db.webhookEvent.findUnique({
    where: { id },
  })

  if (!event) {
    return { success: false, error: 'Event not found' }
  }

  if (event.status === 'processed') {
    return { success: false, error: 'Event already processed' }
  }

  // Reset status to allow reprocessing
  await db.webhookEvent.update({
    where: { id },
    data: {
      status: 'pending_retry',
      retryCount: event.retryCount + 1,
    },
  })

  return { success: true }
}

export default {
  getFailedWebhooksForRetry,
  markWebhookForRetry,
  markWebhookPermanentlyFailed,
  getFailedWebhookCounts,
  getDeadLetterWebhooks,
  retryWebhook,
}
