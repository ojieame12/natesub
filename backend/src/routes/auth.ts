import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import {
  requestMagicLink,
  verifyMagicLink,
  logout,
  getCurrentUser,
  getCurrentUserWithOnboarding,
  saveOnboardingProgress,
  hashToken,
  generateToken,
  computeOnboardingState,
} from '../services/auth.js'
import { requireAuth } from '../middleware/auth.js'
import { authVerifyRateLimit, authMagicLinkRateLimit } from '../middleware/rateLimit.js'
import { env } from '../config/env.js'
import { db } from '../db/client.js'
import { stripe } from '../services/stripe.js'

const auth = new Hono()

function isUserAuthError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('invalid code') ||
    m.includes('expired') ||
    m.includes('no longer valid') ||
    m.includes('too many failed attempts') ||
    m.includes('verification codes must be submitted in-app')
  )
}

// Auth endpoints should never be cached (they set cookies and return sensitive user/session data).
auth.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  c.header('Pragma', 'no-cache')
  await next()
})

// Request magic link
// Rate limited to prevent email enumeration and spam
auth.post(
  '/magic-link',
  authMagicLinkRateLimit,
  zValidator('json', z.object({
    email: z.string().email(),
  })),
  async (c) => {
    const { email } = c.req.valid('json')

    try {
      await requestMagicLink(email)
      return c.json({ success: true, message: 'Check your email for a verification code' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send code'
      return c.json({ error: message }, 400)
    }
  }
)

async function handleVerify(c: any, token: string, email?: string) {
  try {
    // Pass email to verifyMagicLink for scoped lookup (prevents OTP collision attacks)
    const { sessionToken, onboarding } = await verifyMagicLink(token, email)

    // Set session cookie (for web)
    // SECURITY: sameSite='Strict' prevents CSRF attacks
    setCookie(c, 'session', sessionToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'Strict',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    })

    // Return full onboarding state for smart routing
    return c.json({
      success: true,
      token: sessionToken, // Mobile apps store this and send in Authorization header
      // Onboarding state for frontend routing
      hasProfile: onboarding.hasProfile,
      hasActivePayment: onboarding.hasActivePayment,
      onboardingStep: onboarding.onboardingStep,
      onboardingBranch: onboarding.onboardingBranch,
      onboardingData: onboarding.onboardingData,
      redirectTo: onboarding.redirectTo,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Verification failed'

    // Never leak internal DB/stack errors to clients.
    if (!isUserAuthError(message)) {
      console.error('[auth/verify] Internal error:', error)
      return c.json({ error: 'Service temporarily unavailable. Please try again in a moment.' }, 503)
    }

    return c.json({ error: message }, 400)
  }
}

// Verify magic link token (preferred)
// Rate limited to prevent brute force OTP guessing
// Requires email to prevent OTP collision/takeover attacks
auth.post(
  '/verify',
  authVerifyRateLimit,
  zValidator('json', z.object({
    token: z.string().min(1),
    email: z.string().email(),
  })),
  async (c) => {
    const { token, email } = c.req.valid('json')
    return handleVerify(c, token, email)
  }
)

// Verify magic link token (legacy: query param)
// NOTE: Kept for backwards compatibility; POST /auth/verify avoids leaking OTPs in URLs/logs.
auth.get(
  '/verify',
  authVerifyRateLimit,
  zValidator('query', z.object({
    token: z.string().min(1),
  })),
  async (c) => {
    const { token } = c.req.valid('query')
    // Hardening: OTP flows must be verified with POST + email to prevent OTP collision/takeover attacks.
    if (/^\d{6}$/.test(token)) {
      return c.json({ error: 'Verification codes must be submitted in-app. Please enter the code and try again.' }, 400)
    }
    return handleVerify(c, token)
  }
)

// Logout
auth.post('/logout', async (c) => {
  const cookieToken = getCookie(c, 'session')

  // Mobile apps may use Bearer auth instead of cookies
  const authHeader = c.req.header('Authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined

  const sessionToken = cookieToken || bearerToken

  if (sessionToken) {
    await logout(sessionToken)
  }

  deleteCookie(c, 'session', { path: '/' })

  return c.json({ success: true })
})

// Get current user with onboarding state
auth.get('/me', requireAuth, async (c) => {
  const userId = c.get('userId')
  const result = await getCurrentUserWithOnboarding(userId)

  if (!result) {
    return c.json({ error: 'User not found' }, 404)
  }

  const { user, onboarding } = result

  // Only return necessary profile fields to avoid exposing internal data
  const safeProfile = user.profile ? {
    id: user.profile.id,
    username: user.profile.username,
    displayName: user.profile.displayName,
    avatarUrl: user.profile.avatarUrl,
    country: user.profile.country,
    currency: user.profile.currency,
    purpose: user.profile.purpose,
    payoutStatus: user.profile.payoutStatus,
    // Billing address fields (for Settings page)
    address: user.profile.address,
    city: user.profile.city,
    state: user.profile.state,
    zip: user.profile.zip,
  } : null

  return c.json({
    id: user.id,
    email: user.email,
    profile: safeProfile,
    createdAt: user.createdAt,
    // Onboarding state for smart routing
    onboarding: {
      hasProfile: onboarding.hasProfile,
      hasActivePayment: onboarding.hasActivePayment,
      step: onboarding.onboardingStep,
      branch: onboarding.onboardingBranch,
      data: onboarding.onboardingData,
      redirectTo: onboarding.redirectTo,
    },
  })
})

const onboardingDataSchema = z.object({
  // Identity fields (split names for Stripe KYC prefill)
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(100).optional(), // Legacy - kept for backwards compatibility
  displayName: z.string().min(1).max(100).optional(),
  country: z.string().min(2).max(100).optional(),
  countryCode: z.string().length(2).optional(),
  currency: z.string().length(3).optional(),
  username: z.string().min(3).max(20).regex(/^[a-z0-9_]+$/i).optional(),

  // Address fields (for Stripe KYC prefill - reduces onboarding screens)
  address: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  zip: z.string().max(20).optional(),

  // Profile fields
  avatarUrl: z.string().url().optional(),
  voiceIntroUrl: z.string().url().optional(),
  bio: z.string().max(500).optional(),

  // Purpose/branch selection
  purpose: z.enum(['tips', 'support', 'allowance', 'fan_club', 'exclusive_content', 'service', 'other']).optional(),

  // Pricing fields
  pricingModel: z.enum(['single', 'tiers']).optional(),
  singleAmount: z.number().int().min(1).max(1_000_000).optional(),
  tiers: z.array(z.object({
    id: z.string(),
    name: z.string(),
    amount: z.number(),
    perks: z.array(z.string()),
  })).optional(),

  // Perks
  perks: z.array(z.object({
    id: z.string(),
    title: z.string(),
    enabled: z.boolean(),
  })).optional(),

  // Service-specific fields
  serviceDescription: z.string().max(500).optional(),
  serviceDescriptionAudioUrl: z.string().url().optional(),
}).partial()

// Save onboarding progress
auth.put(
  '/onboarding',
  requireAuth,
  zValidator('json', z.object({
    step: z.number().min(0).max(15),
    branch: z.enum(['personal', 'service']).optional(),
    data: onboardingDataSchema.optional(),
  })),
  async (c) => {
    const userId = c.get('userId')
    const body = c.req.valid('json')

    try {
      await saveOnboardingProgress(userId, body)
      return c.json({ success: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save progress'
      return c.json({ error: message }, 400)
    }
  }
)

// E2E Test Login Helper (Test/Dev only)
if (env.NODE_ENV !== 'production') {
  auth.post(
    '/e2e-login',
    zValidator('json', z.object({
      email: z.string().email(),
    })),
    async (c) => {
      const { email } = c.req.valid('json')
      const normalizedEmail = email.toLowerCase().trim()

      const { user, sessionToken } = await db.$transaction(async (tx) => {
        let user = await tx.user.findUnique({
          where: { email: normalizedEmail },
          include: { profile: true },
        })

        if (!user) {
          user = await tx.user.create({
            data: {
              email: normalizedEmail,
              onboardingStep: 3, // Start at identity step
            },
            include: { profile: true },
          })
        }

        const sessionToken = generateToken() // You need to export this from services/auth or re-implement
        const sessionTokenHash = hashToken(sessionToken) // Export this too
        const sessionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

        await tx.session.create({
          data: {
            userId: user.id,
            token: sessionTokenHash,
            expiresAt: sessionExpiresAt,
          },
        })

        return { user, sessionToken }
      })

      setCookie(c, 'session', sessionToken, {
        httpOnly: true,
        secure: false, // Local/Test usually http
        sameSite: 'Strict',
        maxAge: 7 * 24 * 60 * 60,
        path: '/',
      })

      const onboarding = computeOnboardingState(user)

      return c.json({
        success: true,
        token: sessionToken,
        onboarding,
      })
    }
  )
}

// Delete account (soft delete)
auth.delete(
  '/account',
  requireAuth,
  zValidator('json', z.object({
    confirmation: z.literal('DELETE'),
  })),
  async (c) => {
    const userId = c.get('userId')
    const sessionToken = getCookie(c, 'session')

    // Cancel all Stripe subscriptions BEFORE deleting the account
    // This must happen outside the transaction since it's external API calls
    try {
      // 1. Cancel platform subscription if exists
      const profile = await db.profile.findUnique({
        where: { userId },
        select: { platformSubscriptionId: true },
      })

      if (profile?.platformSubscriptionId) {
        try {
          await stripe.subscriptions.cancel(profile.platformSubscriptionId)
          console.log(`[auth] Canceled platform subscription ${profile.platformSubscriptionId} for user ${userId}`)
        } catch (err: any) {
          // Don't fail account deletion if subscription already canceled
          if (err.code !== 'resource_missing') {
            console.error(`[auth] Failed to cancel platform subscription:`, err.message)
          }
        }
      }

      // 2. Cancel all subscriptions where user is the creator
      const creatorSubs = await db.subscription.findMany({
        where: {
          creatorId: userId,
          stripeSubscriptionId: { not: null },
          status: { in: ['active', 'past_due', 'pending'] },
        },
        select: { stripeSubscriptionId: true },
      })

      for (const sub of creatorSubs) {
        if (sub.stripeSubscriptionId) {
          try {
            await stripe.subscriptions.cancel(sub.stripeSubscriptionId)
            console.log(`[auth] Canceled creator subscription ${sub.stripeSubscriptionId}`)
          } catch (err: any) {
            if (err.code !== 'resource_missing') {
              console.error(`[auth] Failed to cancel creator subscription:`, err.message)
            }
          }
        }
      }

      // 3. Cancel all subscriptions where user is the subscriber
      const subscriberSubs = await db.subscription.findMany({
        where: {
          subscriberId: userId,
          stripeSubscriptionId: { not: null },
          status: { in: ['active', 'past_due', 'pending'] },
        },
        select: { stripeSubscriptionId: true },
      })

      for (const sub of subscriberSubs) {
        if (sub.stripeSubscriptionId) {
          try {
            await stripe.subscriptions.cancel(sub.stripeSubscriptionId)
            console.log(`[auth] Canceled subscriber subscription ${sub.stripeSubscriptionId}`)
          } catch (err: any) {
            if (err.code !== 'resource_missing') {
              console.error(`[auth] Failed to cancel subscriber subscription:`, err.message)
            }
          }
        }
      }

      console.log(`[auth] Finished canceling subscriptions for user ${userId}`)
    } catch (err) {
      console.error(`[auth] Error during subscription cleanup for user ${userId}:`, err)
      // Continue with account deletion even if subscription cleanup fails
    }

    // Soft delete user - sets deletedAt timestamp
    // Profile will be cascade deleted due to onDelete: Cascade
    await db.$transaction(async (tx) => {
      // Anonymize user data for GDPR compliance
      const anonymizedEmail = `deleted_${userId}@deleted.natepay.co`

      // Update user with soft delete and anonymize email
      await tx.user.update({
        where: { id: userId },
        data: {
          deletedAt: new Date(),
          email: anonymizedEmail,
        },
      })

      // Delete all sessions for this user
      await tx.session.deleteMany({
        where: { userId },
      })

      // Delete profile (contains PII)
      await tx.profile.deleteMany({
        where: { userId },
      })
    })

    // Clear session cookie
    deleteCookie(c, 'session', { path: '/' })

    return c.json({
      success: true,
      message: 'Your account has been deleted.',
    })
  }
)

export default auth
