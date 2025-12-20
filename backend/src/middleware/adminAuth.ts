/**
 * Admin Authentication Middleware
 *
 * Centralized admin auth that supports:
 * 1. API key auth (for Retool/external tools) - via x-admin-api-key header
 *    - Database-backed keys (preferred): Stored as SHA-256 hashes with scope/expiration
 *    - Legacy env var keys (fallback): ADMIN_API_KEY and ADMIN_API_KEY_READONLY
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
import { createHash } from 'crypto'
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
    adminAuthMethod?: 'api-key' | 'api-key-legacy' | 'session'
    adminApiKeyScope?: ApiKeyScope
    adminApiKeyId?: string      // Database key ID
    adminApiKeyPrefix?: string  // Key prefix for logging
    adminSessionCreatedAt?: Date
    adminSessionFresh?: boolean
  }
}

/**
 * Hash an API key using SHA-256 (must match api-keys.ts)
 */
function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/**
 * Validate API key against database
 * Returns key details if valid, null otherwise
 */
async function validateDatabaseApiKey(plainKey: string): Promise<{
  id: string
  name: string
  keyPrefix: string
  scope: string
  createdById: string
} | null> {
  const keyHash = hashApiKey(plainKey)

  const model = (db as any).adminApiKey
  if (!model?.findUnique) return null

  const apiKey = await model.findUnique({
    where: { keyHash },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scope: true,
      createdById: true,
      expiresAt: true,
      revokedAt: true,
    }
  })

  if (!apiKey) return null

  // Check if revoked
  if (apiKey.revokedAt) return null

  // Check if expired
  if (apiKey.expiresAt && new Date(apiKey.expiresAt) < new Date()) return null

  return {
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    scope: apiKey.scope,
    createdById: apiKey.createdById,
  }
}

/**
 * Update API key usage tracking (non-blocking)
 */
