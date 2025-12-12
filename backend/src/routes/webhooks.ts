import { Hono } from 'hono'
import crypto from 'crypto'
import Stripe from 'stripe'
import { stripe } from '../services/stripe.js'
import { db } from '../db/client.js'
import { env } from '../config/env.js'
import { sendNewSubscriberEmail } from '../services/email.js'
import { handlePlatformSubscriptionEvent } from '../services/platformSubscription.js'
import { calculateFees, type UserPurpose } from '../services/pricing.js'
import { webhookRateLimit } from '../middleware/rateLimit.js'

const webhooks = new Hono()

// Apply rate limiting to all webhook endpoints (100 requests/hour per IP)
webhooks.use('*', webhookRateLimit)

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

  // Idempotency check - have we already processed this event?
  const existingPayment = await db.payment.findUnique({
    where: { stripeEventId: event.id },
  })

  if (existingPayment) {
    // Already processed, return success
    return c.json({ received: true, status: 'already_processed' })
  }

  try {
    // Check if this is a platform subscription event
    const isPlatformEvent = isPlatformSubscriptionEvent(event)
    if (isPlatformEvent) {
      await handlePlatformSubscriptionEvent(event)
      return c.json({ received: true, type: 'platform_subscription' })
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event)
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

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return c.json({ received: true })
  } catch (error) {
    // Log the error but return 200 to prevent unnecessary retries
    // Stripe will retry on 500, but processing errors shouldn't trigger retries
    // Only infrastructure errors (signature validation, JSON parsing) should return non-200
    console.error(`[stripe] Error processing webhook ${event.type}:`, error)
    return c.json({ received: true, error: 'Processing failed - logged for review' })
  }
})

