// Platform Subscription Service
// Handles the $5/mo subscription for service users
// Uses Stripe Customer Portal for subscription management

import Stripe from 'stripe'
import { env } from '../config/env.js'
import { db } from '../db/client.js'
import { PLATFORM_SUBSCRIPTION_PRICE_CENTS } from './pricing.js'

const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-11-17.clover',
})

// Product and price IDs (created in Stripe dashboard or via API)
// These should be created once and stored
let platformProductId: string | null = null
let platformPriceId: string | null = null

/**
 * Get or create the platform subscription product and price
 * This should be called once at startup or on first use
 */
async function ensurePlatformProduct(): Promise<{ productId: string; priceId: string }> {
  if (platformProductId && platformPriceId) {
    return { productId: platformProductId, priceId: platformPriceId }
  }

  // Search for existing product
  const existingProducts = await stripe.products.search({
    query: 'metadata["type"]:"platform_subscription"',
    limit: 1,
  })

  if (existingProducts.data.length > 0) {
    const product = existingProducts.data[0]
    platformProductId = product.id

    // Find the active price
    const prices = await stripe.prices.list({
      product: product.id,
      active: true,
      limit: 1,
    })

    if (prices.data.length > 0) {
      platformPriceId = prices.data[0].id
      return { productId: platformProductId, priceId: platformPriceId }
    }
  }

  // Create new product
  const product = await stripe.products.create({
    name: 'Nate Service Plan',
    description: 'Monthly subscription for service providers on Nate',
    metadata: {
      type: 'platform_subscription',
    },
  })
  platformProductId = product.id

  // Create price
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: PLATFORM_SUBSCRIPTION_PRICE_CENTS,
    currency: 'usd',
    recurring: {
      interval: 'month',
    },
    metadata: {
      type: 'platform_subscription',
    },
  })
  platformPriceId = price.id

  console.log(`[platform] Created product ${product.id} and price ${price.id}`)

  return { productId: platformProductId, priceId: platformPriceId }
}

/**
 * Create or get a Stripe customer for a user
 */
async function getOrCreateCustomer(
  userId: string,
  email: string
): Promise<string> {
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { platformCustomerId: true },
  })

  if (profile?.platformCustomerId) {
    return profile.platformCustomerId
  }

  // Create new customer
  const customer = await stripe.customers.create({
    email,
    metadata: {
      userId,
      type: 'platform_customer',
    },
  })

  // Save to profile
  await db.profile.update({
    where: { userId },
    data: { platformCustomerId: customer.id },
  })

  return customer.id
}

/**
 * Create a checkout session for the platform subscription
 * Returns the checkout URL
 */
export async function createPlatformCheckout(
  userId: string,
  email: string,
  successUrl: string,
  cancelUrl: string
): Promise<{ url: string; sessionId: string }> {
  const { priceId } = await ensurePlatformProduct()
  const customerId = await getOrCreateCustomer(userId, email)

  // Check if already subscribed
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { platformSubscriptionStatus: true },
  })

  if (profile?.platformSubscriptionStatus === 'active') {
    throw new Error('Already subscribed to platform')
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      userId,
      type: 'platform_subscription',
    },
  })

  return {
    url: session.url!,
    sessionId: session.id,
  }
}

/**
 * Create a customer portal session for managing subscription
 */
export async function createPortalSession(
  userId: string,
  returnUrl: string
): Promise<{ url: string }> {
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { platformCustomerId: true },
  })

  if (!profile?.platformCustomerId) {
    throw new Error('No platform customer found')
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: profile.platformCustomerId,
    return_url: returnUrl,
  })

  return { url: session.url }
}

/**
 * Get the platform subscription status for a user
 */
export async function getPlatformSubscriptionStatus(userId: string): Promise<{
  status: string | null
  subscriptionId: string | null
  currentPeriodEnd: Date | null
  cancelAtPeriodEnd: boolean
}> {
  const profile = await db.profile.findUnique({
    where: { userId },
    select: {
      platformSubscriptionId: true,
      platformSubscriptionStatus: true,
    },
  })

  if (!profile?.platformSubscriptionId) {
    return {
      status: null,
      subscriptionId: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    }
  }

  // Get fresh status from Stripe
  try {
    const subscription = await stripe.subscriptions.retrieve(profile.platformSubscriptionId)
    // Access properties with type assertion for API compatibility
    const sub = subscription as any
    return {
      status: sub.status,
      subscriptionId: sub.id,
      currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
      cancelAtPeriodEnd: sub.cancel_at_period_end || false,
    }
  } catch {
    return {
      status: profile.platformSubscriptionStatus,
      subscriptionId: profile.platformSubscriptionId,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    }
  }
}

/**
 * Handle platform subscription webhook events
 */
export async function handlePlatformSubscriptionEvent(
  event: Stripe.Event
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      if (session.metadata?.type !== 'platform_subscription') return

      const userId = session.metadata.userId
      const subscriptionId = session.subscription as string

      // Get subscription details
      const subscription = await stripe.subscriptions.retrieve(subscriptionId)

      await db.profile.update({
        where: { userId },
        data: {
          platformSubscriptionId: subscriptionId,
          platformSubscriptionStatus: subscription.status,
        },
      })

      console.log(`[platform] User ${userId} subscribed: ${subscriptionId}`)
      break
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription
      const customerId = subscription.customer as string

      // Find user by customer ID
      const profile = await db.profile.findFirst({
        where: { platformCustomerId: customerId },
      })

      if (profile) {
        await db.profile.update({
          where: { id: profile.id },
          data: {
            platformSubscriptionStatus: subscription.status,
          },
        })
        console.log(`[platform] Subscription ${subscription.id} updated: ${subscription.status}`)
      }
      break
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription
      const customerId = subscription.customer as string

      const profile = await db.profile.findFirst({
        where: { platformCustomerId: customerId },
      })

      if (profile) {
        await db.profile.update({
          where: { id: profile.id },
          data: {
            platformSubscriptionStatus: 'canceled',
          },
        })
        console.log(`[platform] Subscription ${subscription.id} canceled`)
      }
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string

      const profile = await db.profile.findFirst({
        where: { platformCustomerId: customerId },
      })

      if (profile) {
        await db.profile.update({
          where: { id: profile.id },
          data: {
            platformSubscriptionStatus: 'past_due',
          },
        })
        console.log(`[platform] Subscription payment failed for customer ${customerId}`)
      }
      break
    }
  }
}
