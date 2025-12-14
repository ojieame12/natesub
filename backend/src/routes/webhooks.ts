import { Hono } from 'hono'
import crypto from 'crypto'
import Stripe from 'stripe'
import { stripe, setSubscriptionDefaultFee } from '../services/stripe.js'
import { db } from '../db/client.js'
import { env } from '../config/env.js'
import { sendNewSubscriberEmail } from '../services/email.js'
import { scheduleReminder, cancelAllRemindersForEntity } from '../jobs/reminders.js'
import { handlePlatformSubscriptionEvent } from '../services/platformSubscription.js'
import { calculateServiceFee, calculateLegacyFee } from '../services/fees.js'
import { initiateTransfer, createTransferRecipient } from '../services/paystack.js'
import { decryptAccountNumber, encryptAuthorizationCode } from '../utils/encryption.js'
import { webhookRateLimit } from '../middleware/rateLimit.js'
import { withLock } from '../services/lock.js'
import {
  validateCheckoutMetadata,
  validatePaystackMetadata,
  parseMetadataAmount,
  isValidUUID,
  sanitizeForLog,
} from '../utils/webhookValidation.js'
import { logger } from '../utils/logger.js'

const webhooks = new Hono()

// Apply rate limiting to all webhook endpoints (100 requests/hour per IP)
webhooks.use('*', webhookRateLimit)

/**
 * Add one calendar month to a date (proper month handling)
 * Handles edge cases like Jan 31 -> Feb 28, etc.
 */
function addOneMonth(date: Date): Date {
  const result = new Date(date)
  const currentMonth = result.getMonth()
  result.setMonth(currentMonth + 1)

  // Handle edge case: if we went too far (e.g., Jan 31 -> Mar 3)
  // Roll back to last day of intended month
  if (result.getMonth() !== (currentMonth + 1) % 12) {
    result.setDate(0) // Go to last day of previous month
  }

  return result
}

// Helper to identify platform subscription events
function isPlatformSubscriptionEvent(event: Stripe.Event): boolean {
  const platformEventTypes = [
    'checkout.session.completed',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.payment_failed',
  ]

  if (!platformEventTypes.includes(event.type)) {
    return false
  }

  const data = event.data.object as any

  // Check metadata for platform_subscription type
  if (data.metadata?.type === 'platform_subscription') {
    return true
  }

  // For subscription events, check if the customer is a platform customer
  if (data.customer) {
    // Platform customers have metadata['type'] = 'platform_customer'
    // This is set when we create the customer in platformSubscription.ts
    // We can't check synchronously, so we check the profile instead
  }

  return false
}

// Stripe webhook handler
webhooks.post('/stripe', async (c) => {
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
  const startTime = Date.now()
  logger.webhook.received('stripe', event.type, event.id)

  let webhookEvent = await db.webhookEvent.upsert({
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

  // Mark as processing
  await db.webhookEvent.update({
    where: { id: webhookEvent.id },
    data: { status: 'processing' },
  })

  try {
    // Check if this is a platform subscription event
    const isPlatformEvent = isPlatformSubscriptionEvent(event)
    if (isPlatformEvent) {
      await handlePlatformSubscriptionEvent(event)
      await db.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: {
          status: 'processed',
          processedAt: new Date(),
          processingTimeMs: Date.now() - startTime,
        },
      })
      return c.json({ received: true, type: 'platform_subscription' })
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

      case 'payout.failed':
        await handlePayoutFailed(event)
        break

      case 'payment_intent.payment_failed':
        await handlePaymentIntentFailed(event)
        break

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    // Mark as successfully processed
    const duration = Date.now() - startTime
    await db.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        status: 'processed',
        processedAt: new Date(),
        processingTimeMs: duration,
      },
    })

    logger.webhook.processed('stripe', event.type, event.id, duration)
    return c.json({ received: true })
  } catch (error) {
    logger.webhook.failed('stripe', event.type, event.id, error instanceof Error ? error : new Error(String(error)))

    // Record the failure
    await db.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        processedAt: new Date(),
        processingTimeMs: Date.now() - startTime,
      },
    }).catch(() => {}) // Don't fail if we can't update the event

    // Critical events should return 500 so Stripe retries on transient failures
    // Non-critical events return 200 to prevent unnecessary retries
    const criticalEvents = [
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
      'invoice.created',
      'invoice.paid',
      'invoice.payment_failed',
      'customer.subscription.deleted',
    ]

    if (criticalEvents.includes(event.type)) {
      // Return 500 for critical events - Stripe will retry up to ~72 hours
      return c.json({ error: 'Processing failed, will retry' }, 500)
    }

    // Return 200 for non-critical events to prevent unnecessary retries
    return c.json({ received: true, error: 'Processing failed - logged for review' })
  }
})

