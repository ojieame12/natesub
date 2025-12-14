import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/client.js'
import { redis } from '../db/redis.js'
import { checkoutRateLimit, publicRateLimit } from '../middleware/rateLimit.js'
import { createCheckoutSession, getAccountStatus } from '../services/stripe.js'
import { initializePaystackCheckout, generateReference, isPaystackSupported, type PaystackCountry } from '../services/paystack.js'
import { calculateServiceFee, type FeeCalculation, type FeeMode } from '../services/fees.js'
import { env } from '../config/env.js'
import { maskEmail } from '../utils/pii.js'

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
  checkoutRateLimit,
  zValidator('json', z.object({
    creatorUsername: z.string(),
    tierId: z.string().optional(),
    amount: z.number().positive().max(500000000), // Max in smallest unit (e.g., ₦5M in kobo)
    interval: z.enum(['month', 'one_time']),
    subscriberEmail: z.string().email().optional(),
    viewId: z.string().optional(), // Analytics: page view ID for conversion tracking
  })),
  async (c) => {
    const { creatorUsername, tierId, amount, interval, subscriberEmail, viewId } = c.req.valid('json')

    // Find creator
    const profile = await db.profile.findUnique({
      where: { username: creatorUsername.toLowerCase() },
      include: { user: true },
    })

    if (!profile) {
      return c.json({ error: 'User not found' }, 404)
    }

    // Check if service provider has payment set up
    const hasStripe = profile.paymentProvider === 'stripe' && profile.stripeAccountId
    const hasPaystack = profile.paymentProvider === 'paystack' && profile.paystackSubaccountCode

    if (!hasStripe && !hasPaystack) {
      return c.json({ error: 'This service provider has not set up payments yet' }, 400)
    }

    if (profile.payoutStatus !== 'active') {
      return c.json({ error: 'Payments are not active for this account' }, 400)
    }

    // Enforce platform subscription for service providers
    if (profile.purpose === 'service') {
      const validSubscriptionStatuses = ['active', 'trialing']
      if (!profile.platformSubscriptionStatus || !validSubscriptionStatuses.includes(profile.platformSubscriptionStatus)) {
        return c.json({
          error: 'This service provider needs to activate their plan to receive payments.',
          code: 'PLATFORM_SUBSCRIPTION_REQUIRED',
        }, 402)
      }
    }

    // Validate amount against creator's pricing
    // IMPORTANT: profile.singleAmount and tier.amount are stored in CENTS in the database
    // (see profile.ts:128 where we do Math.round(data.singleAmount * 100))
    // The `amount` from request is also in cents (smallest unit)
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

    // Calculate service fee based on creator's fee mode setting
    // feeMode: 'absorb' = creator absorbs, 'pass_to_subscriber' = subscriber pays
    const feeCalc = calculateServiceFee(
      amount,
      profile.currency,
      profile.purpose,
      profile.feeMode as FeeMode
    )

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
          return c.json({ error: 'This country is not supported by Paystack' }, 400)
        }

        if (profile.currency !== expectedCurrency) {
          return c.json({
            error: `Currency mismatch. Account currency is ${profile.currency}, but Paystack in ${profile.countryCode} requires ${expectedCurrency}`,
          }, 400)
        }

        // Deduplication: Check for existing pending checkout
        const dedupeKey = `checkout:paystack:${subscriberEmail}:${profile.userId}:${tierId || amount}`
        const existingCheckout = await redis.get(dedupeKey)

        if (existingCheckout) {
          const cached = JSON.parse(existingCheckout)
          // Log with masked email to prevent PII exposure
          console.log(`[checkout] Returning cached Paystack checkout for ${maskEmail(subscriberEmail)}:${profile.userId}`)
          return c.json({
            provider: 'paystack',
            url: cached.url,
            reference: cached.reference,
            breakdown: cached.breakdown,
            cached: true,
          })
        }

        const reference = generateReference('SUB')
        const result = await initializePaystackCheckout({
          email: subscriberEmail,
          creatorAmount: amount,
          serviceFee: feeCalc.feeCents,
          totalAmount: feeCalc.grossCents,
          currency: profile.currency,
          callbackUrl: `${env.APP_URL}/payment/success?creator=${profile.username}`,
          reference,
          metadata: {
            creatorId: profile.userId,
            tierId: tierId || '',
            interval,
            viewId: viewId || '', // Analytics: page view ID for conversion tracking
            // Fee metadata for webhook processing
            creatorAmount: feeCalc.netCents, // What creator receives
            serviceFee: feeCalc.feeCents,
            feeModel: feeCalc.feeModel,
            feeMode: feeCalc.feeMode,
            feeEffectiveRate: feeCalc.effectiveRate,
          },
        })

        // Build breakdown for response
        const breakdown = buildBreakdown(feeCalc, profile.currency)

        // Cache the checkout URL to prevent duplicates
        await redis.setex(dedupeKey, CHECKOUT_DEDUPE_TTL, JSON.stringify({
          url: result.authorization_url,
          reference: result.reference,
          breakdown,
        }))

        return c.json({
          provider: 'paystack',
          url: result.authorization_url,
          reference: result.reference,
          breakdown,
        })
      }

      // Default to Stripe
      if (!profile.stripeAccountId) {
        return c.json({ error: 'Payment account not connected' }, 400)
      }

      // Verify Stripe account can accept payments and transfers
      const stripeStatus = await getAccountStatus(profile.stripeAccountId)
      if (!stripeStatus.chargesEnabled || !stripeStatus.payoutsEnabled) {
        const issue = !stripeStatus.chargesEnabled
          ? 'cannot accept payments'
          : 'cannot receive transfers'
        return c.json({
          error: `Payment account ${issue}. Please ask them to complete their payment setup.`
        }, 400)
      }

      const session = await createCheckoutSession({
        creatorId: profile.userId,
        tierId,
        // Use calculated values from fee engine - handles both fee modes correctly
        grossAmount: feeCalc.grossCents,   // What subscriber pays
        netAmount: feeCalc.netCents,       // What creator receives
        serviceFee: feeCalc.feeCents,      // Platform fee
        currency: profile.currency,
        interval,
        successUrl: `${env.APP_URL}/${profile.username}?success=true&provider=stripe`,
        cancelUrl: `${env.APP_URL}/${profile.username}?canceled=true`,
        subscriberEmail,
        viewId, // Analytics: page view ID for conversion tracking
        feeMetadata: {
          feeModel: feeCalc.feeModel,
          feeMode: feeCalc.feeMode,
          feeEffectiveRate: feeCalc.effectiveRate,
        },
      })

      // Build breakdown for response
      const breakdown = buildBreakdown(feeCalc, profile.currency)

      return c.json({
        provider: 'stripe',
        sessionId: session.id,
        url: session.url,
        breakdown,
      })
    } catch (error) {
      console.error('Checkout error:', error)
      return c.json({ error: 'Failed to create checkout session' }, 500)
    }
  }
)

