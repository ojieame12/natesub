/**
 * Admin Authentication Middleware
 *
 * Centralized admin auth that supports:
 * 1. API key auth (for Retool/external tools) - via x-admin-api-key header
 * 2. Session auth (for frontend dashboard) - via cookie or Bearer token
 *
 * Also includes access logging to SystemLog for audit trail.
 */

import { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { getCookie } from 'hono/cookie'
import { db } from '../db/client.js'
import { validateSession } from '../services/auth.js'
import { isAdminEmail } from '../config/admin.js'

// Extend Hono context with admin info
declare module 'hono' {
  interface ContextVariableMap {
    adminUserId?: string
    adminEmail?: string
    adminAuthMethod?: 'api-key' | 'session'
  }
}

/**
 * Get session token from cookie or Authorization header
 */
export function getSessionToken(c: Context): string | undefined {
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

/**
 * Log admin access attempt to SystemLog
 */
async function logAdminAccess(
  c: Context,
  success: boolean,
  details?: { userId?: string; email?: string; authMethod?: string }
): Promise<void> {
  try {
    await db.systemLog.create({
      data: {
        type: success ? 'admin_access' : 'admin_access_denied',
        message: success
          ? `Admin access granted via ${details?.authMethod || 'unknown'}`
          : 'Admin access denied',
        metadata: {
          path: c.req.path,
          method: c.req.method,
          ip: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown',
          userAgent: c.req.header('user-agent'),
          userId: details?.userId,
          email: details?.email,
          authMethod: details?.authMethod,
        },
      },
    })
  } catch (error) {
    // Don't fail the request if logging fails
    console.error('Failed to log admin access:', error)
  }
}

/**
 * Log admin action for audit trail
 */
export async function logAdminAction(
  c: Context,
  action: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    await db.systemLog.create({
      data: {
        type: 'admin_action',
        message: action,
        metadata: {
          ...details,
          adminUserId: c.get('adminUserId'),
          adminEmail: c.get('adminEmail'),
          adminAuthMethod: c.get('adminAuthMethod'),
          path: c.req.path,
          method: c.req.method,
          ip: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown',
        },
      },
    })
  } catch (error) {
    console.error('Failed to log admin action:', error)
  }
}

/**
 * Admin auth middleware - requires valid admin access
 * Use this for all protected admin routes
 */
export async function adminAuth(c: Context, next: Next): Promise<void> {
  // Option 1: API key auth (for Retool/external tools)
  const apiKey = c.req.header('x-admin-api-key')
  const expectedKey = process.env.ADMIN_API_KEY

  if (apiKey && expectedKey && apiKey === expectedKey) {
    c.set('adminAuthMethod', 'api-key')
    await logAdminAccess(c, true, { authMethod: 'api-key' })
    await next()
    return
  }

  // Option 2: User session auth (for frontend dashboard)
  const sessionToken = getSessionToken(c)
  if (sessionToken) {
    const session = await validateSession(sessionToken)
    if (session) {
      const user = await db.user.findUnique({
        where: { id: session.userId },
        select: { id: true, email: true },
      })

      if (user && isAdminEmail(user.email)) {
        c.set('adminUserId', user.id)
        c.set('adminEmail', user.email)
        c.set('adminAuthMethod', 'session')
        await logAdminAccess(c, true, {
          userId: user.id,
          email: user.email,
          authMethod: 'session',
        })
        await next()
        return
      }
    }
  }

  // Access denied
  await logAdminAccess(c, false)
  throw new HTTPException(401, { message: 'Admin access required' })
}

/**
 * Optional admin auth - sets admin info if authenticated, but doesn't require it
 * Use this for routes like /admin/me that need to work for both admins and non-admins
 */
export async function adminAuthOptional(c: Context, next: Next): Promise<void> {
  // Try API key first
  const apiKey = c.req.header('x-admin-api-key')
  const expectedKey = process.env.ADMIN_API_KEY

  if (apiKey && expectedKey && apiKey === expectedKey) {
    c.set('adminAuthMethod', 'api-key')
    await next()
    return
  }

  // Try session
  const sessionToken = getSessionToken(c)
  if (sessionToken) {
    const session = await validateSession(sessionToken)
    if (session) {
      const user = await db.user.findUnique({
        where: { id: session.userId },
        select: { id: true, email: true },
      })

      if (user && isAdminEmail(user.email)) {
        c.set('adminUserId', user.id)
        c.set('adminEmail', user.email)
        c.set('adminAuthMethod', 'session')
      }
    }
  }

  await next()
}