// Handle checkout.session.completed
async function handleCheckoutCompleted(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session

  // IMPORTANT: Check payment_status before processing
  // For async payment methods (bank transfers, etc), payment_status can be 'unpaid'
  const isAsyncPayment = session.payment_status !== 'paid'
  const isSubscriptionMode = session.mode === 'subscription'

  // For ONE-TIME payments with async payment: defer to checkout.session.async_payment_succeeded
  // For SUBSCRIPTIONS with async payment: create subscription record now, invoice.paid will create payment
  if (isAsyncPayment && !isSubscriptionMode) {
    console.log(`[checkout.session.completed] Skipping one-time session ${session.id} with payment_status: ${session.payment_status}`)
    return
  }

  if (isAsyncPayment && isSubscriptionMode) {
    console.log(`[checkout.session.completed] Creating subscription record for async payment session ${session.id}`)
    // Continue processing to create subscription record, but skip payment creation
  }

  // Validate webhook metadata - provider signature already verified, this validates data integrity
  const metadataValidation = validateCheckoutMetadata(session.metadata as Record<string, string>)
  if (!metadataValidation.valid) {
    console.error(`[checkout.session.completed] Invalid metadata for session ${session.id}: ${metadataValidation.error}`)
    throw new Error(`Invalid metadata: ${metadataValidation.error}`)
  }

  const validatedMeta = metadataValidation.data!
  const creatorId = validatedMeta.creatorId
  const tierId = validatedMeta.tierId
  const requestId = validatedMeta.requestId
  const viewId = validatedMeta.viewId

  // Fee metadata from validated schema
  const feeModel = validatedMeta.feeModel || null
  const feeMode = validatedMeta.feeMode || 'pass_to_subscriber'
  const netAmount = parseMetadataAmount(validatedMeta.netAmount)
  const serviceFee = parseMetadataAmount(validatedMeta.serviceFee)
  const feeEffectiveRate = validatedMeta.feeEffectiveRate ? parseFloat(validatedMeta.feeEffectiveRate) : null
  const feeWasCapped = validatedMeta.feeWasCapped === 'true'

  // Platform debit recovery (for service providers with lapsed platform subscription)
  const platformDebitRecovered = parseMetadataAmount(validatedMeta.platformDebitRecovered)

  // Log with sanitized values for audit trail
  console.log(`[checkout.session.completed] Processing session ${session.id} for creator ${sanitizeForLog(creatorId)}`)

  // Server-side conversion tracking (more reliable than client-side)
  // IMPORTANT: Only mark as completed if payment actually succeeded
  // For async payment subscriptions, invoice.paid will handle this
  if (!isAsyncPayment && viewId) {
    // Only update the specific view that was passed - no fallback to avoid overcounting
    await db.pageView.update({
      where: { id: viewId },
      data: { startedCheckout: true, completedCheckout: true },
    }).catch(() => {}) // Ignore if view doesn't exist
  }

  // If this checkout was triggered by a request, finalize it
  // IMPORTANT: Only mark as accepted if payment actually succeeded
  // For async payment subscriptions, invoice.paid will handle this
  if (requestId && !isAsyncPayment) {
    await db.request.update({
      where: { id: requestId },
      data: {
        status: 'accepted',
        respondedAt: new Date(),
      },
    })

    // Cancel any scheduled reminders for this request
    await cancelAllRemindersForEntity({
      entityType: 'request',
      entityId: requestId,
    })

    // Get request details for activity logging
    const request = await db.request.findUnique({ where: { id: requestId } })
    if (request) {
      await db.activity.create({
        data: {
          userId: creatorId,
          type: 'request_accepted',
          payload: {
            requestId: request.id,
            recipientName: request.recipientName,
            amount: request.amountCents,
          },
        },
      })
    }
  }

  // Get or create subscriber user
  let subscriber = await db.user.findUnique({
    where: { email: session.customer_details?.email || '' },
  })

  if (!subscriber && session.customer_details?.email) {
    subscriber = await db.user.create({
      data: { email: session.customer_details.email },
    })
  }

  if (!subscriber) {
    console.error('Could not find or create subscriber')
    return
  }

  // Get creator profile for tier info
  const creatorProfile = await db.profile.findUnique({
    where: { userId: creatorId },
  })

  let tierName: string | null = null
  if (tierId && creatorProfile?.tiers) {
    const tiers = creatorProfile.tiers as any[]
    const tier = tiers.find(t => t.id === tierId)
    tierName = tier?.name || null
  }

  // Calculate fees - use new model if metadata present, else fallback to legacy
  let feeCents: number
  let netCents: number
  let grossCents: number | null = null
  let basePrice: number  // Creator's set price - this is what fees are calculated on for renewals

  // Check if new fee model is in use (netAmount and serviceFee are set via validated metadata)
  const hasNewFeeModel = feeModel && netAmount > 0

  if (feeModel === 'flat' && hasNewFeeModel) {
    // New flat fee model with feeMode (absorb or pass_to_subscriber)
    grossCents = session.amount_total || 0  // Total subscriber paid
    feeCents = serviceFee
    netCents = netAmount  // What creator receives (depends on feeMode)

    // CRITICAL: Store creator's set price for renewal fee calculation
    // In absorb mode: creator sets price = what subscriber pays (gross)
    // In pass_to_subscriber mode: creator sets price = what they receive (net)
    basePrice = feeMode === 'absorb' ? grossCents : netCents
  } else if (feeModel?.startsWith('progressive') && hasNewFeeModel) {
    // Legacy progressive model (backward compatibility)
    grossCents = session.amount_total || 0
    feeCents = serviceFee
    netCents = netAmount
    basePrice = feeMode === 'absorb' ? grossCents : netCents
  } else {
    // Legacy model: fee deducted from creator's earnings (no feeMode)
    const purpose = creatorProfile?.purpose as 'personal' | 'service' | null
    const legacyFees = calculateLegacyFee(session.amount_total || 0, purpose)
    feeCents = legacyFees.feeCents
    netCents = legacyFees.netCents
    basePrice = session.amount_total || 0  // Legacy used gross as base
  }

  // Use transaction to ensure atomic creation/update of subscription + payment + activity
  // isSubscriptionMode is already defined at the top of the function
  const subscriptionInterval = isSubscriptionMode ? 'month' : 'one_time'

  // DISTRIBUTED LOCK: Prevent race conditions when processing concurrent webhooks
  // Lock key based on subscriber email + creator to prevent duplicate subscriptions
  const lockKey = `sub:${subscriber.id}:${creatorId}:${subscriptionInterval}`
  const subscription = await withLock(lockKey, 30000, async () => {
    return await db.$transaction(async (tx) => {
    // UPSERT subscription to handle resubscribe scenarios
    // Uniqueness constraint: subscriberId_creatorId_interval
    // This allows a subscriber to resubscribe after cancellation
    const newSubscription = await tx.subscription.upsert({
      where: {
        subscriberId_creatorId_interval: {
          subscriberId: subscriber.id,
          creatorId,
          interval: subscriptionInterval,
        },
      },
      create: {
        creatorId,
        subscriberId: subscriber.id,
        tierId: tierId || null,
        tierName,
        amount: basePrice, // Creator's SET PRICE - fees calculated on this for renewals
        currency: session.currency?.toUpperCase() || 'USD',
        interval: subscriptionInterval,
        status: 'active',
        stripeSubscriptionId: session.subscription as string || null,
        stripeCustomerId: session.customer as string || null,
        feeModel: feeModel || null,
        feeMode: feeMode || null,
        // Store async payment follow-up data for invoice.paid to complete
        asyncViewId: isAsyncPayment ? (viewId || null) : null,
        asyncRequestId: isAsyncPayment ? (requestId || null) : null,
      },
      update: {
        // Reactivate subscription with new details
        status: 'active',
        tierId: tierId || null,
        tierName,
        amount: basePrice,
        stripeSubscriptionId: session.subscription as string || null,
        stripeCustomerId: session.customer as string || null,
        feeModel: feeModel || null,
        feeMode: feeMode || null,
        canceledAt: null, // Clear cancellation
        cancelAtPeriodEnd: false,
        // Store async payment follow-up data for invoice.paid to complete
        asyncViewId: isAsyncPayment ? (viewId || null) : null,
        asyncRequestId: isAsyncPayment ? (requestId || null) : null,
      },
    })

    // For SUBSCRIPTIONS: Don't create payment here - invoice.paid handles it
    // This prevents double-counting the first payment
    // For ONE-TIME payments: Create payment record here
    if (!isSubscriptionMode) {
      // Get charge ID from payment intent if available
      let stripeChargeId: string | null = null
      if (session.payment_intent) {
        try {
          const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent as string)
          stripeChargeId = paymentIntent.latest_charge as string || null
        } catch (err) {
          console.warn('Could not retrieve payment intent for charge ID:', err)
        }
      }

      // Create payment record for one-time payments only
      await tx.payment.create({
        data: {
          subscriptionId: newSubscription.id,
          creatorId,
          subscriberId: subscriber.id,
          grossCents: grossCents,
          amountCents: grossCents || session.amount_total || 0,
          currency: session.currency?.toUpperCase() || 'USD',
          feeCents,
          netCents,
          feeModel: feeModel || null,
          feeEffectiveRate: feeEffectiveRate,
          feeWasCapped: feeWasCapped,
          platformDebitRecoveredCents: platformDebitRecovered, // Track debit recovery
          type: 'one_time',
          status: 'succeeded',
          stripeEventId: event.id,
          stripePaymentIntentId: session.payment_intent as string || null,
          stripeChargeId,
        },
      })

      // Clear platform debit if recovered from this payment
      if (platformDebitRecovered > 0) {
        await tx.profile.update({
          where: { userId: creatorId },
          data: {
            platformDebitCents: { decrement: platformDebitRecovered },
          },
        })

        // Create activity for audit trail
        await tx.activity.create({
          data: {
            userId: creatorId,
            type: 'platform_debit_recovered',
            payload: {
              amountCents: platformDebitRecovered,
              source: 'stripe_one_time_payment',
              paymentIntentId: session.payment_intent as string || null,
            },
          },
        })

        console.log(`[checkout] Recovered $${(platformDebitRecovered / 100).toFixed(2)} platform debit from creator ${creatorId}`)
      }
    }

    // Create activity event
    await tx.activity.create({
      data: {
        userId: creatorId,
        type: 'subscription_created',
        payload: {
          subscriptionId: newSubscription.id,
          subscriberEmail: session.customer_details?.email,
          subscriberName: session.customer_details?.name,
          tierName,
          amount: session.amount_total,
          currency: session.currency,
        },
      },
    })

    return newSubscription
    })
  })

  // If lock couldn't be acquired, another process is handling this
  if (!subscription) {
    console.log(`[checkout.session.completed] Lock not acquired for ${lockKey}, skipping (another process handling)`)
    return
  }

  // For subscriptions with tracked fee model, set default fee metadata
  // This helps with invoice.created webhook to know expected fee amount
  if (session.subscription && feeModel && serviceFee) {
    try {
      await setSubscriptionDefaultFee(session.subscription as string, serviceFee)
    } catch (err) {
      // Non-fatal: log but continue
      console.error(`[stripe] Failed to set default fee on subscription:`, err)
    }
  }

  // Send notification email to creator
  const creator = await db.user.findUnique({ where: { id: creatorId } })
  if (creator) {
    await sendNewSubscriberEmail(
      creator.email,
      session.customer_details?.name || session.customer_details?.email || 'Someone',
      tierName,
      session.amount_total || 0,
      session.currency?.toUpperCase() || 'USD'
    )
  }
}

/**
 * Handle checkout.session.async_payment_succeeded
 *
 * This fires for payment methods that don't complete immediately
 * (e.g., bank transfers, SEPA, Boleto, OXXO, etc.)
 *
 * When checkout.session.completed fires with payment_status='unpaid',
 * we skip processing. This handler processes when payment actually succeeds.
 */