// Verify Paystack transaction (for frontend confirmation)
checkout.get(
  '/verify/:reference',
  publicRateLimit,
  async (c) => {
    const { reference } = c.req.param()

    if (!reference) {
      return c.json({ error: 'Reference is required' }, 400)
    }

    try {
      // Import dynamically to avoid circular deps
      const { verifyTransaction } = await import('../services/paystack.js')
      const transaction = await verifyTransaction(reference)

      // Check if transaction was successful
      const isSuccessful = transaction.status === 'success'

      return c.json({
        verified: isSuccessful,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        reference: transaction.reference,
        paidAt: transaction.paid_at,
        channel: transaction.channel,
        metadata: transaction.metadata,
      })
    } catch (error: any) {
      console.error('Paystack verification error:', error)
      // Don't expose internal errors - could be invalid reference
      return c.json({
        verified: false,
        error: 'Unable to verify transaction',
      }, 400)
    }
  }
)

// Helper to build breakdown response
function buildBreakdown(feeCalc: FeeCalculation, currency: string) {
  return {
    creatorAmount: feeCalc.netCents,      // What creator receives
    serviceFee: feeCalc.feeCents,          // Platform fee
    totalAmount: feeCalc.grossCents,       // What subscriber pays
    effectiveRate: feeCalc.effectiveRate,
    currency,
    feeModel: feeCalc.feeModel,
    feeMode: feeCalc.feeMode,              // Who pays the fee
    purposeType: feeCalc.purposeType,
  }
}

export default checkout
