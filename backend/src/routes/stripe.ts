import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { db } from '../db/client.js'
import { redis } from '../db/redis.js'
import { requireAuth } from '../middleware/auth.js'
import { paymentRateLimit } from '../middleware/rateLimit.js'
import {
  stripe,
  createExpressAccount,
  createAccountLink,
  getAccountStatus,
  getAccountBalance,
  getPayoutHistory,
  createExpressDashboardLink,
} from '../services/stripe.js'
import { rotateSessionToken } from '../services/auth.js'
import { isStripeSupported, isStripeCrossBorderSupported, getStripeSupportedCountries } from '../utils/constants.js'
import { env } from '../config/env.js'
import { invalidatePublicProfileCache } from '../utils/cache.js'

// Lock TTL for Stripe connect operations (prevents double-click race conditions)
const CONNECT_LOCK_TTL_SECONDS = 30

const stripeRoutes = new Hono()

/**
 * Rotate session token after sensitive payment operation.
 * Returns the new token (for mobile clients) and sets cookie (for web clients).
 */
async function rotateTokenOnSuccess(c: any): Promise<string | null> {
  const cookieToken = getCookie(c, 'session')
  const authHeader = c.req.header('Authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined
  const currentToken = cookieToken || bearerToken

  if (!currentToken) return null

  const newToken = await rotateSessionToken(currentToken)

  if (newToken) {
    // Set new cookie for web clients
    setCookie(c, 'session', newToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'Lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    })
  }

  return newToken
}

// Get supported countries for Stripe Connect
stripeRoutes.get('/supported-countries', async (c) => {
  const countries = getStripeSupportedCountries()
  return c.json({
    countries,
    total: countries.length,
  })
})

// Stub mode handler - extracted for clarity and testability
async function handleStubMode(userId: string, newToken: string | null) {
  const stubAccountId = `stub_acct_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`

  await db.profile.update({
    where: { userId },
    data: {
      stripeAccountId: stubAccountId,
      paymentProvider: 'stripe',
      payoutStatus: 'active',
    },
  })

  console.log(`[stripe/connect] Stub mode: created fake account ${stubAccountId} for user ${userId}`)

  return {
    success: true,
    alreadyOnboarded: true,
    message: 'Payments connected (stub mode)',
    // Return rotated token for mobile clients (security hardening)
    ...(newToken && { token: newToken }),
  }
}

// Start Connect onboarding
stripeRoutes.post('/connect', requireAuth, paymentRateLimit, async (c) => {
  const userId = c.get('userId')

  // Acquire lock to prevent race conditions from double-clicks or multiple tabs
  // This complements Stripe's idempotency keys with a user-level lock
  const lockKey = `stripe:connect:lock:${userId}`
  const gotLock = await redis.set(lockKey, '1', 'EX', CONNECT_LOCK_TTL_SECONDS, 'NX')

  if (!gotLock) {
    console.log(`[stripe/connect] Lock not acquired for ${userId}, request already in progress`)
    return c.json({
      error: 'A connection request is already in progress. Please wait.',
      code: 'CONNECT_IN_PROGRESS',
    }, 429)
  }

  try {
    console.log(`[stripe/connect] Request received. PAYMENTS_MODE=${env.PAYMENTS_MODE}`)

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

    // STUB MODE: Skip actual Stripe onboarding for E2E tests
    // This is controlled by PAYMENTS_MODE env var - never set to 'stub' in production
    if (env.PAYMENTS_MODE === 'stub') {
      // SECURITY: Rotate session token after connecting payment account
      const newToken = await rotateTokenOnSuccess(c)
      return c.json(await handleStubMode(userId, newToken))
    }

    // Build address info for Stripe KYC prefill (reduces onboarding screens)
    const addressInfo = (user.profile.address || user.profile.city) ? {
      line1: user.profile.address || undefined,
      city: user.profile.city || undefined,
      state: user.profile.state || undefined,
      postal_code: user.profile.zip || undefined,
    } : undefined

    const result = await createExpressAccount(
      userId,
      user.email,
      user.profile.countryCode,
      user.profile.displayName, // Prefill KYC with name
      addressInfo // Prefill KYC with address
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
  } catch (error: any) {
    console.error('Stripe Connect error:', error)
    const errorMessage = error?.message || error?.raw?.message || 'Failed to create payment account'
    const errorType = error?.type || error?.code || 'unknown'
    console.error(`[stripe/connect] Error type: ${errorType}, message: ${errorMessage}`)
    return c.json({
      error: errorMessage,
      errorType,
    }, 500)
  } finally {
    // Always release the lock
    await redis.del(lockKey)
  }
})

// Get new onboarding link (if previous expired)
stripeRoutes.post('/connect/refresh', requireAuth, paymentRateLimit, async (c) => {
  const userId = c.get('userId')

  // Fetch profile with user email for prefill
  const profile = await db.profile.findUnique({
    where: { userId },
    include: { user: { select: { email: true } } }
  })

  if (!profile?.stripeAccountId) {
    return c.json({ error: 'No payment account found' }, 400)
  }

  // Stub mode: return fake onboarding URL for E2E tests
  if (env.PAYMENTS_MODE === 'stub') {
    return c.json({ onboardingUrl: 'https://connect.stripe.com/setup/stub_refresh' })
  }

  try {
    // Update account with current profile data for prefill (same as main connect flow)
    // This ensures profile edits are reflected when user returns to Stripe onboarding
    const nameParts = profile.displayName?.trim().split(' ') || []
    const firstName = nameParts[0] || undefined
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined

    const updateData: { email?: string; individual?: { email?: string; first_name?: string; last_name?: string; address?: { line1?: string; city?: string; state?: string; postal_code?: string } } } = {
      email: profile.user?.email,
      individual: {
        email: profile.user?.email,
        first_name: firstName,
        last_name: lastName,
      },
    }

    // Add address if available
    if (profile.address || profile.city) {
      updateData.individual!.address = {
        line1: profile.address || undefined,
        city: profile.city || undefined,
        state: profile.state || undefined,
        postal_code: profile.zip || undefined,
      }
    }

    try {
      await stripe.accounts.update(profile.stripeAccountId, updateData)
    } catch (err) {
      // Non-fatal: prefill is nice-to-have, don't block onboarding
      console.warn('[stripe] Failed to update account for prefill on refresh:', err)
    }

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

  // Skip bank details for faster initial load (e.g., StripeComplete page)
  const quick = c.req.query('quick') === 'true'
  // Force refresh to bypass cache (use after returning from Stripe onboarding)
  const refresh = c.req.query('refresh') === 'true'

  const profile = await db.profile.findUnique({ where: { userId } })

  if (!profile?.stripeAccountId) {
    return c.json({
      connected: false,
      status: 'not_started',
    })
  }

  // Fast path: when quick is requested and refresh is false, return the last known DB status
  // without calling Stripe (avoids slow Stripe API on cold starts / return redirects).
  if (quick && !refresh) {
    return c.json({
      connected: true,
      status: profile.payoutStatus || 'pending',
    })
  }

  try {
    const status = await getAccountStatus(profile.stripeAccountId, {
      skipBankDetails: quick,
      forceRefresh: refresh,
    })

    // Check if this is a cross-border account (e.g., Nigeria, Ghana, Kenya)
    // Cross-border accounts don't have charges_enabled - only payouts_enabled matters
    const isCrossBorder = isStripeCrossBorderSupported(profile.countryCode)

    // Update payout status in our database
    let payoutStatus: 'pending' | 'active' | 'restricted' = 'pending'
    if (isCrossBorder) {
      // Cross-border accounts: only need payouts_enabled (transfers capability)
      if (status.payoutsEnabled) {
        payoutStatus = 'active'
      } else if (status.requirements?.disabledReason) {
        payoutStatus = 'restricted'
      }
    } else {
      // Native accounts: need both charges_enabled and payouts_enabled
      if (status.chargesEnabled && status.payoutsEnabled) {
        payoutStatus = 'active'
      } else if (status.requirements?.disabledReason) {
        payoutStatus = 'restricted'
      }
    }

    // Track if status is transitioning to active (first time activation)
    const isNewlyActive = profile.payoutStatus !== 'active' && payoutStatus === 'active'

    if (profile.payoutStatus !== payoutStatus) {
      await db.profile.update({
        where: { userId },
        data: { payoutStatus },
      })

      // Invalidate public profile cache - payoutStatus affects paymentsReady
      if (profile.username) {
        await invalidatePublicProfileCache(profile.username)
      }
    }

    // SECURITY: Rotate session token when payment account becomes active
    // This protects against session hijacking after completing payment onboarding
    let newToken: string | null = null
    if (isNewlyActive) {
      newToken = await rotateTokenOnSuccess(c)
    }

    return c.json({
      connected: true,
      status: payoutStatus,
      details: status,
      // Return rotated token for mobile clients (only on first activation)
      ...(newToken && { token: newToken }),
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

    // Standard accounts (e.g., cross-border) use the main Stripe Dashboard
    if (status.type === 'standard') {
      return c.json({ url: 'https://dashboard.stripe.com' })
    }

    const dashboardUrl = await createExpressDashboardLink(profile.stripeAccountId)
    return c.json({ url: dashboardUrl })
  } catch (error) {
    console.error('Dashboard link error:', error)
    return c.json({ error: 'Failed to create dashboard link' }, 500)
  }
})

export default stripeRoutes