async function handleAsyncPaymentSucceeded(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session

  console.log(`[async_payment_succeeded] Processing session ${session.id}`)

  // For subscriptions, invoice.paid handles the payment
  // This handler is primarily for one-time payments with async methods
  if (session.mode === 'subscription') {
    console.log(`[async_payment_succeeded] Subscription mode - invoice.paid will handle payment`)
    return
  }

  // Validate webhook metadata
  const metadataValidation = validateCheckoutMetadata(session.metadata as Record<string, string>)
  if (!metadataValidation.valid) {
    console.error(`[async_payment_succeeded] Invalid metadata for session ${session.id}: ${metadataValidation.error}`)
    throw new Error(`Invalid metadata: ${metadataValidation.error}`)
  }

  const validatedMeta = metadataValidation.data!
  const creatorId = validatedMeta.creatorId
  const tierId = validatedMeta.tierId
  const viewId = validatedMeta.viewId
  const requestId = validatedMeta.requestId

  // Fee metadata from validated schema
  const feeModel = validatedMeta.feeModel || null
  const feeMode = validatedMeta.feeMode || 'pass_to_subscriber'
  const netAmount = parseMetadataAmount(validatedMeta.netAmount)
  const serviceFee = parseMetadataAmount(validatedMeta.serviceFee)
  const feeEffectiveRate = validatedMeta.feeEffectiveRate ? parseFloat(validatedMeta.feeEffectiveRate) : null
  const feeWasCapped = validatedMeta.feeWasCapped === 'true'

  console.log(`[async_payment_succeeded] Processing session ${session.id} for creator ${sanitizeForLog(creatorId)}`)

  // Conversion tracking
  if (viewId) {
    await db.pageView.update({
      where: { id: viewId },
      data: { startedCheckout: true, completedCheckout: true },
    }).catch(() => {})
  }

  // If this checkout was triggered by a request, finalize it
  if (requestId) {
    await db.request.update({
      where: { id: requestId },
      data: {
        status: 'accepted',
        respondedAt: new Date(),
      },
    }).catch(() => {}) // Ignore if request doesn't exist

    // Get request details for activity logging
    const request = await db.request.findUnique({ where: { id: requestId } })
    if (request) {
      await db.activity.create({
        data: {
          userId: creatorId,
          type: 'request_accepted',
          payload: {
            requestId: request.id,
            recipientName: request.recipientName,
            amount: request.amountCents,
            asyncPayment: true,
          },
        },
      })
    }
  }

  // Get or create subscriber
  const subscriberEmail = session.customer_details?.email
  if (!subscriberEmail) {
    console.error('[async_payment_succeeded] No subscriber email found')
    return
  }

  let subscriber = await db.user.findUnique({ where: { email: subscriberEmail } })
  if (!subscriber) {
    subscriber = await db.user.create({ data: { email: subscriberEmail } })
  }

  // Get tier info
  const creatorProfile = await db.profile.findUnique({
    where: { userId: creatorId },
    select: { tiers: true, purpose: true },
  })

  let tierName: string | null = null
  if (tierId && creatorProfile?.tiers) {
    const tiers = creatorProfile.tiers as any[]
    const tier = tiers.find(t => t.id === tierId)
    tierName = tier?.name || null
  }

  // Calculate fees
  let feeCents: number
  let netCents: number
  let grossCents: number | null = null

  const hasNewFeeModel = feeModel && netAmount > 0
  if (hasNewFeeModel) {
    grossCents = session.amount_total || 0
    feeCents = serviceFee
    netCents = netAmount
  } else {
    const purpose = creatorProfile?.purpose as 'personal' | 'service' | null
    const legacyFees = calculateLegacyFee(session.amount_total || 0, purpose)
    feeCents = legacyFees.feeCents
    netCents = legacyFees.netCents
  }

  // Create or update one-time subscription record (upsert to handle repeat payments)
  const subscription = await db.subscription.upsert({
    where: {
      subscriberId_creatorId_interval: {
        subscriberId: subscriber.id,
        creatorId,
        interval: 'one_time',
      },
    },
    create: {
      creatorId,
      subscriberId: subscriber.id,
      tierId: tierId || null,
      tierName,
      amount: netCents,
      currency: session.currency?.toUpperCase() || 'USD',
      interval: 'one_time',
      status: 'active',
      ltvCents: netCents, // Initialize LTV with first payment
      stripeCustomerId: session.customer as string || null,
      feeModel: feeModel || null,
      feeMode: feeMode || null,
    },
    update: {
      tierId: tierId || null,
      tierName,
      amount: netCents,
      stripeCustomerId: session.customer as string || null,
      ltvCents: { increment: netCents }, // Increment LTV for repeat payment
    },
  })

  // Get charge ID from payment intent
  let stripeChargeId: string | null = null
  if (session.payment_intent) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent as string)
      stripeChargeId = typeof paymentIntent.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge?.id || null
    } catch {
      // Ignore - charge ID is optional
    }
  }

  // Create payment record
  await db.payment.create({
    data: {
      subscriptionId: subscription.id,
      creatorId,
      subscriberId: subscriber.id,
      grossCents,
      amountCents: session.amount_total || 0,
      currency: session.currency?.toUpperCase() || 'USD',
      feeCents,
      netCents,
      feeModel: feeModel || null,
      feeEffectiveRate,
      feeWasCapped,
      type: 'one_time',
      status: 'succeeded',
      stripeEventId: event.id,
      stripePaymentIntentId: session.payment_intent as string || null,
      stripeChargeId,
    },
  })

  // Create activity
  await db.activity.create({
    data: {
      userId: creatorId,
      type: 'subscription_created',
      payload: {
        subscriptionId: subscription.id,
        subscriberEmail,
        tierName,
        amount: session.amount_total,
        currency: session.currency,
        asyncPayment: true,
      },
    },
  })

  // Send notification email to creator
  const creator = await db.user.findUnique({ where: { id: creatorId } })
  if (creator) {
    await sendNewSubscriberEmail(
      creator.email,
      session.customer_details?.name || session.customer_details?.email || 'Someone',
      tierName,
      session.amount_total || 0,
      session.currency?.toUpperCase() || 'USD'
    )
  }

  console.log(`[async_payment_succeeded] Created subscription ${subscription.id} for async payment`)
}

/**
 * Handle invoice.created - Backup fee application for subscriptions
 *
 * Primary fee collection is via application_fee_percent on subscription_data.
 * This handler serves as a backup for:
 * - Legacy subscriptions created before application_fee_percent was added
 * - Edge cases where the percentage might need adjustment
 *
 * For draft/open invoices, we verify/apply the expected fee amount.
 */
async function handleInvoiceCreated(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice

  // Only process draft/open invoices (we can still modify them)
  // Skip paid/void/uncollectible invoices - too late to apply fee
  if (invoice.status !== 'draft' && invoice.status !== 'open') {
    return
  }

  // Get subscription ID from invoice
  const stripeSubscriptionId = (invoice as any).subscription_details?.subscription
    || (invoice as any).subscription

  if (!stripeSubscriptionId) return

  // Find our subscription record
  const subscription = await db.subscription.findUnique({
    where: { stripeSubscriptionId: stripeSubscriptionId as string },
    include: {
      creator: {
        include: { profile: true },
      },
    },
  })

  if (!subscription) {
    console.log(`[invoice.created] No subscription found for ${stripeSubscriptionId}`)
    return
  }

  // Check if this subscription uses a tracked fee model
  // Both 'flat' and 'progressive' models need fee applied on invoices
  // because Stripe subscription_data doesn't support fixed application_fee_amount
  if (!subscription.feeModel) {
    // Legacy subscriptions without feeModel - no action needed
    console.log(`[invoice.created] Skipping legacy subscription ${subscription.id} (no feeModel)`)
    return
  }

  // For new model: calculate fee based on CREATOR'S PRICE (subscription.amount)
  // NOT invoice.amount_due which includes the fee already
  // subscription.amount stores the creator's price, fees are added on top
  const creatorAmount = subscription.amount
  const currency = invoice.currency.toUpperCase()
  const creatorPurpose = subscription.creator?.profile?.purpose

  const feeCalc = calculateServiceFee(creatorAmount, currency, creatorPurpose)

  // Update the invoice with the application fee
  // This must be done before the invoice is finalized
  try {
    await stripe.invoices.update(invoice.id, {
      application_fee_amount: feeCalc.feeCents,
    })

    console.log(`[invoice.created] Applied fee ${feeCalc.feeCents} (${(feeCalc.effectiveRate * 100).toFixed(2)}%) on creator amount ${creatorAmount} to invoice ${invoice.id}`)
  } catch (err) {
    // If we can't update (e.g., invoice already finalized), log but don't fail
    console.error(`[invoice.created] Failed to apply fee to invoice ${invoice.id}:`, err)
  }
}

