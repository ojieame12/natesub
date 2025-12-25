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

// Import db for purpose check
import { db } from '../db/client.js'

// Require service purpose - restricts access to service providers only
// Used for payroll routes which are only relevant to service providers
export async function requireServicePurpose(c: Context, next: Next) {
  const userId = c.get('userId')

  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const profile = await db.profile.findUnique({
    where: { userId },
    select: { purpose: true },
  })

  if (!profile || profile.purpose !== 'service') {
    return c.json({ error: 'This feature is only available for service providers' }, 403)
  }

  await next()
}
