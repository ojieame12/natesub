// Platform Subscription Service
// Handles the $5/mo subscription for service users
// Uses Stripe Customer Portal for subscription management

import Stripe from 'stripe'
import { env } from '../config/env.js'
import { db } from '../db/client.js'
import { PLATFORM_SUBSCRIPTION_PRICE_CENTS } from './pricing.js'
import { sendPlatformDebitNotification, sendPlatformDebitCapReachedNotification } from './email.js'
import { withLock } from './lock.js'
import { invalidatePublicProfileCache } from '../utils/cache.js'

// Platform debit cap in cents ($30 = 6 months of $5/mo)
const PLATFORM_DEBIT_CAP_CENTS = 3000

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
 * Start a platform trial subscription automatically (no checkout required)
 * Used when service users complete onboarding - gives them 14 days free
 * Returns the subscription ID or null if already subscribed
 */
export async function startPlatformTrial(
  userId: string,
  email: string
): Promise<string | null> {
  const lockKey = `platform-trial:${userId}`

  const result = await withLock(lockKey, 30000, async () => {
    // Check if already subscribed
    const profile = await db.profile.findUnique({
      where: { userId },
      select: {
        platformSubscriptionId: true,
        platformSubscriptionStatus: true,
      },
    })

    // Skip if already has a non-canceled subscription
    if (profile?.platformSubscriptionId && profile.platformSubscriptionStatus !== 'canceled') {
      console.log(`[platform] User ${userId} already subscribed, skipping auto-trial`)
      return null
    }

    const { priceId } = await ensurePlatformProduct()
    const customerId = await getOrCreateCustomer(userId, email)

    // Create subscription directly with 60-day trial (no payment required)
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      trial_period_days: 60,
      trial_settings: {
        end_behavior: {
          missing_payment_method: 'cancel', // Cancel if no payment method after trial
        },
      },
      metadata: {
        userId,
        type: 'platform_subscription',
        source: 'onboarding_auto_trial',
      },
    })

    const sub = subscription as any
    const trialEndsAt = sub.trial_end
      ? new Date(sub.trial_end * 1000)
      : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)

    // Save to profile
    await db.profile.update({
      where: { userId },
      data: {
        platformSubscriptionId: subscription.id,
        platformSubscriptionStatus: subscription.status, // 'trialing'
        platformTrialEndsAt: trialEndsAt,
      },
    })

    console.log(`[platform] Auto-started trial for user ${userId}: ${subscription.id} (ends ${trialEndsAt.toISOString()})`)

    return subscription.id
  })

  return result
}

/**
 * Create a checkout session for the platform subscription
 * Returns the checkout URL
 * Uses distributed lock to prevent duplicate subscriptions from concurrent requests
 */