// Handle invoice.paid (recurring payments)
async function handleInvoicePaid(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice

  // Get subscription ID from invoice - use subscription_details in newer API versions
  const subscriptionId = (invoice as any).subscription_details?.subscription
    || (invoice as any).subscription

  if (!subscriptionId) return

  // Lock to prevent duplicate processing of same invoice
  const lockKey = `invoice:paid:${invoice.id}`
  const processed = await withLock(lockKey, 30000, async () => {
    // Check idempotency - already processed this invoice?
    const existingPayment = await db.payment.findFirst({
      where: { stripeEventId: event.id },
    })
    if (existingPayment) {
      console.log(`[invoice.paid] Already processed event ${event.id}, skipping`)
      return true
    }

    const subscription = await db.subscription.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    include: {
      creator: {
        include: { profile: { select: { purpose: true } } },
      },
    },
  })

    if (!subscription) return true // Nothing to process

    // Get actual fee from Stripe invoice (more reliable than recalculating)
  const invoiceAny = invoice as any
  const stripeActualFee = invoiceAny.application_fee_amount || 0

  // Calculate fees - use new model if subscription has it, else legacy
  let feeCents: number
  let netCents: number
  let grossCents: number | null = null
  let feeModel: string | null = null
  let feeEffectiveRate: number | null = null
  let feeWasCapped = false

  if (subscription.feeModel) {
    // New fee model (flat or progressive)
    // IMPORTANT: Calculate fee on CREATOR'S PRICE (subscription.amount), not invoice total
    const creatorAmount = subscription.amount
    const creatorPurpose = subscription.creator?.profile?.purpose
    const feeCalc = calculateServiceFee(creatorAmount, invoice.currency.toUpperCase(), creatorPurpose)

    // Use actual Stripe fee if available, otherwise use calculated
    // This ensures we store what Stripe actually charged, not what we expected
    if (stripeActualFee > 0) {
      feeCents = stripeActualFee
      // Alert if mismatch - this indicates invoice.created webhook may have raced/failed
      if (stripeActualFee !== feeCalc.feeCents) {
        const mismatchPct = Math.abs((stripeActualFee - feeCalc.feeCents) / feeCalc.feeCents * 100)
        console.error(`[ALERT][invoice.paid] Fee mismatch for sub ${subscription.id}: Stripe=${stripeActualFee}, expected=${feeCalc.feeCents} (${mismatchPct.toFixed(1)}% diff) on creator amount ${creatorAmount}`)
        // Create activity for monitoring/alerting systems
        await db.activity.create({
          data: {
            userId: subscription.creatorId,
            type: 'fee_mismatch_alert',
            payload: {
              subscriptionId: subscription.id,
              invoiceId: invoice.id,
              stripeActualFee,
              expectedFee: feeCalc.feeCents,
              creatorAmount,
              mismatchPercent: mismatchPct,
              currency: invoice.currency,
              feeModel: feeCalc.feeModel,
            },
          },
        })
      }
    } else {
      // Invoice.created webhook may have failed - use calculated fee
      feeCents = feeCalc.feeCents
      console.error(`[ALERT][invoice.paid] No application_fee on invoice ${invoice.id}, using calculated: ${feeCents}. Invoice.created webhook may have failed.`)
      // Create activity for monitoring - this is a critical issue
      await db.activity.create({
        data: {
          userId: subscription.creatorId,
          type: 'fee_missing_alert',
          payload: {
            subscriptionId: subscription.id,
            invoiceId: invoice.id,
            calculatedFee: feeCents,
            creatorAmount,
            currency: invoice.currency,
            feeModel: feeCalc.feeModel,
            issue: 'invoice.created webhook may have failed to apply fee',
          },
        },
      })
    }

    grossCents = invoice.amount_paid
    // CRITICAL: In absorb mode, subscription.amount = gross (what subscriber pays)
    // Creator receives gross - fee. In pass_to_subscriber mode, subscription.amount = net.
    if (subscription.feeMode === 'absorb') {
      netCents = creatorAmount - feeCents // Creator pays the fee from their earnings
    } else {
      netCents = creatorAmount // Creator receives their full price (fee added on top)
    }
    feeModel = feeCalc.feeModel
    feeEffectiveRate = feeCalc.effectiveRate
    // feeWasCapped stays false - flat fee model has no caps
  } else {
    // Legacy model: fee deducted from creator's earnings
    const purpose = subscription.creator?.profile?.purpose as 'personal' | 'service' | null
    const legacyFees = calculateLegacyFee(invoice.amount_paid, purpose)
    feeCents = legacyFees.feeCents
    netCents = legacyFees.netCents
  }

  // Update subscription period, LTV, and recover from past_due if applicable
  // IMPORTANT: LTV tracks creator's earnings (netCents), not gross amount paid
  const wasRecovered = subscription.status === 'past_due'
  await db.subscription.update({
    where: { id: subscription.id },
    data: {
      // RECOVERY: If subscription was past_due, payment success means it's active again
      // This provides a recovery path without waiting for customer.subscription.updated webhook
      status: subscription.status === 'past_due' ? 'active' : undefined,
      currentPeriodEnd: invoice.lines.data[0]?.period?.end
        ? new Date(invoice.lines.data[0].period.end * 1000)
        : null,
      ltvCents: { increment: netCents }, // Creator's earnings, not gross
    },
  })

  if (wasRecovered) {
    console.log(`[invoice.paid] Recovered subscription ${subscription.id} from past_due to active`)
  }

  // Create payment record with charge ID
  // Use invoice paid_at timestamp for accurate period-based reporting
  const paidAt = invoiceAny.status_transitions?.paid_at
    ? new Date(invoiceAny.status_transitions.paid_at * 1000)
    : new Date()

  await db.payment.create({
    data: {
      subscriptionId: subscription.id,
      creatorId: subscription.creatorId,
      subscriberId: subscription.subscriberId,
      grossCents,
      amountCents: invoice.amount_paid,
      currency: invoice.currency.toUpperCase(),
      feeCents,
      netCents,
      feeModel,
      feeEffectiveRate,
      feeWasCapped,
      type: 'recurring',
      status: 'succeeded',
      occurredAt: paidAt,
      stripeEventId: event.id,
      stripePaymentIntentId: invoiceAny.payment_intent as string || null,
      stripeChargeId: invoiceAny.charge as string || null,
    },
  })

  // ASYNC PAYMENT FOLLOW-UP: Complete conversion tracking and request acceptance
  // These were deferred in checkout.session.completed when payment_status !== 'paid'
  if (subscription.asyncViewId || subscription.asyncRequestId) {
    console.log(`[invoice.paid] Processing async payment follow-up for subscription ${subscription.id}`)

    // Complete conversion tracking
    if (subscription.asyncViewId) {
      await db.pageView.update({
        where: { id: subscription.asyncViewId },
        data: { startedCheckout: true, completedCheckout: true },
      }).catch(() => {}) // Ignore if view doesn't exist

      console.log(`[invoice.paid] Marked pageView ${subscription.asyncViewId} as converted`)
    }

    // Accept the request
    if (subscription.asyncRequestId) {
      await db.request.update({
        where: { id: subscription.asyncRequestId },
        data: {
          status: 'accepted',
          respondedAt: new Date(),
        },
      }).catch(() => {}) // Ignore if request doesn't exist

      // Get request details for activity logging
      const request = await db.request.findUnique({ where: { id: subscription.asyncRequestId } })
      if (request) {
        await db.activity.create({
          data: {
            userId: subscription.creatorId,
            type: 'request_accepted',
            payload: {
              requestId: request.id,
              recipientName: request.recipientName,
              amount: request.amountCents,
            },
          },
        })
      }

      console.log(`[invoice.paid] Marked request ${subscription.asyncRequestId} as accepted`)
    }

    // Clear async follow-up data (one-time action)
    await db.subscription.update({
      where: { id: subscription.id },
      data: {
        asyncViewId: null,
        asyncRequestId: null,
      },
    })
  }

    // Create activity event
    await db.activity.create({
      data: {
        userId: subscription.creatorId,
        type: 'payment_received',
        payload: {
          subscriptionId: subscription.id,
          amount: invoice.amount_paid,
          currency: invoice.currency,
        },
      },
    })

    // PLATFORM DEBIT RECOVERY for subscription renewals
    // When a service provider's platform subscription fails, we accumulate debit
    // and recover it from their next client payment via a separate charge
    const creatorProfile = await db.profile.findUnique({
      where: { userId: subscription.creatorId },
      select: {
        platformDebitCents: true,
        platformCustomerId: true,
        purpose: true,
      },
    })

    if (creatorProfile?.purpose === 'service' &&
        creatorProfile.platformDebitCents > 0 &&
        creatorProfile.platformCustomerId) {
      // Recover up to $30 per payment (cap to prevent large unexpected charges)
      const debitToRecover = Math.min(creatorProfile.platformDebitCents, 3000)

      try {
        // Get the default payment method from the platform customer
        const customer = await stripe.customers.retrieve(creatorProfile.platformCustomerId)
        const defaultPaymentMethod = typeof customer !== 'string' && !customer.deleted
          ? customer.invoice_settings?.default_payment_method
          : null

        if (defaultPaymentMethod) {
          // Create a separate charge to recover the platform debit
          const paymentIntent = await stripe.paymentIntents.create({
            amount: debitToRecover,
            currency: 'usd',
            customer: creatorProfile.platformCustomerId,
            payment_method: defaultPaymentMethod as string,
            confirm: true,
            off_session: true,
            description: 'Platform subscription recovery',
            metadata: {
              type: 'platform_debit_recovery',
              userId: subscription.creatorId,
              originalDebitCents: creatorProfile.platformDebitCents.toString(),
            },
          })

          if (paymentIntent.status === 'succeeded') {
            // Clear the recovered debit
            await db.profile.update({
              where: { userId: subscription.creatorId },
              data: {
                platformDebitCents: { decrement: debitToRecover },
              },
            })

            // Create activity for audit trail
            await db.activity.create({
              data: {
                userId: subscription.creatorId,
                type: 'platform_debit_recovered',
                payload: {
                  amountCents: debitToRecover,
                  source: 'stripe_subscription_renewal',
                  paymentIntentId: paymentIntent.id,
                  invoiceId: invoice.id,
                },
              },
            })

            console.log(`[invoice.paid] Recovered $${(debitToRecover / 100).toFixed(2)} platform debit from creator ${subscription.creatorId}`)
          }
        } else {
          console.log(`[invoice.paid] No payment method for debit recovery, debit remains: $${(creatorProfile.platformDebitCents / 100).toFixed(2)}`)
        }
      } catch (recoveryErr: any) {
        // Recovery failed - debit stays, will try again on next payment
        // Don't fail the webhook - the main payment succeeded
        console.error(`[invoice.paid] Platform debit recovery failed for ${subscription.creatorId}:`, recoveryErr.message)

        // Create activity for visibility
        await db.activity.create({
          data: {
            userId: subscription.creatorId,
            type: 'platform_debit_recovery_failed',
            payload: {
              attemptedAmountCents: debitToRecover,
              remainingDebitCents: creatorProfile.platformDebitCents,
              error: recoveryErr.message,
              invoiceId: invoice.id,
            },
          },
        })
      }
    }

    return true
  }) // End of withLock

  if (!processed) {
    console.log(`[invoice.paid] Could not acquire lock for invoice ${invoice.id}, will retry`)
  }
}

// Handle invoice.payment_failed
async function handleInvoicePaymentFailed(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice

  // Get subscription ID from invoice - use subscription_details in newer API versions
  const subscriptionId = (invoice as any).subscription_details?.subscription
    || (invoice as any).subscription

  if (!subscriptionId) return

  const subscription = await db.subscription.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
  })

  if (!subscription) return

  await db.subscription.update({
    where: { id: subscription.id },
    data: { status: 'past_due' },
  })
}

// Handle subscription updated
async function handleSubscriptionUpdated(event: Stripe.Event) {
  const stripeSubscription = event.data.object as Stripe.Subscription

  const subscription = await db.subscription.findUnique({
    where: { stripeSubscriptionId: stripeSubscription.id },
  })

  if (!subscription) return

  // Get current period end (property name may vary in different API versions)
  const currentPeriodEnd = (stripeSubscription as any).current_period_end
    ?? (stripeSubscription as any).current_period_end_at

  await db.subscription.update({
    where: { id: subscription.id },
    data: {
      status: stripeSubscription.status === 'active' ? 'active' :
              stripeSubscription.status === 'canceled' ? 'canceled' :
              stripeSubscription.status === 'past_due' ? 'past_due' : 'paused',
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
    },
  })
}

// Handle subscription deleted
async function handleSubscriptionDeleted(event: Stripe.Event) {
  const stripeSubscription = event.data.object as Stripe.Subscription

  const subscription = await db.subscription.findUnique({
    where: { stripeSubscriptionId: stripeSubscription.id },
  })

  if (!subscription) return

  await db.subscription.update({
    where: { id: subscription.id },
    data: {
      status: 'canceled',
      canceledAt: new Date(),
    },
  })

  // Create activity event
  await db.activity.create({
    data: {
      userId: subscription.creatorId,
      type: 'subscription_canceled',
      payload: {
        subscriptionId: subscription.id,
      },
    },
  })
}

// Handle Connect account updated
async function handleAccountUpdated(event: Stripe.Event) {
  const account = event.data.object as Stripe.Account

  const profile = await db.profile.findUnique({
    where: { stripeAccountId: account.id },
  })

  if (!profile) return

  let payoutStatus: 'pending' | 'active' | 'restricted' = 'pending'
  if (account.charges_enabled && account.payouts_enabled) {
    payoutStatus = 'active'
  } else if (account.requirements?.disabled_reason) {
    payoutStatus = 'restricted'
  }

  await db.profile.update({
    where: { id: profile.id },
    data: { payoutStatus },
  })
}

