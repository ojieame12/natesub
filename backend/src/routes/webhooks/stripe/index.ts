import { Context } from 'hono'
import Stripe from 'stripe'
import { db } from '../../../db/client.js'
import { stripe } from '../../../services/stripe.js'
import { env } from '../../../config/env.js'
import { logger } from '../../../utils/logger.js'

type WebhookJobData = {
  provider: 'stripe' | 'paystack'
  event: any
  webhookEventId: string
}

async function dispatchWebhookJob(jobName: string, data: WebhookJobData) {
  // In production with Redis, enqueue for async processing (higher throughput + better retries).
  // In tests (and local envs without Redis), process inline to avoid hard Redis dependency.
  const shouldQueue = env.NODE_ENV !== 'test' && Boolean(env.REDIS_URL)

  if (shouldQueue) {
    const { webhookQueue } = await import('../../../lib/queue.js')
    await webhookQueue.add(jobName, data)
    return
  }

  const { webhookProcessor } = await import('../../../workers/webhookProcessor.js')
  await webhookProcessor({ data } as any)
}

export async function stripeWebhookHandler(c: Context) {
  const signature = c.req.header('stripe-signature')

  if (!signature) {
    return c.json({ error: 'Missing signature' }, 400)
  }

  let event: Stripe.Event

  try {
    const body = await c.req.text()
    event = stripe.webhooks.constructEvent(body, signature, env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return c.json({ error: 'Invalid signature' }, 400)
  }

  // Track webhook event for audit trail
  logger.webhook.received('stripe', event.type, event.id)

  const webhookEvent = await db.webhookEvent.upsert({
    where: { eventId: event.id },
    create: {
      provider: 'stripe',
      eventId: event.id,
      eventType: event.type,
      status: 'received',
      // Store minimal payload to save space (exclude large objects)
      payload: { id: event.id, type: event.type, created: event.created },
    },
    update: {
      retryCount: { increment: 1 },
    },
  })

  // Check if already successfully processed
  if (webhookEvent.status === 'processed') {
    logger.webhook.skipped('stripe', event.type, event.id, 'already_processed')
    return c.json({ received: true, status: 'already_processed' })
  }

  // Legacy idempotency check for payment events
  const existingPayment = await db.payment.findUnique({
    where: { stripeEventId: event.id },
  })

  if (existingPayment) {
    await db.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { status: 'skipped', processedAt: new Date() },
    })
    return c.json({ received: true, status: 'already_processed' })
  }

  // Process inline in tests (or when Redis isn't configured), otherwise enqueue.
  try {
    await dispatchWebhookJob('stripe-webhook', {
      provider: 'stripe',
      event,
      webhookEventId: webhookEvent.id,
    })
    return c.json({ received: true })
  } catch (error: any) {
    console.error(`[stripe] Failed to queue webhook ${event.id}:`, error)
    return c.json({ error: 'Internal server error' }, 500)
  }
}
