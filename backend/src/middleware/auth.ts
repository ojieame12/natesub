import { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { validateSession } from '../services/auth.js'

// Extend Hono context with user info
declare module 'hono' {
  interface ContextVariableMap {
    userId: string
  }
}

// Auth middleware - requires valid session
export async function requireAuth(c: Context, next: Next) {
  const sessionToken = getCookie(c, 'session')

  if (!sessionToken) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const session = await validateSession(sessionToken)

  if (!session) {
    return c.json({ error: 'Invalid or expired session' }, 401)
  }

  c.set('userId', session.userId)

  await next()
}

// Optional auth - sets userId if logged in, but doesn't require it
export async function optionalAuth(c: Context, next: Next) {
  const sessionToken = getCookie(c, 'session')

  if (sessionToken) {
    const session = await validateSession(sessionToken)
    if (session) {
      c.set('userId', session.userId)
    }
  }

  await next()
}