// Handle charge refunded
async function handleChargeRefunded(event: Stripe.Event) {
  const charge = event.data.object as Stripe.Charge

  // Find the payment by looking up the charge's payment intent
  const paymentIntent = charge.payment_intent as string
  if (!paymentIntent) return

  // Find the original payment via invoice or checkout session
  // For subscriptions, we track via stripeEventId on the original payment
  // For refunds, we create a new payment record with negative amount

  type SubscriptionWithCreator = Awaited<ReturnType<typeof db.subscription.findFirst<{
    include: { creator: { include: { profile: { select: { purpose: true } } } } }
  }>>>

  let subscription: SubscriptionWithCreator = null

  // FIXED: Look up subscription by Stripe subscription ID (not customer ID)
  // This prevents matching the wrong subscription when a customer has multiple
  // Access invoice from charge metadata (Stripe types vary by API version)
  const invoiceId = (charge as any).invoice as string | null

  if (invoiceId) {
    // Charge is from an invoice (subscription payment)
    // Get the subscription ID from the invoice
    try {
      const invoice = await stripe.invoices.retrieve(invoiceId)
      // Stripe API types vary by version - access subscription via any cast
      const invoiceData = invoice as any
      const stripeSubscriptionId = typeof invoiceData.subscription === 'string'
        ? invoiceData.subscription
        : invoiceData.subscription?.id || null

      if (stripeSubscriptionId) {
        subscription = await db.subscription.findFirst({
          where: { stripeSubscriptionId },
          include: {
            creator: {
              include: { profile: { select: { purpose: true } } },
            },
          },
        })
      }
    } catch (err) {
      console.error('[stripe] Failed to retrieve invoice for refund:', err)
    }
  }

  // Fallback: look up by customer ID (for one-time payments or if invoice lookup failed)
  if (!subscription) {
    const stripeCustomerId = charge.customer as string
    if (stripeCustomerId) {
      subscription = await db.subscription.findFirst({
        where: { stripeCustomerId },
        orderBy: { createdAt: 'desc' },
        include: {
          creator: {
            include: { profile: { select: { purpose: true } } },
          },
        },
      })
    }
  }

  if (!subscription) {
    console.log('No subscription found for refunded charge')
    return
  }

  const refundAmount = charge.amount_refunded

  // Find the original payment to get correct fee ratio
  // This ensures refunds use the same fee calculation as the original payment
  const originalPayment = await db.payment.findFirst({
    where: {
      subscriptionId: subscription.id,
      stripeChargeId: charge.id,
      status: 'succeeded',
    },
  })

  let feeCents: number
  let netCents: number

  if (originalPayment && originalPayment.grossCents && originalPayment.grossCents > 0) {
    // Use the original payment's fee ratio for accurate refund calculation
    // This handles both absorb and pass_to_subscriber modes correctly
    const feeRatio = originalPayment.feeCents / originalPayment.grossCents
    const netRatio = originalPayment.netCents / originalPayment.grossCents
    feeCents = Math.round(refundAmount * feeRatio)
    netCents = Math.round(refundAmount * netRatio)
  } else if (subscription.feeModel) {
    // Fallback: recalculate if original payment not found (shouldn't happen)
    // Note: This may be inaccurate for pass_to_subscriber mode
    console.warn(`[refund] Original payment not found for charge ${charge.id}, recalculating fees`)
    const creatorPurpose = subscription.creator?.profile?.purpose
    const feeCalc = calculateServiceFee(refundAmount, charge.currency.toUpperCase(), creatorPurpose)
    feeCents = feeCalc.feeCents
    netCents = refundAmount - feeCalc.feeCents
  } else {
    // Legacy model: fee based on creator's purpose
    const creatorPurpose = subscription.creator?.profile?.purpose as 'personal' | 'service' | null
    const legacyFees = calculateLegacyFee(refundAmount, creatorPurpose)
    feeCents = legacyFees.feeCents
    netCents = legacyFees.netCents
  }

  // Create refund payment record
  await db.payment.create({
    data: {
      subscriptionId: subscription.id,
      creatorId: subscription.creatorId,
      subscriberId: subscription.subscriberId,
      amountCents: -refundAmount, // Negative for refund
      currency: charge.currency.toUpperCase(),
      feeCents: -feeCents, // Reverse the fee
      netCents: -netCents,
      feeModel: subscription.feeModel,
      type: subscription.interval === 'month' ? 'recurring' : 'one_time',
      status: 'refunded',
      stripeEventId: event.id,
    },
  })

  // Update subscription LTV (decrement by net amount, not gross)
  // LTV tracks creator's earnings, so we reverse the net portion
  // IMPORTANT: Prevent negative LTV - only decrement up to current LTV
  const currentLtv = subscription.ltvCents || 0
  const decrementAmount = Math.min(netCents, currentLtv)

  if (decrementAmount > 0) {
    await db.subscription.update({
      where: { id: subscription.id },
      data: {
        ltvCents: { decrement: decrementAmount },
      },
    })
  }

  // Create activity event
  await db.activity.create({
    data: {
      userId: subscription.creatorId,
      type: 'payment_refunded',
      payload: {
        subscriptionId: subscription.id,
        amount: refundAmount,
        currency: charge.currency,
        reason: charge.refunds?.data[0]?.reason || 'requested_by_customer',
      },
    },
  })
}

// Handle dispute/chargeback created
async function handleDisputeCreated(event: Stripe.Event) {
  const dispute = event.data.object as Stripe.Dispute

  const stripeCustomerId = dispute.charge
    ? (await stripe.charges.retrieve(dispute.charge as string)).customer as string
    : null

  if (!stripeCustomerId) return

  const subscription = await db.subscription.findFirst({
    where: { stripeCustomerId },
    orderBy: { createdAt: 'desc' },
  })

  if (!subscription) return

  // Create dispute payment record (funds held)
  await db.payment.create({
    data: {
      subscriptionId: subscription.id,
      creatorId: subscription.creatorId,
      subscriberId: subscription.subscriberId,
      amountCents: -dispute.amount, // Negative - funds held
      currency: dispute.currency.toUpperCase(),
      feeCents: 0,
      netCents: -dispute.amount,
      type: subscription.interval === 'month' ? 'recurring' : 'one_time',
      status: 'disputed', // Dispute is open, funds held - use 'disputed' for payroll tracking
      stripeDisputeId: dispute.id, // Track dispute for later resolution
      stripeChargeId: dispute.charge as string || null,
      stripeEventId: event.id,
    },
  })

  // Decrement LTV when dispute is opened (funds are held)
  // This will be restored if dispute is won in handleDisputeClosed
  const currentLtv = subscription.ltvCents || 0
  const decrementAmount = Math.min(dispute.amount, currentLtv)
  if (decrementAmount > 0) {
    await db.subscription.update({
      where: { id: subscription.id },
      data: { ltvCents: { decrement: decrementAmount } },
    })
  }

  // Create activity event
  await db.activity.create({
    data: {
      userId: subscription.creatorId,
      type: 'dispute_created',
      payload: {
        subscriptionId: subscription.id,
        amount: dispute.amount,
        currency: dispute.currency,
        reason: dispute.reason,
        status: dispute.status,
      },
    },
  })
}

