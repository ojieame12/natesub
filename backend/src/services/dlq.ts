/**
 * Dead Letter Queue (DLQ) Service
 *
 * Handles failed webhook processing by queuing events for retry.
 * Uses the webhookEvent table with 'failed' status for persistence.
 */

import { db } from '../db/client.js'
import { webhookQueue } from '../lib/queue.js'
import type { WebhookJobData } from '../workers/webhookProcessor.js'

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

  // Get failed and pending_retry events that haven't exceeded max retries.
  // Use a generous limit because the JS backoff filter below may discard many rows.
  // pending_retry events (from queue-dispatch failures) have retryCount 0 and are
  // always ready, so they pass the filter immediately.
  const failedEvents = await db.webhookEvent.findMany({
    where: {
      status: { in: ['failed', 'pending_retry'] },
      retryCount: { lt: MAX_RETRIES },
    },
    orderBy: { createdAt: 'asc' },
    take: 200,
  })

  // Filter events that are ready for retry based on backoff, then cap at 50
  return failedEvents.filter(event => {
    const lastAttempt = event.processedAt || event.createdAt
    const retryDelay = RETRY_DELAYS[Math.min(event.retryCount, RETRY_DELAYS.length - 1)]
    const retryAfter = new Date(lastAttempt.getTime() + retryDelay)

    return now >= retryAfter
  }).slice(0, 50)
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
 * Actually re-enqueues the job to BullMQ for processing
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

  if (!event.payload) {
    return { success: false, error: 'Event has no payload to retry' }
  }

  // Update status and increment retry count
  await db.webhookEvent.update({
    where: { id },
    data: {
      status: 'pending_retry',
      retryCount: event.retryCount + 1,
    },
  })

  // Actually enqueue the job for reprocessing
  const jobData: WebhookJobData = {
    provider: event.provider as 'stripe' | 'paystack',
    event: event.payload,
    webhookEventId: event.id,
  }

  await webhookQueue.add('webhook-retry', jobData)

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
