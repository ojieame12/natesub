import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import { requestMagicLink, verifyMagicLink, logout, getCurrentUser } from '../services/auth.js'
import { requireAuth } from '../middleware/auth.js'
import { env } from '../config/env.js'
import { db } from '../db/client.js'

const auth = new Hono()

// Request magic link
auth.post(
  '/magic-link',
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
auth.get(
  '/verify',
  zValidator('query', z.object({
    token: z.string().min(1),
  })),
  async (c) => {
    const { token } = c.req.valid('query')

    try {
      const { sessionToken, userId } = await verifyMagicLink(token)

      // Set session cookie (for web)
      setCookie(c, 'session', sessionToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'Lax',
        maxAge: 7 * 24 * 60 * 60, // 7 days
        path: '/',
      })

      // Check if user has completed onboarding
      const user = await getCurrentUser(userId)
      const hasProfile = !!user?.profile

      // Return token in response (for mobile apps that can't use cookies)
      return c.json({
        success: true,
        hasProfile,
        redirectTo: hasProfile ? '/dashboard' : '/onboarding',
        token: sessionToken, // Mobile apps store this and send in Authorization header
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

// Get current user
auth.get('/me', requireAuth, async (c) => {
  const userId = c.get('userId')
  const user = await getCurrentUser(userId)

  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }

  return c.json({
    id: user.id,
    email: user.email,
    profile: user.profile,
    createdAt: user.createdAt,
  })
})

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