function updateApiKeyUsage(keyId: string, ip: string): void {
  const model = (db as any).adminApiKey
  if (!model?.update) return

  model.update({
    where: { id: keyId },
    data: {
      lastUsedAt: new Date(),
      lastUsedIp: ip,
    }
  }).catch((err: unknown) => {
    console.error('Failed to update API key usage:', err)
  })
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
  details?: { userId?: string; email?: string; role?: string; authMethod?: string; scope?: string; reason?: string; keyPrefix?: string; keyId?: string }
): Promise<void> {
  try {
    // Get keyPrefix from context if not in details (for database keys)
    const keyPrefix = details?.keyPrefix || c.get('adminApiKeyPrefix')
    const keyId = details?.keyId || c.get('adminApiKeyId')

    await db.systemLog.create({
      data: {
        type: success ? 'admin_access' : 'admin_access_denied',
        message: success
          ? `Admin access granted via ${details?.authMethod || 'unknown'}${details?.scope ? ` (${details.scope})` : ''}${keyPrefix ? ` [${keyPrefix}...]` : ''}`
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
          keyPrefix,
          keyId,
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
  const clientIp = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown'

  // Option 1: API key auth (for Retool/external tools)
  const apiKey = c.req.header('x-admin-api-key')

  if (apiKey) {
    // Try database-backed keys first (preferred)
    const dbKey = await validateDatabaseApiKey(apiKey)

    if (dbKey) {
      const method = c.req.method.toUpperCase()

      // Check scope permissions
      if (dbKey.scope === 'readonly' && method !== 'GET') {
        await logAdminAccess(c, false, {
          authMethod: 'api-key',
          role: 'admin',
          scope: 'readonly',
          reason: `Read-only API key cannot perform ${method} requests`
        })
        throw new HTTPException(403, {
          message: 'Read-only API key cannot perform this action. Use full access key for write operations.'
        })
      }

      // Set context for database key
      c.set('adminAuthMethod', 'api-key')
      c.set('adminRole', dbKey.scope === 'full' ? 'super_admin' : 'admin')
      c.set('adminApiKeyScope', dbKey.scope === 'full' ? 'full' : 'read-only')
      c.set('adminApiKeyId', dbKey.id)
      c.set('adminApiKeyPrefix', dbKey.keyPrefix)

      // Update usage tracking (non-blocking)
      updateApiKeyUsage(dbKey.id, clientIp)

      // Log access with key prefix for audit
      logAdminAccess(c, true, {
        authMethod: 'api-key',
        role: dbKey.scope === 'full' ? 'super_admin' : 'admin',
        scope: dbKey.scope,
      }).catch(() => { })

      await next()
      return
    }

    // Fallback: Legacy env var keys (for backwards compatibility)
    const fullAccessKey = process.env.ADMIN_API_KEY
    const readOnlyKey = process.env.ADMIN_API_KEY_READONLY

    // Check full access key (grants super_admin)
    if (fullAccessKey && apiKey === fullAccessKey) {
      c.set('adminAuthMethod', 'api-key-legacy')
      c.set('adminRole', 'super_admin')
      c.set('adminApiKeyScope', 'full')
      logAdminAccess(c, true, { authMethod: 'api-key-legacy', role: 'super_admin', scope: 'full' }).catch(() => { })
      await next()
      return
    }

    // Check read-only key (grants admin role, blocks non-GET requests)
    if (readOnlyKey && apiKey === readOnlyKey) {
      const method = c.req.method.toUpperCase()

      if (method !== 'GET') {
        await logAdminAccess(c, false, {
          authMethod: 'api-key-legacy',
          role: 'admin',
          scope: 'read-only',
          reason: `Read-only API key cannot perform ${method} requests`
        })
        throw new HTTPException(403, {
          message: 'Read-only API key cannot perform this action. Use full access key for write operations.'
        })
      }

      c.set('adminAuthMethod', 'api-key-legacy')
      c.set('adminRole', 'admin')
      c.set('adminApiKeyScope', 'read-only')
      logAdminAccess(c, true, { authMethod: 'api-key-legacy', role: 'admin', scope: 'read-only' }).catch(() => { })
      await next()
      return
    }
  }

  // Option 2: User session auth (for frontend dashboard)
  const sessionToken = getSessionToken(c)
  if (sessionToken) {
    const session = await validateSessionWithDetails(sessionToken)
    if (session) {
      if (isAdminRole(session.role)) {
        // Calculate session freshness (created within the window)
        const sessionAge = Date.now() - session.createdAt.getTime()
        const isFresh = sessionAge < FRESH_SESSION_WINDOW_MS

        c.set('adminUserId', session.userId)
        c.set('adminEmail', session.email)
        c.set('adminRole', session.role)
        c.set('adminAuthMethod', 'session')
        c.set('adminSessionCreatedAt', session.createdAt)
        c.set('adminSessionFresh', isFresh)
        // Don't block the request on logging.
        logAdminAccess(c, true, {
          userId: session.userId,
          email: session.email,
          role: session.role,
          authMethod: 'session',
        }).catch(() => { })
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
  const clientIp = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown'

  // Try API keys first
  const apiKey = c.req.header('x-admin-api-key')

  if (apiKey) {
    // Try database-backed keys first
    const dbKey = await validateDatabaseApiKey(apiKey)

    if (dbKey) {
      c.set('adminAuthMethod', 'api-key')
      c.set('adminRole', dbKey.scope === 'full' ? 'super_admin' : 'admin')
      c.set('adminApiKeyScope', dbKey.scope === 'full' ? 'full' : 'read-only')
      c.set('adminApiKeyId', dbKey.id)
      c.set('adminApiKeyPrefix', dbKey.keyPrefix)
      updateApiKeyUsage(dbKey.id, clientIp)
      await next()
      return
    }

    // Fallback: Legacy env var keys
    const fullAccessKey = process.env.ADMIN_API_KEY
    const readOnlyKey = process.env.ADMIN_API_KEY_READONLY

    if (fullAccessKey && apiKey === fullAccessKey) {
      c.set('adminAuthMethod', 'api-key-legacy')
      c.set('adminRole', 'super_admin')
      c.set('adminApiKeyScope', 'full')
      await next()
      return
    }

    if (readOnlyKey && apiKey === readOnlyKey) {
      c.set('adminAuthMethod', 'api-key-legacy')
      c.set('adminRole', 'admin')
      c.set('adminApiKeyScope', 'read-only')
      await next()
      return
    }
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
  if ((authMethod === 'api-key' || authMethod === 'api-key-legacy') && apiKeyScope === 'full') {
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