export async function createPlatformCheckout(
  userId: string,
  email: string,
  successUrl: string,
  cancelUrl: string
): Promise<{ url: string; sessionId: string }> {
  // Use lock to prevent race condition where multiple checkout sessions
  // could be created before the first webhook writes platformSubscriptionId
  const lockKey = `platform-checkout:${userId}`

  const result = await withLock(lockKey, 30000, async () => {
    const { priceId } = await ensurePlatformProduct()
    const customerId = await getOrCreateCustomer(userId, email)

    // Check if already subscribed (any status except canceled)
    const profile = await db.profile.findUnique({
      where: { userId },
      select: {
        platformSubscriptionId: true,
        platformSubscriptionStatus: true,
      },
    })

    // Block if subscription exists and isn't canceled
    // This prevents duplicate subscriptions for trialing/active/past_due users
    if (profile?.platformSubscriptionId && profile.platformSubscriptionStatus !== 'canceled') {
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
      subscription_data: {
        trial_period_days: 60, // First 2 months free
        metadata: {
          userId,
          type: 'platform_subscription',
        },
      },
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
  })

  // If lock couldn't be acquired, throw error
  if (!result) {
    throw new Error('Could not acquire lock. Please try again.')
  }

  return result
}

/**
 * Create a customer portal session for managing subscription
 */
export async function createPortalSession(
  userId: string,
  returnUrl: string
): Promise<{ url: string }> {
  // Stub mode: return fake portal URL for E2E tests
  if (env.PAYMENTS_MODE === 'stub') {
    return { url: 'https://billing.stripe.com/p/session/stub_test_portal' }
  }

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
  trialEndsAt: Date | null
  cancelAtPeriodEnd: boolean
}> {
  const profile = await db.profile.findUnique({
    where: { userId },
    select: {
      platformSubscriptionId: true,
      platformSubscriptionStatus: true,
      platformTrialEndsAt: true,
    },
  })

  if (!profile?.platformSubscriptionId) {
    return {
      status: null,
      subscriptionId: null,
      currentPeriodEnd: null,
      trialEndsAt: null,
      cancelAtPeriodEnd: false,
    }
  }

  // Get fresh status from Stripe
  try {
    const subscription = await stripe.subscriptions.retrieve(profile.platformSubscriptionId)
    const sub = subscription as any
    return {
      status: sub.status,
      subscriptionId: sub.id,
      currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : profile.platformTrialEndsAt,
      cancelAtPeriodEnd: sub.cancel_at_period_end || false,
    }
  } catch {
    return {
      status: profile.platformSubscriptionStatus,
      subscriptionId: profile.platformSubscriptionId,
      currentPeriodEnd: null,
      trialEndsAt: profile.platformTrialEndsAt,
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
      const sub = subscription as any

      // Calculate trial end date
      const trialEndsAt = sub.trial_end
        ? new Date(sub.trial_end * 1000)
        : null

      await db.profile.update({
        where: { userId },
        data: {
          platformSubscriptionId: subscriptionId,
          platformSubscriptionStatus: subscription.status, // 'trialing' during trial
          platformTrialEndsAt: trialEndsAt,
        },
      })

      console.log(`[platform] User ${userId} subscribed: ${subscriptionId} (trial until ${trialEndsAt?.toISOString() || 'none'})`)
      break
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription
      const customerId = subscription.customer as string
      const sub = subscription as any

      // Find user by customer ID
      const profile = await db.profile.findFirst({
        where: { platformCustomerId: customerId },
      })

      if (profile) {
        // Update status and trial end date (keeps DB in sync with Stripe)
        const trialEndsAt = sub.trial_end
          ? new Date(sub.trial_end * 1000)
          : null

        await db.profile.update({
          where: { id: profile.id },
          data: {
            platformSubscriptionStatus: subscription.status,
            platformTrialEndsAt: trialEndsAt,
          },
        })

        // Invalidate public profile cache - subscription status affects paymentsReady
        if (profile.username) {
          await invalidatePublicProfileCache(profile.username)
        }

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

        // Invalidate public profile cache - subscription status affects paymentsReady
        if (profile.username) {
          await invalidatePublicProfileCache(profile.username)
        }

        console.log(`[platform] Subscription ${subscription.id} canceled`)
      }
      break
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string
      const failedAmount = invoice.amount_due || 0 // Amount in cents

      const profile = await db.profile.findFirst({
        where: { platformCustomerId: customerId },
        include: { user: { select: { id: true, email: true } } },
      })

      if (profile && failedAmount > 0) {
        // IDEMPOTENCY: Check if we already recorded a debit for this invoice
        const existingDebit = await db.activity.findFirst({
          where: {
            userId: profile.user.id,
            type: 'platform_debit_created',
            payload: {
              path: ['invoiceId'],
              equals: invoice.id,
            },
          },
        })

        if (existingDebit) {
          console.log(`[platform] Debit already recorded for invoice ${invoice.id}, skipping`)
          break
        }

        // Calculate new total debit
        const newTotalDebit = (profile.platformDebitCents || 0) + failedAmount

        // Add failed amount to debit instead of blocking
        // Don't change status to past_due - keep them operational
        await db.profile.update({
          where: { id: profile.id },
          data: {
            platformDebitCents: { increment: failedAmount },
            // Keep status as-is (active or trialing) - don't set to past_due
          },
        })

        // Create activity for audit trail
        await db.activity.create({
          data: {
            userId: profile.user.id,
            type: 'platform_debit_created',
            payload: {
              amountCents: failedAmount,
              reason: 'platform_subscription_payment_failed',
              invoiceId: invoice.id,
            },
          },
        })

        // Send email notification about the debit
        // Use different email if cap is reached
        try {
          if (newTotalDebit >= PLATFORM_DEBIT_CAP_CENTS) {
            // Cap reached - payments will be blocked
            await sendPlatformDebitCapReachedNotification(
              profile.user.email,
              profile.displayName || 'there',
              newTotalDebit
            )
          } else {
            // Normal debit notification
            await sendPlatformDebitNotification(
              profile.user.email,
              profile.displayName || 'there',
              failedAmount,
              newTotalDebit
            )
          }
        } catch (emailErr) {
          console.error(`[platform] Failed to send debit notification email:`, emailErr)
        }

        console.log(`[platform] Added $${(failedAmount / 100).toFixed(2)} debit for customer ${customerId} (invoice: ${invoice.id})`)
      }
      break
    }

    case 'invoice.paid': {
      // DEBIT REVERSAL: If this invoice previously failed and created a debit, reverse it
      const invoice = event.data.object as Stripe.Invoice
      const customerId = invoice.customer as string

      const profile = await db.profile.findFirst({
        where: { platformCustomerId: customerId },
        select: { id: true, userId: true, platformDebitCents: true },
      })

      if (!profile) break

      // Check if this invoice previously failed and created a debit
      const previousDebit = await db.activity.findFirst({
        where: {
          userId: profile.userId,
          type: 'platform_debit_created',
          payload: {
            path: ['invoiceId'],
            equals: invoice.id,
          },
        },
      })

      if (previousDebit) {
        const debitAmount = (previousDebit.payload as any)?.amountCents || 0

        if (debitAmount > 0) {
          // Reverse the debit (clamp to 0 to prevent negative)
          const newDebit = Math.max(0, (profile.platformDebitCents || 0) - debitAmount)

          await db.profile.update({
            where: { id: profile.id },
            data: { platformDebitCents: newDebit },
          })

          // Record the reversal
          await db.activity.create({
            data: {
              userId: profile.userId,
              type: 'platform_debit_reversed',
              payload: {
                amountCents: debitAmount,
                reason: 'invoice_paid_after_failure',
                invoiceId: invoice.id,
                originalDebitActivityId: previousDebit.id,
              },
            },
          })

          console.log(`[platform] Reversed $${(debitAmount / 100).toFixed(2)} debit for invoice ${invoice.id} (paid after failure)`)
        }
      }
      break
    }
  }
}
