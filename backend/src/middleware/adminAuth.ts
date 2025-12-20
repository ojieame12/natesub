/**
 * Admin Authentication Middleware
 *
 * Centralized admin auth that supports:
 * 1. API key auth (for Retool/external tools) - via x-admin-api-key header
 *    - ADMIN_API_KEY: Full access (super_admin) - can perform all actions
 *    - ADMIN_API_KEY_READONLY: Read-only access - GET requests only
 * 2. Session auth (for frontend dashboard) - via cookie or Bearer token
 *
 * Role-based access control:
 * - user: Regular user (no admin access)
 * - admin: Can view admin dashboard, limited actions
 * - super_admin: Full admin access including destructive actions
 *
 * Also includes access logging to SystemLog for audit trail.
 */

import { Context, Next } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { getCookie } from 'hono/cookie'
import { db } from '../db/client.js'
import { validateSession, validateSessionWithDetails } from '../services/auth.js'
import type { UserRole } from '@prisma/client'

// Roles that have admin access (can access admin dashboard)
const ADMIN_ROLES: UserRole[] = ['admin', 'super_admin']

// API key scopes
export type ApiKeyScope = 'full' | 'read-only'

// Session freshness window for sensitive operations (15 minutes)
const FRESH_SESSION_WINDOW_MS = 15 * 60 * 1000

// Extend Hono context with admin info
declare module 'hono' {
  interface ContextVariableMap {
    adminUserId?: string
    adminEmail?: string
    adminRole?: UserRole
    adminAuthMethod?: 'api-key' | 'session'
    adminApiKeyScope?: ApiKeyScope
    adminSessionCreatedAt?: Date
    adminSessionFresh?: boolean
  }
}

/**
 * Check if a role has admin access
 */
export function isAdminRole(role: UserRole | undefined | null): boolean {
  if (!role) return false
  return ADMIN_ROLES.includes(role)
}

/**
 * Check if a role is super_admin
 */