// Handle dispute closed (won or lost)
async function handleDisputeClosed(event: Stripe.Event) {
  const dispute = event.data.object as Stripe.Dispute

  // Find the open dispute payment by dispute ID (more reliable than amount matching)
  let disputePayment = await db.payment.findUnique({
    where: { stripeDisputeId: dispute.id },
  })

  // Fallback to amount-based matching for older disputes without ID
  if (!disputePayment) {
    disputePayment = await db.payment.findFirst({
      where: {
        status: 'pending',
        amountCents: -dispute.amount,
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  if (!disputePayment) return

  const won = dispute.status === 'won'

  // Update the dispute payment status with proper semantics
  // dispute_won = creator won, funds returned
  // dispute_lost = creator lost, funds deducted
  await db.payment.update({
    where: { id: disputePayment.id },
    data: {
      status: won ? 'dispute_won' : 'dispute_lost',
    },
  })

  // If won, restore the LTV
  if (won) {
    await db.subscription.update({
      where: { id: disputePayment.subscriptionId! },
      data: {
        ltvCents: { increment: dispute.amount },
      },
    })
  }

  // Create activity event
  await db.activity.create({
    data: {
      userId: disputePayment.creatorId,
      type: won ? 'dispute_won' : 'dispute_lost',
      payload: {
        subscriptionId: disputePayment.subscriptionId,
        amount: dispute.amount,
        currency: dispute.currency,
        reason: dispute.reason,
      },
    },
  })
}

// Handle checkout session expired (user abandoned payment)
async function handleCheckoutExpired(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session

  const requestId = session.metadata?.requestId
  if (!requestId) return

  // Find the request by checkout session ID
  const request = await db.request.findFirst({
    where: {
      id: requestId,
      stripeCheckoutSessionId: session.id,
      status: 'pending_payment',
    },
  })

  if (!request) return

  // Revert request to 'sent' status so they can try again
  // Alternative: set to 'expired' if you want to track abandoned checkouts
  await db.request.update({
    where: { id: request.id },
    data: {
      status: 'sent',
      stripeCheckoutSessionId: null, // Clear the expired session
    },
  })

  console.log(`Checkout expired for request ${requestId}, reverted to sent status`)
}

// Handle payout.failed - when automatic payout to connected account fails
async function handlePayoutFailed(event: Stripe.Event) {
  const payout = event.data.object as Stripe.Payout

  // Payout object has account as a string when using Connect
  const accountId = (payout as any).destination || (event.account as string)
  if (!accountId) {
    console.log('[payout.failed] No account ID found')
    return
  }

  // Find the creator by their Stripe account
  const profile = await db.profile.findFirst({
    where: { stripeAccountId: accountId },
  })

  if (!profile) {
    console.log(`[payout.failed] No profile found for account ${accountId}`)
    return
  }

  // Create activity event to notify creator
  await db.activity.create({
    data: {
      userId: profile.userId,
      type: 'payout_failed',
      payload: {
        payoutId: payout.id,
        amount: payout.amount,
        currency: payout.currency,
        failureCode: payout.failure_code,
        failureMessage: payout.failure_message,
        arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null,
      },
    },
  })

  // Update profile payout status to indicate an issue
  await db.profile.update({
    where: { id: profile.id },
    data: { payoutStatus: 'restricted' },
  })

  console.log(`[payout.failed] Recorded failed payout for creator ${profile.userId}: ${payout.failure_message}`)
}

// Handle payment_intent.payment_failed - when a payment attempt fails
async function handlePaymentIntentFailed(event: Stripe.Event) {
  const paymentIntent = event.data.object as Stripe.PaymentIntent

  const creatorId = paymentIntent.metadata?.creatorId
  if (!creatorId) {
    console.log('[payment_intent.payment_failed] No creatorId in metadata')
    return
  }

  // Get failure details
  const lastError = paymentIntent.last_payment_error
  const failureReason = lastError?.message || lastError?.code || 'Unknown error'

  // Create activity event
  await db.activity.create({
    data: {
      userId: creatorId,
      type: 'payment_failed',
      payload: {
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        failureCode: lastError?.code,
        failureMessage: failureReason,
        customerEmail: paymentIntent.receipt_email,
      },
    },
  })

  console.log(`[payment_intent.payment_failed] Payment failed for creator ${creatorId}: ${failureReason}`)
}

// ============================================
// PAYSTACK WEBHOOKS
// ============================================

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

// Paystack webhook handler
webhooks.post('/paystack', async (c) => {
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

  if (!eventId) {
    console.error('[paystack] Webhook missing ID/reference - cannot ensure idempotency:', { event, data })
    return c.json({ error: 'Invalid webhook - missing transaction ID or reference' }, 400)
  }

  // Track webhook event for audit trail
  const startTime = Date.now()
  logger.webhook.received('paystack', event, eventId)

  let webhookEvent = await db.webhookEvent.upsert({
    where: { eventId: `paystack_${eventId}` },
    create: {
      provider: 'paystack',
      eventId: `paystack_${eventId}`,
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

  // Legacy idempotency check for payment events
  const existingPayment = await db.payment.findUnique({
    where: { paystackEventId: eventId },
  })

  if (existingPayment) {
    await db.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { status: 'skipped', processedAt: new Date() },
    })
    console.log(`[paystack] Webhook already processed: ${eventId}`)
    return c.json({ received: true, status: 'already_processed' })
  }

  // Mark as processing
  await db.webhookEvent.update({
    where: { id: webhookEvent.id },
    data: { status: 'processing' },
  })

  try {
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

      // Refund events
      case 'refund.processed':
        await handlePaystackRefundProcessed(data, eventId)
        break

      case 'refund.pending':
        await handlePaystackRefundPending(data, eventId)
        break

      case 'refund.failed':
        await handlePaystackRefundFailed(data, eventId)
        break

      default:
        console.log(`Unhandled Paystack event: ${event}`)
    }

    // Mark as successfully processed
    const duration = Date.now() - startTime
    await db.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        status: 'processed',
        processedAt: new Date(),
        processingTimeMs: duration,
      },
    })

    logger.webhook.processed('paystack', event, eventId, duration)
    return c.json({ received: true })
  } catch (error) {
    logger.webhook.failed('paystack', event, eventId, error instanceof Error ? error : new Error(String(error)))

    // Record the failure
    await db.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        processedAt: new Date(),
        processingTimeMs: Date.now() - startTime,
      },
    }).catch(() => {})

    // Critical events should return 500 so Paystack retries on transient failures
    // All payout and refund state transitions are critical - if we fail to record them, state drifts
    const criticalEvents = [
      'charge.success',
      'transfer.success',
      'transfer.failed',
      'transfer.requires_otp',
      'refund.processed',  // Refund affects LTV and balance
    ]

    if (criticalEvents.includes(event)) {
      // Return 500 for critical events - Paystack will retry
      return c.json({ error: 'Processing failed, will retry' }, 500)
    }

    // Return 200 for non-critical events to prevent unnecessary retries
    return c.json({ received: true, error: 'Processing failed - logged for review' })
  }
})

