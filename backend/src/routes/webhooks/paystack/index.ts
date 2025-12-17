import { Context } from 'hono'
import crypto from 'crypto'
import { env } from '../../../config/env.js'
import { db } from '../../../db/client.js'
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

// Verify Paystack webhook signature (uses constant-time comparison to prevent timing attacks)
function verifyPaystackSignature(body: string, signature: string): boolean {
  const webhookSecret = env.PAYSTACK_WEBHOOK_SECRET
  if (!webhookSecret) return false

  const hash = crypto
    .createHmac('sha512', webhookSecret)
    .update(body)
    .digest('hex')

  // Use constant-time comparison to prevent timing attacks
  // Both strings must be same length for timingSafeEqual
  if (hash.length !== signature.length) return false

  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature))
}

export async function paystackWebhookHandler(c: Context) {
  const signature = c.req.header('x-paystack-signature')

  if (!signature) {
    return c.json({ error: 'Missing signature' }, 400)
  }

  const body = await c.req.text()

  // Verify signature
  if (!verifyPaystackSignature(body, signature)) {
    console.error('Paystack webhook signature verification failed')
    return c.json({ error: 'Invalid signature' }, 400)
  }

  let payload: { event: string; data: any }

  try {
    payload = JSON.parse(body)
  } catch (err) {
    console.error('Failed to parse Paystack webhook body:', err)
    return c.json({ error: 'Invalid JSON' }, 400)
  }

  const { event, data } = payload

  // Use transaction reference for idempotency - REQUIRED
  // IMPORTANT: Prefer reference over id because Paystack may retry webhooks with different
  // event IDs but the same reference. Reference is the stable business-level identifier.
  const eventId = data.reference || data.id?.toString()
  // IMPORTANT: Include event type in the stored key.
  // Paystack can emit multiple events for the same reference (e.g. transfer.requires_otp -> transfer.success).
  // If we keyed ONLY by reference, we'd incorrectly skip later state transitions.
  const webhookEventId = eventId ? `paystack_${event}_${eventId}` : null

  if (!eventId) {
    console.error('[paystack] Webhook missing ID/reference - cannot ensure idempotency:', { event, data })
    return c.json({ error: 'Invalid webhook - missing transaction ID or reference' }, 400)
  }

  // Track webhook event for audit trail
  const startTime = Date.now()
  logger.webhook.received('paystack', event, eventId)

  const webhookEvent = await db.webhookEvent.upsert({
    where: { eventId: webhookEventId! },
    create: {
      provider: 'paystack',
      eventId: webhookEventId!,
      eventType: event,
      status: 'received',
      payload: { event, reference: data.reference, id: data.id },
    },
    update: {
      retryCount: { increment: 1 },
    },
  })

  // Check if already successfully processed
  if (webhookEvent.status === 'processed') {
    logger.webhook.skipped('paystack', event, eventId, 'already_processed')
    return c.json({ received: true, status: 'already_processed' })
  }

  // IMPORTANT: Event-specific idempotency for Paystack.
  //
  // We intentionally do NOT globally skip just because a Payment record exists:
  // - For transfer.* events, we CREATE the payout Payment record before initiating the transfer,
  //   so the record existing is expected and we MUST process the webhook to update its status.
  //
  // For charge.success, a Payment record may already exist if:
  // - The recurring billing job recorded the successful charge first (using the same reference),
  // - Or Paystack is retrying the same webhook and we already wrote the payment.
  if (event === 'charge.success' && data.reference) {
    const existingChargePayment = await db.payment.findFirst({
      where: {
        paystackTransactionRef: data.reference,
        type: { in: ['recurring', 'one_time'] },
      },
      select: { id: true },
    })

    if (existingChargePayment) {
      await db.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'skipped', processedAt: new Date(), paymentId: existingChargePayment.id },
      })
      logger.webhook.skipped('paystack', event, eventId, 'payment_already_recorded')
      return c.json({ received: true, status: 'already_processed' })
    }
  }

  // Process inline in tests (or when Redis isn't configured), otherwise enqueue.
  try {
    await dispatchWebhookJob('paystack-webhook', {
      provider: 'paystack',
      event: payload, // Pass full payload object ({ event, data })
      webhookEventId: webhookEvent.id,
    })
    return c.json({ received: true })
  } catch (error: any) {
    console.error(`[paystack] Failed to queue webhook ${eventId}:`, error)
    return c.json({ error: 'Internal server error' }, 500)
  }
}