export function isSuperAdmin(role: UserRole | undefined | null): boolean {
  return role === 'super_admin'
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
  details?: { userId?: string; email?: string; role?: string; authMethod?: string; scope?: string; reason?: string }
): Promise<void> {
  try {
    await db.systemLog.create({
      data: {
        type: success ? 'admin_access' : 'admin_access_denied',
        message: success
          ? `Admin access granted via ${details?.authMethod || 'unknown'}${details?.scope ? ` (${details.scope})` : ''}`
          : details?.reason || 'Admin access denied',
        metadata: {
          path: c.req.path,
          method: c.req.method,
          ip: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown',
          userAgent: c.req.header('user-agent'),
          userId: details?.userId,
          email: details?.email,
          role: details?.role,
          authMethod: details?.authMethod,
          scope: details?.scope,
          reason: details?.reason,
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
          adminRole: c.get('adminRole'),
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
 * Allows: admin, super_admin roles
 * Use this for all protected admin routes
 */
export async function adminAuth(c: Context, next: Next): Promise<void> {
  // Option 1: API key auth (for Retool/external tools)
  const apiKey = c.req.header('x-admin-api-key')
  const fullAccessKey = process.env.ADMIN_API_KEY
  const readOnlyKey = process.env.ADMIN_API_KEY_READONLY

  // Check full access key first (grants super_admin)
  if (apiKey && fullAccessKey && apiKey === fullAccessKey) {
    c.set('adminAuthMethod', 'api-key')
    c.set('adminRole', 'super_admin')
    c.set('adminApiKeyScope', 'full')
    await logAdminAccess(c, true, { authMethod: 'api-key', role: 'super_admin', scope: 'full' })
    await next()
    return
  }

  // Check read-only key (grants admin role, blocks non-GET requests)
  if (apiKey && readOnlyKey && apiKey === readOnlyKey) {
    const method = c.req.method.toUpperCase()

    // Read-only key only allows GET requests
    if (method !== 'GET') {
      await logAdminAccess(c, false, {
        authMethod: 'api-key',
        role: 'admin',
        scope: 'read-only',
        reason: `Read-only API key cannot perform ${method} requests`
      })
      throw new HTTPException(403, {
        message: 'Read-only API key cannot perform this action. Use full access key for write operations.'
      })
    }

    c.set('adminAuthMethod', 'api-key')
    c.set('adminRole', 'admin') // admin role, not super_admin
    c.set('adminApiKeyScope', 'read-only')
    await logAdminAccess(c, true, { authMethod: 'api-key', role: 'admin', scope: 'read-only' })
    await next()
    return
  }

  // Option 2: User session auth (for frontend dashboard)
  const sessionToken = getSessionToken(c)
  if (sessionToken) {
    const session = await validateSessionWithDetails(sessionToken)
    if (session) {
      const user = await db.user.findUnique({
        where: { id: session.userId },
        select: { id: true, email: true, role: true },
      })

      if (user && isAdminRole(user.role)) {
        // Calculate session freshness (created within the window)
        const sessionAge = Date.now() - session.createdAt.getTime()
        const isFresh = sessionAge < FRESH_SESSION_WINDOW_MS

        c.set('adminUserId', user.id)
        c.set('adminEmail', user.email)
        c.set('adminRole', user.role)
        c.set('adminAuthMethod', 'session')
        c.set('adminSessionCreatedAt', session.createdAt)
        c.set('adminSessionFresh', isFresh)
        await logAdminAccess(c, true, {
          userId: user.id,
          email: user.email,
          role: user.role,
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
  // Try API keys first
  const apiKey = c.req.header('x-admin-api-key')
  const fullAccessKey = process.env.ADMIN_API_KEY
  const readOnlyKey = process.env.ADMIN_API_KEY_READONLY

  // Full access key
  if (apiKey && fullAccessKey && apiKey === fullAccessKey) {
    c.set('adminAuthMethod', 'api-key')
    c.set('adminRole', 'super_admin')
    c.set('adminApiKeyScope', 'full')
    await next()
    return
  }

  // Read-only key (no method restriction for optional auth - route decides)
  if (apiKey && readOnlyKey && apiKey === readOnlyKey) {
    c.set('adminAuthMethod', 'api-key')
    c.set('adminRole', 'admin')
    c.set('adminApiKeyScope', 'read-only')
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
        select: { id: true, email: true, role: true },
      })

      if (user && isAdminRole(user.role)) {
        c.set('adminUserId', user.id)
        c.set('adminEmail', user.email)
        c.set('adminRole', user.role)
        c.set('adminAuthMethod', 'session')
      }
    }
  }

  await next()
}

/**
 * Require a specific role (or higher) for a route
 * Use this to protect destructive actions that need super_admin
 *
 * Example:
 *   admin.delete('/users/:id', requireRole('super_admin'), async (c) => { ... })
 */
export function requireRole(requiredRole: UserRole) {
  return async (c: Context, next: Next): Promise<void> => {
    const userRole = c.get('adminRole')

    // Role hierarchy: super_admin > admin > user
    const roleHierarchy: Record<UserRole, number> = {
      user: 0,
      admin: 1,
      super_admin: 2,
    }

    const userLevel = userRole ? roleHierarchy[userRole] : -1
    const requiredLevel = roleHierarchy[requiredRole]

    if (userLevel < requiredLevel) {
      throw new HTTPException(403, {
        message: `This action requires ${requiredRole} role`,
      })
    }

    await next()
  }
}

/**
 * Require a fresh session (authenticated within last 15 minutes) for sensitive operations
 *
 * This adds an extra layer of protection for destructive/financial actions like:
 * - Processing refunds
 * - Initiating payouts
 * - Deleting users
 * - Blocking subscribers
 *
 * API key auth (with full access key) bypasses this check since API keys
 * are typically used in automated/trusted contexts.
 *
 * Example:
 *   admin.post('/payouts', requireFreshSession, async (c) => { ... })
 */
export function requireFreshSession(c: Context, next: Next): Promise<void> | void {
  const authMethod = c.get('adminAuthMethod')
  const apiKeyScope = c.get('adminApiKeyScope')

  // API key with full access bypasses fresh session requirement
  // (API keys are used in trusted automated contexts like Retool)
  if (authMethod === 'api-key' && apiKeyScope === 'full') {
    return next()
  }

  // For session auth, require fresh session
  if (authMethod === 'session') {
    const isFresh = c.get('adminSessionFresh')

    if (!isFresh) {
      throw new HTTPException(403, {
        message: 'This action requires recent authentication. Please log out and log back in to continue.',
      })
    }

    return next()
  }

  // Unknown auth method - deny
  throw new HTTPException(403, {
    message: 'This action requires session authentication',
  })
}
