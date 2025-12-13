import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { paymentRateLimit } from '../middleware/rateLimit.js'
import {
  createExpressAccount,
  createAccountLink,
  getAccountStatus,
  getAccountBalance,
  getPayoutHistory,
  createExpressDashboardLink,
} from '../services/stripe.js'
import { isStripeSupported, getStripeSupportedCountries, STRIPE_SUPPORTED_COUNTRIES } from '../utils/constants.js'

const stripeRoutes = new Hono()

// Get supported countries for Stripe Connect
stripeRoutes.get('/supported-countries', async (c) => {
  return c.json({
    countries: getStripeSupportedCountries(),
    total: Object.keys(STRIPE_SUPPORTED_COUNTRIES).length,
  })
})

// Start Connect onboarding
stripeRoutes.post('/connect', requireAuth, paymentRateLimit, async (c) => {
  const userId = c.get('userId')

  // Get user and profile
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  })

  if (!user?.profile) {
    return c.json({ error: 'Profile not found. Complete onboarding first.' }, 400)
  }

  // Validate country is supported by Stripe
  if (!isStripeSupported(user.profile.countryCode)) {
    return c.json({
      error: 'Stripe is not available in your country',
      countryCode: user.profile.countryCode,
      suggestion: 'Consider using Flutterwave or Paystack for payments in your region.',
      supportedCountries: getStripeSupportedCountries(),
    }, 400)
  }

  try {
    const result = await createExpressAccount(
      userId,
      user.email,
      user.profile.countryCode,
      user.profile.displayName // Prefill KYC with name
    )

    if (result.alreadyOnboarded) {
      return c.json({
        success: true,
        alreadyOnboarded: true,
        message: 'Payments already connected',
      })
    }

    return c.json({
      success: true,
      accountId: result.accountId,
      onboardingUrl: result.accountLink,
    })
  } catch (error) {
    console.error('Stripe Connect error:', error)
    return c.json({ error: 'Failed to create payment account' }, 500)
  }
})

// Get new onboarding link (if previous expired)
stripeRoutes.post('/connect/refresh', requireAuth, paymentRateLimit, async (c) => {
  const userId = c.get('userId')

  const profile = await db.profile.findUnique({ where: { userId } })

  if (!profile?.stripeAccountId) {
    return c.json({ error: 'No payment account found' }, 400)
  }

  try {
    const accountLink = await createAccountLink(profile.stripeAccountId)
    return c.json({ onboardingUrl: accountLink })
  } catch (error) {
    console.error('Account link error:', error)
    return c.json({ error: 'Failed to create onboarding link' }, 500)
  }
})

// Get Connect account status
stripeRoutes.get('/connect/status', requireAuth, async (c) => {
  const userId = c.get('userId')

  const profile = await db.profile.findUnique({ where: { userId } })

  if (!profile?.stripeAccountId) {
    return c.json({
      connected: false,
      status: 'not_started',
    })
  }

  try {
    const status = await getAccountStatus(profile.stripeAccountId)

    // Update payout status in our database
    let payoutStatus: 'pending' | 'active' | 'restricted' = 'pending'
    if (status.chargesEnabled && status.payoutsEnabled) {
      payoutStatus = 'active'
    } else if (status.requirements?.disabledReason) {
      payoutStatus = 'restricted'
    }

    if (profile.payoutStatus !== payoutStatus) {
      await db.profile.update({
        where: { userId },
        data: { payoutStatus },
      })
    }

    return c.json({
      connected: true,
      status: payoutStatus,
      details: status,
    })
  } catch (error) {
    console.error('Status check error:', error)
    return c.json({ error: 'Failed to check status' }, 500)
  }
})

// Get account balance
stripeRoutes.get('/balance', requireAuth, async (c) => {
  const userId = c.get('userId')

  const profile = await db.profile.findUnique({ where: { userId } })

  if (!profile?.stripeAccountId) {
    return c.json({ error: 'No payment account found' }, 400)
  }

  try {
    const balance = await getAccountBalance(profile.stripeAccountId)
    return c.json({ balance })
  } catch (error) {
    console.error('Balance error:', error)
    return c.json({ error: 'Failed to get balance' }, 500)
  }
})

// Get payout history
stripeRoutes.get('/payouts', requireAuth, async (c) => {
  const userId = c.get('userId')

  const profile = await db.profile.findUnique({ where: { userId } })

  if (!profile?.stripeAccountId) {
    return c.json({ error: 'No payment account found' }, 400)
  }

  try {
    const payouts = await getPayoutHistory(profile.stripeAccountId)
    return c.json({ payouts })
  } catch (error) {
    console.error('Payouts error:', error)
    return c.json({ error: 'Failed to get payouts' }, 500)
  }
})

// Get Express Dashboard login link
stripeRoutes.get('/dashboard-link', requireAuth, async (c) => {
  const userId = c.get('userId')

  const profile = await db.profile.findUnique({ where: { userId } })

  if (!profile?.stripeAccountId) {
    return c.json({ error: 'No payment account found' }, 400)
  }

  try {
    // Only allow dashboard access for fully onboarded accounts
    const status = await getAccountStatus(profile.stripeAccountId)
    if (!status.detailsSubmitted) {
      return c.json({ error: 'Complete onboarding first' }, 400)
    }

    const dashboardUrl = await createExpressDashboardLink(profile.stripeAccountId)
    return c.json({ url: dashboardUrl })
  } catch (error) {
    console.error('Dashboard link error:', error)
    return c.json({ error: 'Failed to create dashboard link' }, 500)
  }
})

export default stripeRoutes
