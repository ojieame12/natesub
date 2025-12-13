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
} from '../services/auth.js'
import { requireAuth } from '../middleware/auth.js'
import { authVerifyRateLimit, authMagicLinkRateLimit } from '../middleware/rateLimit.js'
import { env } from '../config/env.js'
import { db } from '../db/client.js'

const auth = new Hono()

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

// Verify magic link token
// Rate limited to prevent brute force OTP guessing
auth.get(
  '/verify',
  authVerifyRateLimit,
  zValidator('query', z.object({
    token: z.string().min(1),
  })),
  async (c) => {
    const { token } = c.req.valid('query')

    try {
      const { sessionToken, userId, onboarding } = await verifyMagicLink(token)

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
      return c.json({ error: message }, 400)
    }
  }
)

// Logout
auth.post('/logout', async (c) => {
  const sessionToken = getCookie(c, 'session')

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

  return c.json({
    id: user.id,
    email: user.email,
    profile: user.profile,
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
  name: z.string().min(1).max(100).optional(),
  displayName: z.string().min(1).max(100).optional(),
  country: z.string().min(2).max(100).optional(),
  countryCode: z.string().length(2).optional(),
  currency: z.string().length(3).optional(),
  username: z.string().min(3).max(20).regex(/^[a-z0-9_]+$/i).optional(),
  pricingModel: z.enum(['single', 'tiers']).optional(),
  singleAmount: z.number().int().min(1).max(1_000_000).optional(),
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

      // Optionally: Cancel active subscriptions via Stripe
      // This would require additional Stripe API calls
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
