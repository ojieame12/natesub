import { Job } from 'bullmq'
import { db } from '../db/client.js'
import { logger } from '../utils/logger.js'
import { handlePlatformSubscriptionEvent } from '../services/platformSubscription.js'

// Stripe Handlers
import { handleCheckoutCompleted, handleAsyncPaymentSucceeded, handleCheckoutExpired } from '../routes/webhooks/stripe/checkout.js'
import { handleInvoiceCreated, handleInvoicePaid, handleInvoicePaymentFailed } from '../routes/webhooks/stripe/invoice.js'
import { handleSubscriptionUpdated, handleSubscriptionDeleted } from '../routes/webhooks/stripe/subscription.js'
import { handleAccountUpdated } from '../routes/webhooks/stripe/connect.js'
import { handleChargeRefunded, handlePaymentIntentFailed } from '../routes/webhooks/stripe/payment.js'
import { handleDisputeCreated, handleDisputeClosed } from '../routes/webhooks/stripe/dispute.js'
import { handlePayoutCreated, handlePayoutUpdated, handlePayoutPaid, handlePayoutFailed } from '../routes/webhooks/stripe/payout.js'
import { handleEarlyFraudWarning } from '../routes/webhooks/stripe/early-fraud-warning.js'

// Paystack Handlers
import { handlePaystackChargeSuccess, handlePaystackChargeFailed } from '../routes/webhooks/paystack/charge.js'
import { handlePaystackTransferSuccess, handlePaystackTransferFailed, handlePaystackTransferRequiresOtp } from '../routes/webhooks/paystack/transfer.js'
import { handlePaystackRefundProcessed, handlePaystackRefundPending, handlePaystackRefundFailed } from '../routes/webhooks/paystack/refund.js'
import { handlePaystackDisputeCreated, handlePaystackDisputeResolved } from '../routes/webhooks/paystack/dispute.js'

export interface WebhookJobData {
  provider: 'stripe' | 'paystack'
  event: any // Stripe.Event or Paystack event object
  webhookEventId: string // DB ID of the WebhookEvent record
}

// Helper to identify platform subscription events (Stripe)
async function isPlatformSubscriptionEvent(event: any): Promise<boolean> {
  const platformEventTypes = [
    'checkout.session.completed',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_failed',
    'invoice.paid',
  ]

  if (!platformEventTypes.includes(event.type)) {
    return false
  }

  const data = event.data.object as any

  if (data.metadata?.type === 'platform_subscription') {
    return true
  }

  if ((event.type === 'invoice.payment_failed' || event.type === 'invoice.paid') && data.customer) {
    const customerId = data.customer as string
    const profile = await db.profile.findFirst({
      where: { platformCustomerId: customerId },
      select: { id: true },
    })
    if (profile) return true
  }

  return false
}

export async function webhookProcessor(job: Job<WebhookJobData>) {
  const { provider, event, webhookEventId } = job.data
  const startTime = Date.now()
  const eventId =
    provider === 'stripe'
      ? event.id
      : (event?.data?.reference || event?.data?.id?.toString())

  if (provider === 'paystack' && !eventId) {
    throw new Error('[worker] Paystack webhook missing data.reference/data.id (cannot ensure idempotency)')
  }

  console.log(`[worker] Processing ${provider} webhook ${eventId} (type: ${provider === 'stripe' ? event.type : event.event})`)

  try {
    // Mark as processing
    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data: { status: 'processing' },
    })

    if (provider === 'stripe') {
      await processStripeEvent(event)
    } else if (provider === 'paystack') {
      await processPaystackEvent(event, eventId)
    }

    // Mark as processed
    const duration = Date.now() - startTime
    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        status: 'processed',
        processedAt: new Date(),
        processingTimeMs: duration,
      },
    })

    logger.webhook.processed(provider, provider === 'stripe' ? event.type : event.event, eventId, duration)
  } catch (error: any) {
    console.error(`[worker] Webhook processing failed for ${eventId}:`, error)
    
    // Mark as failed
    await db.webhookEvent.update({
      where: { id: webhookEventId },
      data: {
        status: 'failed',
        error: error.message || String(error),
        processedAt: new Date(),
        processingTimeMs: Date.now() - startTime,
      },
    })

    logger.webhook.failed(provider, provider === 'stripe' ? event.type : event.event, eventId, error)
    
    // Rethrow to let BullMQ handle retries
    throw error
  }
}

async function processStripeEvent(event: any) {
  // Check platform subscription
  const isPlatformEvent = await isPlatformSubscriptionEvent(event)
  if (isPlatformEvent) {
    await handlePlatformSubscriptionEvent(event)
    return
  }

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event)
      break
    case 'checkout.session.async_payment_succeeded':
      await handleAsyncPaymentSucceeded(event)
      break
    case 'invoice.created':
      await handleInvoiceCreated(event)
      break
    case 'invoice.paid':
      await handleInvoicePaid(event)
      break
    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event)
      break
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event)
      break
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event)
      break
    case 'account.updated':
      await handleAccountUpdated(event)
      break
    case 'charge.refunded':
      await handleChargeRefunded(event)
      break
    case 'charge.dispute.created':
      await handleDisputeCreated(event)
      break
    case 'charge.dispute.closed':
      await handleDisputeClosed(event)
      break
    case 'checkout.session.expired':
      await handleCheckoutExpired(event)
      break
    case 'payout.created':
      await handlePayoutCreated(event)
      break
    case 'payout.updated':
      await handlePayoutUpdated(event)
      break
    case 'payout.paid':
      await handlePayoutPaid(event)
      break
    case 'payout.failed':
      await handlePayoutFailed(event)
      break
    case 'payment_intent.payment_failed':
      await handlePaymentIntentFailed(event)
      break
    case 'radar.early_fraud_warning.created':
      await handleEarlyFraudWarning(event)
      break
    default:
      console.log(`[worker] Unhandled Stripe event type: ${event.type}`)
  }
}

async function processPaystackEvent(payload: any, eventId: string) {
  const { event, data } = payload

  switch (event) {
    case 'charge.success':
      await handlePaystackChargeSuccess(data, eventId)
      break
    case 'charge.failed':
      await handlePaystackChargeFailed(data)
      break
    case 'transfer.success':
      await handlePaystackTransferSuccess(data)
      break
    case 'transfer.failed':
      await handlePaystackTransferFailed(data)
      break
    case 'transfer.requires_otp':
      await handlePaystackTransferRequiresOtp(data)
      break
    case 'refund.processed':
      await handlePaystackRefundProcessed(data, eventId)
      break
    case 'refund.pending':
      await handlePaystackRefundPending(data, eventId)
      break
    case 'refund.failed':
      await handlePaystackRefundFailed(data, eventId)
      break
    case 'charge.dispute.create':
      await handlePaystackDisputeCreated(data, eventId)
      break
    case 'charge.dispute.resolve':
      await handlePaystackDisputeResolved(data, eventId)
      break
    default:
      console.log(`[worker] Unhandled Paystack event: ${event}`)
  }
}
