import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/client.js'
import { redis } from '../db/redis.js'
import { optionalAuth } from '../middleware/auth.js'
import { checkoutRateLimit, publicRateLimit } from '../middleware/rateLimit.js'
import { createCheckoutSession, getAccountStatus, stripe } from '../services/stripe.js'
import { initializePaystackCheckout, generateReference, isPaystackSupported, type PaystackCountry } from '../services/paystack.js'
import { calculateServiceFee, type FeeCalculation, type FeeMode } from '../services/fees.js'
import { isStripeCrossBorderSupported } from '../utils/constants.js'
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
  optionalAuth,
  zValidator('json', z.object({
    creatorUsername: z.string(),
    tierId: z.string().optional(),
    amount: z.number().positive().max(500000000), // Max in smallest unit (e.g., ₦5M in kobo)
    interval: z.enum(['month', 'one_time']),
    subscriberEmail: z.string().email().optional(),
    payerCountry: z.string().length(2).optional(), // ISO 2-letter code for geo-based provider selection
    viewId: z.string().optional(), // Analytics: page view ID for conversion tracking
  })),
  async (c) => {
    const { creatorUsername, tierId, amount, interval, subscriberEmail, payerCountry, viewId } = c.req.valid('json')

    // Find creator
    const profile = await db.profile.findUnique({
      where: { username: creatorUsername.toLowerCase() },
      include: { user: true },
    })

    if (!profile) {
      return c.json({ error: 'User not found' }, 404)
    }

    // Prevent creators from subscribing to themselves (common when previewing own public page)
    const viewerId = c.get('userId')
    if (viewerId && viewerId === profile.userId) {
      return c.json({ error: 'You cannot subscribe to your own page.' }, 400)
    }

    // Check if service provider has payment set up.
    // NOTE: paymentProvider may be null (e.g., new "naked onboarding"), so infer from stored IDs.
    const hasStripeAccount = Boolean(profile.stripeAccountId)
    const hasPaystackAccount = Boolean(profile.paystackSubaccountCode)
    const hasBothProviders = hasStripeAccount && hasPaystackAccount

    // Paystack-supported countries (local payments)
    const PAYSTACK_COUNTRIES = ['NG', 'KE', 'ZA', 'GH']
    const payerIsPaystackEligible = payerCountry && PAYSTACK_COUNTRIES.includes(payerCountry.toUpperCase())

    // Smart provider selection based on payer location
    // If creator has BOTH providers, route based on payer geo
    // Otherwise, use whichever provider they have
    let inferredProvider: 'stripe' | 'paystack' | null = null

    if (hasBothProviders) {
      // Smart selection: local payers → Paystack, global payers → Stripe
      inferredProvider = payerIsPaystackEligible ? 'paystack' : 'stripe'
    } else if (hasStripeAccount) {
      inferredProvider = 'stripe'
    } else if (hasPaystackAccount) {
      inferredProvider = 'paystack'
    }

    const hasStripe = inferredProvider === 'stripe' && hasStripeAccount
    const hasPaystack = inferredProvider === 'paystack' && hasPaystackAccount

    if (!hasStripe && !hasPaystack) {
      return c.json({ error: 'This service provider has not set up payments yet' }, 400)
    }

    if (profile.payoutStatus !== 'active') {
      return c.json({ error: 'Payments are not active for this account' }, 400)
    }

    // Enforce platform subscription for service providers
    // Service users must have active/trialing subscription to accept payments
    if (profile.purpose === 'service') {
      const validStatuses = ['trialing', 'active']
      if (!validStatuses.includes(profile.platformSubscriptionStatus || '')) {
        return c.json({
          error: 'Service plan subscription required to accept payments.',
          code: 'PLATFORM_SUBSCRIPTION_REQUIRED',
        }, 402)
      }
    }

    // Enforce platform debit cap for service providers ($30 max = 6 months)
    const PLATFORM_DEBIT_CAP_CENTS = 3000
    if (profile.purpose === 'service' && profile.platformDebitCents >= PLATFORM_DEBIT_CAP_CENTS) {
      return c.json({
        error: 'Outstanding platform balance must be cleared before accepting new payments.',
        code: 'PLATFORM_DEBIT_CAP_REACHED',
        debitCents: profile.platformDebitCents,
      }, 402)
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

    // Check if this is a cross-border account (Stripe context only)
    // For Paystack, if the country is supported (NG/KE/ZA), it's considered local/native
    const isStripeCrossBorder = hasStripe && isStripeCrossBorderSupported(profile.countryCode)
    const isCrossBorder = !hasPaystack && isStripeCrossBorder

    // Calculate service fee based on creator's fee mode setting
    // feeMode: 'absorb' = creator absorbs, 'pass_to_subscriber' = subscriber pays
    const feeCalc = calculateServiceFee(
      amount,
      profile.currency,
      profile.purpose,
      profile.feeMode as FeeMode,
      isCrossBorder
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
        // FIXED: Include interval in dedupe key to distinguish between one-time and recurring
        const dedupeKey = `checkout:paystack:${subscriberEmail}:${profile.userId}:${tierId || amount}:${interval}`
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

      // Check if this is a cross-border account (e.g., Nigeria)
      // Cross-border accounts don't have chargesEnabled since they only receive payouts
      const isCrossBorder = isStripeCrossBorderSupported(profile.countryCode)

      // Verify Stripe account can accept payments and transfers
      const stripeStatus = await getAccountStatus(profile.stripeAccountId)

      // For cross-border: only require payoutsEnabled (no chargesEnabled needed)
      // For native: require both chargesEnabled and payoutsEnabled
      if (isCrossBorder) {
        if (!stripeStatus.payoutsEnabled) {
          return c.json({
            error: 'Payment account cannot receive transfers. Please complete your payment setup.'
          }, 400)
        }
      } else {
        if (!stripeStatus.chargesEnabled || !stripeStatus.payoutsEnabled) {
          const issue = !stripeStatus.chargesEnabled
            ? 'cannot accept payments'
            : 'cannot receive transfers'
          return c.json({
            error: `Payment account ${issue}. Please complete your payment setup.`
          }, 400)
        }
      }

      // Cross-border accounts: payments are collected in USD and converted to local currency
      // Native accounts: use the profile's currency
      const checkoutCurrency = isCrossBorder ? 'USD' : profile.currency

      const session = await createCheckoutSession({
        creatorId: profile.userId,
        tierId,
        // Use calculated values from fee engine - handles both fee modes correctly
        grossAmount: feeCalc.grossCents,   // What subscriber pays
        netAmount: feeCalc.netCents,       // What creator receives
        serviceFee: feeCalc.feeCents,      // Platform fee
        currency: checkoutCurrency,
        interval,
        // IMPORTANT: include session_id in URL to prevent spoofing
        successUrl: `${env.APP_URL}/${profile.username}?success=true&provider=stripe&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${env.APP_URL}/${profile.username}?canceled=true`,
        subscriberEmail,
        viewId, // Analytics: page view ID for conversion tracking
        feeMetadata: {
          feeModel: feeCalc.feeModel,
          feeMode: feeCalc.feeMode,
          feeEffectiveRate: feeCalc.effectiveRate,
        },
      })

      // Build breakdown for response (use checkout currency, not profile currency)
      const breakdown = buildBreakdown(feeCalc, checkoutCurrency)

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

// Verify Stripe session (Anti-spoofing)
// Verify Stripe session (Anti-spoofing)
checkout.get(
  '/session/:sessionId/verify',
  publicRateLimit,
  async (c) => {
    const { sessionId } = c.req.param()
    const creatorUsername = c.req.query('username')

    if (!sessionId || !sessionId.startsWith('cs_')) {
      return c.json({ error: 'Invalid session ID' }, 400)
    }

    try {
      // Retrieve session from Stripe
      const session = await stripe.checkout.sessions.retrieve(sessionId)

      // Check payment status
      const isPaid = session.payment_status === 'paid'

      // Verification: Check if session belongs to the expected creator
      if (creatorUsername) {
        const profile = await db.profile.findUnique({
          where: { username: creatorUsername.toLowerCase() },
          select: { userId: true }
        })

        if (profile && session.metadata?.creatorId) {
          if (profile.userId !== session.metadata.creatorId) {
            // SPOOF DETECTED: Valid stripe session, but for WRONG creator
            return c.json({
              verified: false,
              error: 'Session does not belong to this creator',
              status: 'mismatch'
            }, 400)
          }
        }
      }

      // Mask email for privacy (e.g. "j***@gmail.com")
      const email = session.customer_details?.email
      let maskedEmail = null
      if (email) {
        try {
          maskedEmail = maskEmail(email)
        } catch (e) {
          // Fallback if maskEmail fails
          const [local, domain] = email.split('@')
          maskedEmail = `${local.charAt(0)}***@${domain}`
        }
      }

      return c.json({
        verified: isPaid,
        status: session.payment_status,
        maskedEmail, // NO RAW EMAILS
        // We don't strictly need to return creatorId now that we verified it server-side, 
        // but keeping it doesn't hurt (it's internal ID, not sensitive).
        creatorId: session.metadata?.creatorId,
        amountTotal: session.amount_total,
        currency: session.currency,
        mode: session.mode,
      })
    } catch (error: any) {
      console.error('Stripe verification error:', error)
      return c.json({
        verified: false,
        error: 'Unable to verify session',
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
