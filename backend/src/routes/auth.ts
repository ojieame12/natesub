import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { setCookie, deleteCookie, getCookie } from 'hono/cookie'
import { requestMagicLink, verifyMagicLink, logout, getCurrentUser } from '../services/auth.js'
import { requireAuth } from '../middleware/auth.js'
import { env } from '../config/env.js'

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
      return c.json({ success: true, message: 'Check your email for a sign-in link' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send magic link'
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

      // Set session cookie
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

      return c.json({
        success: true,
        hasProfile,
        redirectTo: hasProfile ? '/dashboard' : '/onboarding',
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

export default auth
