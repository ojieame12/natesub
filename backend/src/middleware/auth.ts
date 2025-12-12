import { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { validateSession } from '../services/auth.js'

// Extend Hono context with user info
declare module 'hono' {
  interface ContextVariableMap {
    userId: string
  }
}

// Get session token from cookie or Authorization header
function getSessionToken(c: Context): string | undefined {
  // Try cookie first (web)
  const cookieToken = getCookie(c, 'session')
  if (cookieToken) return cookieToken

  // Try Authorization header (mobile apps)
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }

  return undefined
}

// Auth middleware - requires valid session
export async function requireAuth(c: Context, next: Next) {
  const sessionToken = getSessionToken(c)

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
  const sessionToken = getSessionToken(c)

  if (sessionToken) {
    const session = await validateSession(sessionToken)
    if (session) {
      c.set('userId', session.userId)
    }
  }

  await next()
}