// Handle checkout.session.completed
async function handleCheckoutCompleted(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session

  const creatorId = session.metadata?.creatorId
  const tierId = session.metadata?.tierId
  const requestId = session.metadata?.requestId
  const viewId = session.metadata?.viewId

  if (!creatorId) {
    console.error('Missing creatorId in session metadata')
    return
  }

  // Server-side conversion tracking (more reliable than client-side)
  if (viewId) {
    // If viewId was passed, mark that specific view as converted
    await db.pageView.update({
      where: { id: viewId },
      data: { startedCheckout: true },
    }).catch(() => {}) // Ignore if view doesn't exist
  } else {
    // Fallback: find most recent view for this profile in last hour
    const creatorProfile = await db.profile.findUnique({
      where: { userId: creatorId },
      select: { id: true },
    })
    if (creatorProfile) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
      await db.pageView.updateMany({
        where: {
          profileId: creatorProfile.id,
          createdAt: { gte: oneHourAgo },
          startedCheckout: false,
        },
        data: { startedCheckout: true },
      })
    }
  }

  // If this checkout was triggered by a request, finalize it
  if (requestId) {
    await db.request.update({
      where: { id: requestId },
      data: {
        status: 'accepted',
        respondedAt: new Date(),
      },
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

  // Calculate fees based on creator's purpose (personal: 10%, service: 8%)
  const purpose = creatorProfile?.purpose as UserPurpose
  const { totalFeeCents: feeCents, netCents } = calculateFees(session.amount_total || 0, purpose)

  // Use transaction to ensure atomic creation of subscription + payment + activity
  const subscription = await db.$transaction(async (tx) => {
    // Create subscription record
    const newSubscription = await tx.subscription.create({
      data: {
        creatorId,
        subscriberId: subscriber.id,
        tierId: tierId || null,
        tierName,
        amount: session.amount_total || 0,
        currency: session.currency?.toUpperCase() || 'USD',
        interval: session.mode === 'subscription' ? 'month' : 'one_time',
        status: 'active',
        stripeSubscriptionId: session.subscription as string || null,
        stripeCustomerId: session.customer as string || null,
      },
    })

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

    // Create payment record with idempotency key
    await tx.payment.create({
      data: {
        subscriptionId: newSubscription.id,
        creatorId,
        subscriberId: subscriber.id,
        amountCents: session.amount_total || 0,
        currency: session.currency?.toUpperCase() || 'USD',
        feeCents,
        netCents,
        type: session.mode === 'subscription' ? 'recurring' : 'one_time',
        status: 'succeeded',
        stripeEventId: event.id, // Idempotency key
        stripePaymentIntentId: session.payment_intent as string || null,
        stripeChargeId,
      },
    })

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

// Handle invoice.paid (recurring payments)
async function handleInvoicePaid(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice

  // Get subscription ID from invoice - use subscription_details in newer API versions
  const subscriptionId = (invoice as any).subscription_details?.subscription
    || (invoice as any).subscription

  if (!subscriptionId) return

  const subscription = await db.subscription.findUnique({
    where: { stripeSubscriptionId: subscriptionId },
    include: {
      creator: {
        include: { profile: { select: { purpose: true } } },
      },
    },
  })

  if (!subscription) return

  // Update subscription period
  await db.subscription.update({
    where: { id: subscription.id },
    data: {
      currentPeriodEnd: invoice.lines.data[0]?.period?.end
        ? new Date(invoice.lines.data[0].period.end * 1000)
        : null,
      ltvCents: { increment: invoice.amount_paid },
    },
  })

  // Calculate fees based on creator's purpose (personal: 10%, service: 8%)
  const purpose = subscription.creator?.profile?.purpose as UserPurpose
  const { totalFeeCents: feeCents, netCents } = calculateFees(invoice.amount_paid, purpose)

  // Create payment record with charge ID
  // Use type casting for properties that may vary across Stripe API versions
  const invoiceAny = invoice as any
  await db.payment.create({
    data: {
      subscriptionId: subscription.id,
      creatorId: subscription.creatorId,
      subscriberId: subscription.subscriberId,
      amountCents: invoice.amount_paid,
      currency: invoice.currency.toUpperCase(),
      feeCents,
      netCents,
      type: 'recurring',
      status: 'succeeded',
      stripeEventId: event.id,
      stripePaymentIntentId: invoiceAny.payment_intent as string || null,
      stripeChargeId: invoiceAny.charge as string || null,
    },
  })

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

  // Look up the subscription via customer
  const stripeCustomerId = charge.customer as string
  if (!stripeCustomerId) return

  const subscription = await db.subscription.findFirst({
    where: { stripeCustomerId },
    orderBy: { createdAt: 'desc' },
    include: {
      creator: {
        include: { profile: { select: { purpose: true } } },
      },
    },
  })

  if (!subscription) {
    console.log('No subscription found for refunded charge')
    return
  }

  const refundAmount = charge.amount_refunded

  // Calculate refund fees based on creator's purpose (reverse the original fee)
  const creatorPurpose = subscription.creator?.profile?.purpose as UserPurpose
  const { totalFeeCents: feeCents, netCents } = calculateFees(refundAmount, creatorPurpose)

  // Create refund payment record
  await db.payment.create({
    data: {
      subscriptionId: subscription.id,
      creatorId: subscription.creatorId,
      subscriberId: subscription.subscriberId,
      amountCents: -refundAmount, // Negative for refund
      currency: charge.currency.toUpperCase(),
      feeCents: -feeCents, // Reverse the fee (using actual creator rate)
      netCents: -netCents,
      type: subscription.interval === 'month' ? 'recurring' : 'one_time',
      status: 'refunded',
      stripeEventId: event.id,
    },
  })

  // Update subscription LTV
  await db.subscription.update({
    where: { id: subscription.id },
    data: {
      ltvCents: { decrement: refundAmount },
    },
  })

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
      status: 'pending', // Dispute is open, funds held
      stripeDisputeId: dispute.id, // Track dispute for later resolution
      stripeChargeId: dispute.charge as string || null,
      stripeEventId: event.id,
    },
  })

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

  // Update the dispute payment status
  await db.payment.update({
    where: { id: disputePayment.id },
    data: {
      status: won ? 'refunded' : 'succeeded',
      // If won, the negative amount reverses (funds returned)
      // If lost, the negative amount stands (funds lost)
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

// ============================================
// PAYSTACK WEBHOOKS
// ============================================

// Verify Paystack webhook signature
function verifyPaystackSignature(body: string, signature: string): boolean {
  const webhookSecret = env.PAYSTACK_WEBHOOK_SECRET
  if (!webhookSecret) return false

  const hash = crypto
    .createHmac('sha512', webhookSecret)
    .update(body)
    .digest('hex')

  return hash === signature
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

  // Use transaction reference or ID for idempotency - REQUIRED
  const eventId = data.id?.toString() || data.reference

  if (!eventId) {
    console.error('[paystack] Webhook missing ID/reference - cannot ensure idempotency:', { event, data })
    return c.json({ error: 'Invalid webhook - missing transaction ID or reference' }, 400)
  }

  // Idempotency check - prevent duplicate processing
  const existingPayment = await db.payment.findUnique({
    where: { paystackEventId: eventId },
  })

  if (existingPayment) {
    console.log(`[paystack] Webhook already processed: ${eventId}`)
    return c.json({ received: true, status: 'already_processed' })
  }

  try {
    switch (event) {
      case 'charge.success':
        await handlePaystackChargeSuccess(data, eventId)
        break

      case 'charge.failed':
        await handlePaystackChargeFailed(data)
        break

      case 'transfer.success':
        console.log('Paystack transfer successful:', data.reference)
        break

      case 'transfer.failed':
        console.log('Paystack transfer failed:', data.reference)
        break

      default:
        console.log(`Unhandled Paystack event: ${event}`)
    }

    return c.json({ received: true })
  } catch (error) {
    // Log the error but return 200 to prevent unnecessary retries
    // Paystack will retry on non-200, but processing errors shouldn't trigger retries
    console.error(`[paystack] Error processing webhook ${event}:`, error)
    return c.json({ received: true, error: 'Processing failed - logged for review' })
  }
})

// Handle Paystack charge.success
async function handlePaystackChargeSuccess(data: any, eventId: string) {
  const {
    reference,
    amount,
    currency,
    customer,
    authorization,
    metadata,
  } = data

  // Extract metadata
  const creatorId = metadata?.creatorId
  const tierId = metadata?.tierId
  const requestId = metadata?.requestId
  const interval = metadata?.interval || 'one_time'

  if (!creatorId) {
    console.error('Missing creatorId in Paystack metadata')
    return
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

  // Calculate fees based on creator's purpose (personal: 10%, service: 8%)
  const purpose = creatorProfile?.purpose as UserPurpose
  const { totalFeeCents: feeCents, netCents } = calculateFees(amount, purpose)

  // Create or update subscription (upsert based on unique constraint)
  const subscriptionInterval = interval === 'month' ? 'month' : 'one_time'

  // Use transaction to ensure atomic creation of subscription + payment + activity
  const subscription = await db.$transaction(async (tx) => {
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
        amount,
        currency: currency?.toUpperCase() || 'NGN',
        interval: subscriptionInterval,
        status: 'active',
        paystackAuthorizationCode: authorization?.authorization_code || null,
        paystackCustomerCode: customer?.customer_code || null,
        currentPeriodEnd: interval === 'month'
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // +30 days
          : null,
      },
      update: {
        paystackAuthorizationCode: authorization?.authorization_code || null,
        paystackCustomerCode: customer?.customer_code || null,
        ltvCents: { increment: amount },
        currentPeriodEnd: interval === 'month'
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          : undefined,
      },
    })

    // Create payment record with idempotency key
    await tx.payment.create({
      data: {
        subscriptionId: newSubscription.id,
        creatorId,
        subscriberId: subscriber.id,
        amountCents: amount,
        currency: currency?.toUpperCase() || 'NGN',
        feeCents,
        netCents,
        type: subscriptionInterval === 'month' ? 'recurring' : 'one_time',
        status: 'succeeded',
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
          amount,
          currency,
          provider: 'paystack',
        },
      },
    })

    return newSubscription
  })

  // Send notification email to creator
  const creator = await db.user.findUnique({ where: { id: creatorId } })
  if (creator) {
    await sendNewSubscriberEmail(
      creator.email,
      customer?.email || 'Someone',
      tierName,
      amount,
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

export default webhooks
