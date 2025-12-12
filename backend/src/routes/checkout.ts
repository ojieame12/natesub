import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/client.js'
import { createCheckoutSession, getAccountStatus } from '../services/stripe.js'
import { initializeTransaction, generateReference, isPaystackSupported, type PaystackCountry } from '../services/paystack.js'
import { env } from '../config/env.js'

const checkout = new Hono()

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