// Handle Paystack charge.success
async function handlePaystackChargeSuccess(data: any, eventId: string) {
  const {
    reference,
    amount, // This is total amount subscriber paid (gross)
    currency,
    customer,
    authorization,
    metadata,
    paid_at, // ISO timestamp of when payment was made
  } = data

  // Parse paid_at for accurate occurredAt (Paystack provides ISO string)
  const occurredAt = paid_at ? new Date(paid_at) : new Date()

  // IDEMPOTENCY CHECK: Skip if we've already processed this event
  // This prevents double-processing on webhook retries
  const existingPayment = await db.payment.findFirst({
    where: { paystackEventId: eventId },
  })
  if (existingPayment) {
    console.log(`[paystack] Event ${eventId} already processed, skipping`)
    return
  }

  // Validate webhook metadata - provider signature already verified, this validates data integrity
  const metadataValidation = validatePaystackMetadata(metadata)
  if (!metadataValidation.valid) {
    console.error(`[paystack] Invalid metadata for event ${eventId}: ${metadataValidation.error}`)
    throw new Error(`Invalid metadata: ${metadataValidation.error}`)
  }

  const validatedMeta = metadataValidation.data!
  const creatorId = validatedMeta.creatorId
  const tierId = validatedMeta.tierId
  const requestId = metadata?.requestId // requestId not in schema but may be present
  const interval = validatedMeta.interval
  const viewId = validatedMeta.viewId

  // Fee metadata from validated schema
  const feeModel = validatedMeta.feeModel || null
  const feeMode = validatedMeta.feeMode || 'pass_to_subscriber'
  // Paystack metadata uses numbers, not strings
  const netAmount = validatedMeta.creatorAmount || 0
  const serviceFee = validatedMeta.serviceFee || 0
  const feeEffectiveRate = validatedMeta.feeEffectiveRate || null
  const feeWasCapped = validatedMeta.feeWasCapped === true

  console.log(`[paystack] Processing charge ${reference} for creator ${sanitizeForLog(creatorId)}`)

  // Server-side conversion tracking (more reliable than client-side)
  // Only update the specific view that was passed - no fallback to avoid overcounting
  if (viewId) {
    await db.pageView.update({
      where: { id: viewId },
      data: { startedCheckout: true, completedCheckout: true },
    }).catch(() => {}) // Ignore if view doesn't exist
  }

  // If this checkout was triggered by a request, finalize it
  if (requestId) {
    await db.request.update({
      where: { id: requestId },
      data: {
        status: 'accepted',
        respondedAt: new Date(),
        paystackTransactionRef: reference,
      },
    })

    const request = await db.request.findUnique({ where: { id: requestId } })
    if (request) {
      await db.activity.create({
        data: {
          userId: creatorId,
          type: 'request_accepted',
          payload: {
            requestId: request.id,
            recipientName: request.recipientName,
            amount: request.amountCents,
            provider: 'paystack',
          },
        },
      })
    }
  }

  // Get or create subscriber user
  let subscriber = await db.user.findUnique({
    where: { email: customer?.email || '' },
  })

  if (!subscriber && customer?.email) {
    subscriber = await db.user.create({
      data: { email: customer.email },
    })
  }

  if (!subscriber) {
    console.error('Could not find or create subscriber for Paystack payment')
    return
  }

  // Get creator profile for tier info and bank details
  const creatorProfile = await db.profile.findUnique({
    where: { userId: creatorId },
  })

  let tierName: string | null = null
  if (tierId && creatorProfile?.tiers) {
    const tiers = creatorProfile.tiers as any[]
    const tier = tiers.find(t => t.id === tierId)
    tierName = tier?.name || null
  }

  // Calculate fees - use new model if metadata present, else legacy
  let feeCents: number
  let netCents: number
  let grossCents: number | null = null
  let basePrice: number  // Creator's set price - this is what fees are calculated on for renewals

  const hasNewFeeModel = feeModel && netAmount > 0
  if (feeModel === 'flat' && hasNewFeeModel) {
    // New flat fee model with feeMode
    grossCents = amount  // Total subscriber paid
    feeCents = serviceFee
    netCents = netAmount  // What creator receives (depends on feeMode)

    // CRITICAL: Store creator's set price for renewal fee calculation
    // In absorb mode: creator sets price = what subscriber pays (gross)
    // In pass_to_subscriber mode: creator sets price = what they receive (net)
    basePrice = feeMode === 'absorb' ? amount : netCents
  } else if (feeModel?.startsWith('progressive') && hasNewFeeModel) {
    // Legacy progressive model (backward compatibility)
    grossCents = amount
    feeCents = serviceFee
    netCents = netAmount
    basePrice = feeMode === 'absorb' ? amount : netCents
  } else {
    // Legacy model: fee deducted from creator's earnings
    const purpose = creatorProfile?.purpose as 'personal' | 'service' | null
    const legacyFees = calculateLegacyFee(amount, purpose)
    feeCents = legacyFees.feeCents
    netCents = legacyFees.netCents
    basePrice = amount  // Legacy used gross as base
  }

  // Create or update subscription (upsert based on unique constraint)
  const subscriptionInterval = interval === 'month' ? 'month' : 'one_time'

  // DISTRIBUTED LOCK: Prevent race conditions when processing concurrent webhooks
  // Lock key based on subscriber + creator to prevent duplicate subscriptions
  const lockKey = `sub:${subscriber.id}:${creatorId}:${subscriptionInterval}`
  const subscription = await withLock(lockKey, 30000, async () => {
    // Use transaction to ensure atomic creation of subscription + payment + activity
    return await db.$transaction(async (tx) => {
    // IMPORTANT: Store creator's SET PRICE for fee calculation on renewals
    // This ensures recurring billing calculates fees correctly regardless of feeMode
    const newSubscription = await tx.subscription.upsert({
      where: {
        subscriberId_creatorId_interval: {
          subscriberId: subscriber.id,
          creatorId,
          interval: subscriptionInterval,
        },
      },
      create: {
        creatorId,
        subscriberId: subscriber.id,
        tierId: tierId || null,
        tierName,
        amount: basePrice, // Creator's SET PRICE - fees calculated on this for renewals
        currency: currency?.toUpperCase() || 'NGN',
        interval: subscriptionInterval,
        status: 'active',
        ltvCents: netCents, // Initialize LTV with creator's earnings (net)
        // SECURITY: Encrypt authorization code at rest
        paystackAuthorizationCode: encryptAuthorizationCode(authorization?.authorization_code || null),
        paystackCustomerCode: customer?.customer_code || null,
        feeModel: feeModel || null,
        feeMode: feeMode || null, // Lock fee mode at subscription creation for consistent renewals
        currentPeriodEnd: interval === 'month'
          ? addOneMonth(new Date()) // Proper calendar month, not 30 days
          : null,
      },
      update: {
        // Note: feeMode is NOT updated - it stays locked to the value at subscription creation
        // SECURITY: Encrypt authorization code at rest
        paystackAuthorizationCode: encryptAuthorizationCode(authorization?.authorization_code || null),
        paystackCustomerCode: customer?.customer_code || null,
        ltvCents: { increment: netCents }, // LTV is creator's earnings (net)
        currentPeriodEnd: interval === 'month'
          ? addOneMonth(new Date()) // Proper calendar month, not 30 days
          : undefined,
      },
    })

    // Create payment record with idempotency key
    await tx.payment.create({
      data: {
        subscriptionId: newSubscription.id,
        creatorId,
        subscriberId: subscriber.id,
        grossCents,
        amountCents: grossCents || amount,
        currency: currency?.toUpperCase() || 'NGN',
        feeCents,
        netCents,
        feeModel: feeModel || null,
        feeEffectiveRate,
        feeWasCapped,
        type: subscriptionInterval === 'month' ? 'recurring' : 'one_time',
        status: 'succeeded',
        occurredAt,
        paystackEventId: eventId,
        paystackTransactionRef: reference,
      },
    })

    // Create activity event
    await tx.activity.create({
      data: {
        userId: creatorId,
        type: 'subscription_created',
        payload: {
          subscriptionId: newSubscription.id,
          subscriberEmail: customer?.email,
          tierName,
          amount: netCents, // Show creator their earnings
          currency,
          provider: 'paystack',
        },
      },
    })

    return newSubscription
    })
  })

  // If lock couldn't be acquired, another process is handling this
  if (!subscription) {
    console.log(`[paystack] Lock not acquired for ${lockKey}, skipping (another process handling)`)
    return
  }

  // For new fee model: Platform received full payment, now transfer to creator
  // This is done AFTER the transaction to ensure we don't transfer if DB write fails
  // Supports both 'flat' and 'progressive' fee models
  if (feeModel && creatorProfile?.paystackBankCode && creatorProfile?.paystackAccountNumber) {
    // Lock to prevent duplicate payout processing on webhook retry
    const payoutReference = `PAYOUT-${reference}`
    const payoutLockKey = `payout:${payoutReference}`

    await withLock(payoutLockKey, 30000, async () => {
      // Idempotency check: ensure we don't double-transfer on webhook retry
      const existingPayout = await db.payment.findFirst({
        where: {
          paystackTransactionRef: payoutReference,
          type: 'payout',
        },
      })

      if (existingPayout) {
        console.log(`[paystack] Payout ${payoutReference} already exists, skipping transfer`)
        return
      }

      // PLATFORM DEBIT RECOVERY for Paystack
      // When a service provider's platform subscription fails, we accumulate debit
      // and recover it by reducing their transfer amount
      let platformDebitRecovered = 0
      if (creatorProfile?.purpose === 'service' && (creatorProfile.platformDebitCents || 0) > 0) {
        // Recover up to $30 equivalent or the net amount, whichever is less
        // For simplicity, use a fixed cap (3000 cents = $30 equivalent)
        const maxRecovery = Math.min(creatorProfile.platformDebitCents || 0, 3000, netCents)
        platformDebitRecovered = maxRecovery
      }

      // Calculate final transfer amount after debit recovery
      const finalTransferAmount = netCents - platformDebitRecovered

      try {
        // Decrypt the stored account number
        const accountNumber = decryptAccountNumber(creatorProfile.paystackAccountNumber)
        const bankCode = creatorProfile.paystackBankCode

        if (!accountNumber || !bankCode) {
          console.error(`[paystack] Could not decrypt account number for creator ${creatorId}`)
          // Record failed payout for manual intervention
          await db.payment.create({
            data: {
              subscriptionId: subscription.id,
              creatorId,
              subscriberId: subscriber.id,
              amountCents: finalTransferAmount,
              currency: currency?.toUpperCase() || 'NGN',
              feeCents: 0,
              netCents: finalTransferAmount,
              feeModel: feeModel || null,
              feeEffectiveRate,
              feeWasCapped,
              platformDebitRecoveredCents: platformDebitRecovered,
              type: 'payout',
              status: 'failed',
              paystackTransactionRef: payoutReference,
            },
          })
        } else {
          // Create payout record FIRST (before transfer attempt)
          // This ensures we track all payout attempts for retry/audit
          const payoutRecord = await db.payment.create({
            data: {
              subscriptionId: subscription.id,
              creatorId,
              subscriberId: subscriber.id,
              amountCents: finalTransferAmount,
              currency: currency?.toUpperCase() || 'NGN',
              feeCents: 0,
              netCents: finalTransferAmount,
              feeModel: feeModel || null,
              feeEffectiveRate,
              feeWasCapped,
              platformDebitRecoveredCents: platformDebitRecovered,
              type: 'payout',
              status: 'pending', // Will be updated by transfer.success/failed webhook
              paystackTransactionRef: payoutReference,
            },
          })

          try {
            // Create transfer recipient if not exists (cached by Paystack)
            const { recipientCode } = await createTransferRecipient({
              name: creatorProfile.displayName,
              accountNumber,
              bankCode,
              currency: currency?.toUpperCase() || 'NGN',
            })

            // Initiate transfer to creator (reduced by debit recovery)
            const transferResult = await initiateTransfer({
              amount: finalTransferAmount,
              recipientCode,
              reason: `Payment from ${customer?.email || 'subscriber'}`,
              reference: payoutReference,
            })

            // Store transfer code and handle OTP requirement
            const transferStatus = transferResult.status === 'otp' ? 'otp_pending' : 'pending'
            await db.payment.update({
              where: { id: payoutRecord.id },
              data: {
                paystackTransferCode: transferResult.transferCode,
                status: transferStatus as any,
              },
            })

            // Clear platform debit if recovered
            if (platformDebitRecovered > 0) {
              await db.profile.update({
                where: { userId: creatorId },
                data: {
                  platformDebitCents: { decrement: platformDebitRecovered },
                },
              })

              // Create activity for audit trail
              await db.activity.create({
                data: {
                  userId: creatorId,
                  type: 'platform_debit_recovered',
                  payload: {
                    amountCents: platformDebitRecovered,
                    source: 'paystack_payment',
                    transactionRef: reference,
                    originalNetCents: netCents,
                    finalTransferAmount,
                  },
                },
              })

              console.log(`[paystack] Recovered ${platformDebitRecovered} platform debit, transferring ${finalTransferAmount} to creator ${creatorId}`)
            }

            if (transferResult.status === 'otp') {
              console.log(`[paystack] Transfer ${payoutReference} requires OTP finalization`)
            } else {
              console.log(`[paystack] Initiated transfer of ${finalTransferAmount} to creator ${creatorId}`)
            }
          } catch (transferErr) {
            // Transfer failed - update payout record for manual retry
            console.error(`[paystack] Transfer failed for creator ${creatorId}:`, transferErr)
            await db.payment.update({
              where: { id: payoutRecord.id },
              data: { status: 'failed' },
            })
          }
        }
      } catch (err) {
        // Outer catch for unexpected errors (e.g., DB issues)
        console.error(`[paystack] Failed to process payout for creator ${creatorId}:`, err)
      }
    }) // End withLock for payout
  }

  // Send notification email to creator
  const creator = await db.user.findUnique({ where: { id: creatorId } })
  if (creator) {
    await sendNewSubscriberEmail(
      creator.email,
      customer?.email || 'Someone',
      tierName,
      netCents, // Show creator their earnings
      currency?.toUpperCase() || 'NGN'
    )
  }
}

// Handle Paystack charge.failed
async function handlePaystackChargeFailed(data: any) {
  const { metadata, reference } = data

  const subscriptionId = metadata?.subscriptionId

  if (subscriptionId) {
    // This is a failed recurring charge
    await db.subscription.update({
      where: { id: subscriptionId },
      data: { status: 'past_due' },
    })

    console.log(`Paystack charge failed for subscription ${subscriptionId}, ref: ${reference}`)
  }
}

