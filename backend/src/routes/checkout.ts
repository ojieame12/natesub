import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/client.js'
import { redis } from '../db/redis.js'
import { createCheckoutSession, getAccountStatus } from '../services/stripe.js'
import { initializeTransaction, generateReference, isPaystackSupported, type PaystackCountry } from '../services/paystack.js'
import { env } from '../config/env.js'

const checkout = new Hono()

// Checkout deduplication TTL (10 minutes)
const CHECKOUT_DEDUPE_TTL = 600

// Country to currency mapping for Paystack
const PAYSTACK_CURRENCIES: Record<PaystackCountry, string> = {
  NG: 'NGN',
  KE: 'KES',
  ZA: 'ZAR',
}

// Create checkout session for subscription
checkout.post(
  '/session',
  zValidator('json', z.object({
    creatorUsername: z.string(),
    tierId: z.string().optional(),
    amount: z.number().positive().max(100000), // Max $1000 in cents
    interval: z.enum(['month', 'one_time']),
    subscriberEmail: z.string().email().optional(),
  })),
  async (c) => {
    const { creatorUsername, tierId, amount, interval, subscriberEmail } = c.req.valid('json')

    // Find creator
    const profile = await db.profile.findUnique({
      where: { username: creatorUsername.toLowerCase() },
      include: { user: true },
    })

    if (!profile) {
      return c.json({ error: 'Creator not found' }, 404)
    }

    // Check if creator has payment set up
    const hasStripe = profile.paymentProvider === 'stripe' && profile.stripeAccountId
    const hasPaystack = profile.paymentProvider === 'paystack' && profile.paystackSubaccountCode

    if (!hasStripe && !hasPaystack) {
      return c.json({ error: 'Creator has not set up payments' }, 400)
    }

    if (profile.payoutStatus !== 'active') {
      return c.json({ error: 'Creator payments are not active' }, 400)
    }

    // Enforce platform subscription for service providers
    if (profile.purpose === 'service') {
      const validSubscriptionStatuses = ['active', 'trialing']
      if (!profile.platformSubscriptionStatus || !validSubscriptionStatuses.includes(profile.platformSubscriptionStatus)) {
        return c.json({
          error: 'This creator needs to activate their service plan to receive payments.',
          code: 'PLATFORM_SUBSCRIPTION_REQUIRED',
        }, 402) // 402 Payment Required
      }
    }

    // Validate amount against creator's pricing
    if (profile.pricingModel === 'single' && profile.singleAmount) {
      if (amount !== profile.singleAmount) {
        return c.json({ error: 'Invalid amount' }, 400)
      }
    } else if (profile.pricingModel === 'tiers' && profile.tiers) {
      const tiers = profile.tiers as any[]
      const tier = tiers.find(t => t.id === tierId)
      if (!tier || tier.amount !== amount) {
        return c.json({ error: 'Invalid tier or amount' }, 400)
      }
    }

    try {
      // Use Paystack for creators who have Paystack connected
      if (hasPaystack && profile.paystackSubaccountCode) {
        if (!subscriberEmail) {
          return c.json({ error: 'Subscriber email is required for Paystack checkout' }, 400)
        }

        // Validate currency matches creator's Paystack country
        const expectedCurrency = isPaystackSupported(profile.countryCode)
          ? PAYSTACK_CURRENCIES[profile.countryCode as PaystackCountry]
          : null

        if (!expectedCurrency) {
          return c.json({ error: 'Creator country not supported by Paystack' }, 400)
        }

        if (profile.currency !== expectedCurrency) {
          return c.json({
            error: `Currency mismatch. Creator's currency is ${profile.currency}, but Paystack in ${profile.countryCode} requires ${expectedCurrency}`,
          }, 400)
        }

        // Deduplication: Check for existing pending checkout (prevents double-clicks)
        const dedupeKey = `checkout:paystack:${subscriberEmail}:${profile.userId}:${tierId || amount}`
        const existingCheckout = await redis.get(dedupeKey)

        if (existingCheckout) {
          const cached = JSON.parse(existingCheckout)
          console.log(`[checkout] Returning cached Paystack checkout for ${dedupeKey}`)
          return c.json({
            provider: 'paystack',
            url: cached.url,
            reference: cached.reference,
            cached: true,
          })
        }

        const reference = generateReference('SUB')
        const result = await initializeTransaction({
          email: subscriberEmail,
          amount, // Already in smallest unit (kobo/cents)
          currency: profile.currency,
          subaccountCode: profile.paystackSubaccountCode,
          callbackUrl: `${env.APP_URL}/${profile.username}?success=true&provider=paystack`,
          reference,
          metadata: {
            creatorId: profile.userId,
            tierId: tierId || '',
            interval,
          },
        })

        // Cache the checkout URL to prevent duplicates
        await redis.setex(dedupeKey, CHECKOUT_DEDUPE_TTL, JSON.stringify({
          url: result.authorization_url,
          reference: result.reference,
        }))

        return c.json({
          provider: 'paystack',
          url: result.authorization_url,
          reference: result.reference,
        })
      }

      // Default to Stripe - verify account is actually active first
      if (!profile.stripeAccountId) {
        return c.json({ error: 'Creator has not connected Stripe' }, 400)
      }

      // Verify with Stripe that account can accept payments
      const stripeStatus = await getAccountStatus(profile.stripeAccountId)
      if (!stripeStatus.chargesEnabled) {
        return c.json({
          error: 'Creator payment account is not fully set up. Please ask the creator to complete their payment setup.'
        }, 400)
      }

      const session = await createCheckoutSession({
        creatorId: profile.userId,
        tierId,
        amount,
        currency: profile.currency,
        interval,
        successUrl: `${env.APP_URL}/${profile.username}?success=true&provider=stripe`,
        cancelUrl: `${env.APP_URL}/${profile.username}?canceled=true`,
        subscriberEmail,
      })

      return c.json({
        provider: 'stripe',
        sessionId: session.id,
        url: session.url,
      })
    } catch (error) {
      console.error('Checkout error:', error)
      return c.json({ error: 'Failed to create checkout session' }, 500)
    }
  }
)

export default checkout