// Handle Paystack transfer.success - update payout record
async function handlePaystackTransferSuccess(data: any) {
  const { reference, amount, currency, recipient } = data

  // Find the payout record by reference
  const payout = await db.payment.findFirst({
    where: {
      paystackTransactionRef: reference,
      type: 'payout',
    },
  })

  if (!payout) {
    console.log(`[paystack] Transfer success but no payout record found: ${reference}`)
    return
  }

  // IDEMPOTENCY: Skip if already marked as succeeded
  if (payout.status === 'succeeded') {
    console.log(`[paystack] Transfer ${reference} already marked succeeded, skipping`)
    return
  }

  // SECURITY: Verify amount and currency match our payout record
  // Mismatches could indicate data corruption, webhook tampering, or bugs
  const webhookCurrency = currency?.toUpperCase()
  const payoutCurrency = payout.currency?.toUpperCase()

  // Amount from Paystack is in smallest unit (kobo/cents), same as our amountCents
  const amountMismatch = amount !== payout.amountCents
  const currencyMismatch = webhookCurrency && payoutCurrency && webhookCurrency !== payoutCurrency

  if (amountMismatch || currencyMismatch) {
    // Log critical alert - this should never happen in normal operation
    // All details captured in log for investigation
    console.error(`[paystack] CRITICAL: Transfer amount/currency mismatch!`, {
      reference,
      payoutId: payout.id,
      webhookAmount: amount,
      payoutAmount: payout.amountCents,
      webhookCurrency,
      payoutCurrency,
      creatorId: payout.creatorId,
    })

    // Mark payout as disputed (requires manual investigation)
    // This prevents incorrect balance tracking while preserving the record
    await db.payment.update({
      where: { id: payout.id },
      data: { status: 'disputed' },
    })

    // Create activity for ops team to investigate
    await db.activity.create({
      data: {
        userId: payout.creatorId,
        type: 'payout_mismatch',
        payload: {
          payoutId: payout.id,
          reference,
          webhookAmount: amount,
          payoutAmount: payout.amountCents,
          webhookCurrency,
          payoutCurrency,
        },
      },
    })

    // Throw to trigger webhook retry and alert ops team
    throw new Error(`Transfer amount/currency mismatch for ${reference}`)
  }

  // Update payout status to succeeded
  await db.payment.update({
    where: { id: payout.id },
    data: { status: 'succeeded' },
  })

  // Schedule payout completed email notification (sends immediately)
  await scheduleReminder({
    userId: payout.creatorId,
    entityType: 'payment',
    entityId: payout.id,
    type: 'payout_completed',
    scheduledFor: new Date(), // Send immediately
  })

  // Create activity for creator (only on first processing)
  await db.activity.create({
    data: {
      userId: payout.creatorId,
      type: 'payout_completed',
      payload: {
        payoutId: payout.id,
        amount: amount,
        currency: payout.currency,
        reference,
        recipientName: recipient?.name,
      },
    },
  })

  console.log(`[paystack] Transfer succeeded: ${reference}, amount: ${amount}`)
}

// Handle Paystack transfer.failed - update payout record and notify creator
async function handlePaystackTransferFailed(data: any) {
  const { reference, reason, recipient } = data

  // Find the payout record
  const payout = await db.payment.findFirst({
    where: {
      paystackTransactionRef: reference,
      type: 'payout',
    },
  })

  if (!payout) {
    console.log(`[paystack] Transfer failed but no payout record found: ${reference}`)
    return
  }

  // IDEMPOTENCY: Skip if already marked as failed
  // (also skip if succeeded - a success can't become a failure)
  if (payout.status === 'failed' || payout.status === 'succeeded') {
    console.log(`[paystack] Transfer ${reference} already in final state (${payout.status}), skipping`)
    return
  }

  // Update payout status to failed
  await db.payment.update({
    where: { id: payout.id },
    data: { status: 'failed' },
  })

  // Update creator's payout status to indicate issue
  const creatorProfile = await db.profile.findUnique({
    where: { userId: payout.creatorId },
  })

  if (creatorProfile) {
    await db.profile.update({
      where: { id: creatorProfile.id },
      data: { payoutStatus: 'restricted' },
    })
  }

  // Schedule payout failed email notification (sends immediately)
  await scheduleReminder({
    userId: payout.creatorId,
    entityType: 'payment',
    entityId: payout.id,
    type: 'payout_failed',
    scheduledFor: new Date(), // Send immediately
  })

  // Create activity for creator notification (only on first processing)
  await db.activity.create({
    data: {
      userId: payout.creatorId,
      type: 'payout_failed',
      payload: {
        payoutId: payout.id,
        amount: payout.amountCents,
        currency: payout.currency,
        reference,
        reason: reason || 'Transfer failed',
        recipientName: recipient?.name,
      },
    },
  })

  console.log(`[paystack] Transfer failed: ${reference}, reason: ${reason}`)
}

// Handle Paystack transfer.requires_otp - mark payout as needing OTP finalization
async function handlePaystackTransferRequiresOtp(data: any) {
  const { reference, transfer_code: transferCode } = data

  // Find the payout record
  const payout = await db.payment.findFirst({
    where: {
      paystackTransactionRef: reference,
      type: 'payout',
    },
  })

  if (!payout) {
    console.log(`[paystack] Transfer requires OTP but no payout record found: ${reference}`)
    return
  }

  // Update payout to otp_pending status and store transfer code
  await db.payment.update({
    where: { id: payout.id },
    data: {
      status: 'otp_pending',
      paystackTransferCode: transferCode,
    },
  })

  // Create activity for creator notification
  await db.activity.create({
    data: {
      userId: payout.creatorId,
      type: 'payout_otp_required',
      payload: {
        payoutId: payout.id,
        amount: payout.amountCents,
        currency: payout.currency,
        reference,
        transferCode,
        message: 'Transfer requires OTP verification. Please check your email/phone for the OTP.',
      },
    },
  })

  console.log(`[paystack] Transfer requires OTP: ${reference}, transfer_code: ${transferCode}`)
}

// ============================================
// PAYSTACK REFUND HANDLERS
// ============================================

// Handle Paystack refund.processed - refund completed successfully
async function handlePaystackRefundProcessed(data: any, eventId: string) {
  const { transaction, amount, currency } = data
  const transactionRef = transaction?.reference || data.transaction_reference

  if (!transactionRef) {
    console.error('[paystack] Refund processed but no transaction reference')
    return
  }

  // Find the original payment by transaction reference
  const originalPayment = await db.payment.findFirst({
    where: {
      paystackTransactionRef: transactionRef,
      type: { in: ['recurring', 'one_time'] },
      status: 'succeeded',
    },
    include: {
      subscription: {
        include: {
          creator: {
            include: { profile: { select: { purpose: true } } },
          },
        },
      },
    },
  })

  if (!originalPayment) {
    console.log(`[paystack] Refund processed but no original payment found: ${transactionRef}`)
    return
  }

  // IDEMPOTENCY: Check if refund already recorded
  const existingRefund = await db.payment.findFirst({
    where: { paystackEventId: eventId },
  })
  if (existingRefund) {
    console.log(`[paystack] Refund ${eventId} already processed, skipping`)
    return
  }

  // Calculate refund fees using original payment's fee ratio
  const refundAmount = amount || originalPayment.amountCents
  let feeCents = 0
  let netCents = refundAmount

  if (originalPayment.grossCents && originalPayment.feeCents) {
    // Use original fee ratio for accurate refund calculation
    const feeRatio = originalPayment.feeCents / originalPayment.grossCents
    const netRatio = originalPayment.netCents / originalPayment.grossCents
    feeCents = Math.round(refundAmount * feeRatio)
    netCents = Math.round(refundAmount * netRatio)
  }

  // Create refund payment record (negative amounts)
  // Use eventId for uniqueness to support multiple partial refunds for same transaction
  await db.payment.create({
    data: {
      subscriptionId: originalPayment.subscriptionId,
      creatorId: originalPayment.creatorId,
      subscriberId: originalPayment.subscriberId,
      amountCents: -refundAmount, // Negative for refund
      currency: currency?.toUpperCase() || originalPayment.currency,
      feeCents: -feeCents,
      netCents: -netCents,
      type: 'refund',
      status: 'refunded',
      paystackEventId: eventId,
      paystackTransactionRef: `REF-${eventId}`, // Use eventId for uniqueness (supports partial refunds)
      feeModel: originalPayment.feeModel,
    },
  })

  // Decrement LTV if subscription exists
  if (originalPayment.subscriptionId) {
    const subscription = await db.subscription.findUnique({
      where: { id: originalPayment.subscriptionId },
    })
    if (subscription) {
      // Don't let LTV go negative
      const decrementAmount = Math.min(netCents, subscription.ltvCents)
      await db.subscription.update({
        where: { id: originalPayment.subscriptionId },
        data: { ltvCents: { decrement: decrementAmount } },
      })
    }
  }

  // Create activity for creator notification
  await db.activity.create({
    data: {
      userId: originalPayment.creatorId,
      type: 'payment_refunded',
      payload: {
        subscriptionId: originalPayment.subscriptionId,
        originalPaymentId: originalPayment.id,
        amount: refundAmount,
        currency: currency?.toUpperCase() || originalPayment.currency,
        reason: data.refund_reason || 'Customer requested refund',
      },
    },
  })

  console.log(`[paystack] Refund processed: ${transactionRef}, amount: ${refundAmount}`)
}

// Handle Paystack refund.pending - refund is being processed
async function handlePaystackRefundPending(data: any, eventId: string) {
  const { transaction } = data
  const transactionRef = transaction?.reference || data.transaction_reference

  console.log(`[paystack] Refund pending for transaction: ${transactionRef}`)

  // We don't create a payment record yet - wait for refund.processed
  // Just log for monitoring
}

// Handle Paystack refund.failed - refund attempt failed
async function handlePaystackRefundFailed(data: any, eventId: string) {
  const { transaction, reason } = data
  const transactionRef = transaction?.reference || data.transaction_reference

  console.error(`[paystack] Refund failed for transaction: ${transactionRef}`, {
    reason: reason || 'Unknown reason',
    eventId,
  })

  // Find the original payment to notify creator
  const originalPayment = await db.payment.findFirst({
    where: {
      paystackTransactionRef: transactionRef,
      type: { in: ['recurring', 'one_time'] },
    },
  })

  if (originalPayment) {
    // Create activity for ops team to investigate
    await db.activity.create({
      data: {
        userId: originalPayment.creatorId,
        type: 'refund_failed',
        payload: {
          transactionRef,
          reason: reason || 'Refund processing failed',
          eventId,
        },
      },
    })
  }
}

export default webhooks
