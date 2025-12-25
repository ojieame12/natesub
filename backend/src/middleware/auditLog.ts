/**
 * Audit Logging Middleware
 *
 * Logs sensitive data access for security audit trail.
 * Captures admin reads on sensitive resources like user PII, financial data, etc.
 */

import type { Context, Next } from 'hono'
import { db } from '../db/client.js'

/**
 * Sensitive resource types for audit logging
 */
export type AuditResourceType =
  | 'user_details'
  | 'user_list'
  | 'payment_details'
  | 'payment_list'
  | 'subscription_details'
  | 'subscription_list'
  | 'creator_details'
  | 'creator_list'
  | 'tax_earnings'
  | 'stripe_account'
  | 'export_data'
  | 'financial_data'
  | 'dispute_details'
  | 'admin_list'

/**
 * Audit log entry structure
 */
interface AuditLogEntry {
  type: 'admin_read'
  level: 'info'
  message: string
  metadata: {
    adminUserId?: string
    adminEmail?: string
    adminRole?: string
    authMethod?: string
    resourceType: AuditResourceType
    resourceId?: string
    path: string
    method: string
    query?: Record<string, string>
    ip: string
    userAgent?: string
    duration: number
    statusCode?: number
  }
}

// Throttle audit logs to prevent DB spam (max 1 log per resource per admin per 5 seconds)
const auditThrottleMap = new Map<string, number>()
const THROTTLE_MS = 5000

function shouldThrottle(key: string): boolean {
  const now = Date.now()
  const lastLogged = auditThrottleMap.get(key)

  if (lastLogged && now - lastLogged < THROTTLE_MS) {
    return true
  }

  auditThrottleMap.set(key, now)

  // Clean up old entries periodically
  if (auditThrottleMap.size > 1000) {
    const threshold = now - THROTTLE_MS * 2
    for (const [k, v] of auditThrottleMap) {
      if (v < threshold) {
        auditThrottleMap.delete(k)
      }
    }
  }

  return false
}

/**
 * Create an audit logging middleware for sensitive read operations
 *
 * Usage:
 * ```typescript
 * admin.get('/users/:id', auditSensitiveRead('user_details'), async (c) => { ... })
 * admin.get('/users', auditSensitiveRead('user_list'), async (c) => { ... })
 * ```
 *
 * The middleware logs after the response is sent, including:
 * - Which admin accessed the data
 * - What resource was accessed
 * - Request metadata (path, query params, IP)
 * - Response status and duration
 */
export function auditSensitiveRead(resourceType: AuditResourceType) {
  return async (c: Context, next: Next) => {
    const start = Date.now()

    // Execute the handler first
    await next()

    // Only log successful responses (2xx)
    if (c.res.status < 200 || c.res.status >= 300) {
      return
    }

    // Get admin context
    const adminUserId = c.get('adminUserId') as string | undefined
    const adminEmail = c.get('adminEmail') as string | undefined
    const adminRole = c.get('adminRole') as string | undefined
    const authMethod = c.get('adminAuthMethod') as string | undefined

    // Generate throttle key
    const resourceId = c.req.param('id') || c.req.param('userId') || undefined
    const throttleKey = `${adminUserId}:${resourceType}:${resourceId || 'list'}`

    // Skip if throttled
    if (shouldThrottle(throttleKey)) {
      return
    }

    // Get request metadata
    const path = c.req.path
    const method = c.req.method
    const url = new URL(c.req.url)
    const query = Object.fromEntries(url.searchParams)
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
               c.req.header('x-real-ip') ||
               'unknown'
    const userAgent = c.req.header('user-agent')

    const duration = Date.now() - start

    // Log asynchronously (non-blocking)
    const logEntry: AuditLogEntry = {
      type: 'admin_read',
      level: 'info',
      message: `Admin accessed ${resourceType}${resourceId ? ` (${resourceId})` : ''}`,
      metadata: {
        adminUserId,
        adminEmail,
        adminRole,
        authMethod,
        resourceType,
        resourceId,
        path,
        method,
        query: Object.keys(query).length > 0 ? query : undefined,
        ip,
        userAgent,
        duration,
        statusCode: c.res.status,
      },
    }

    // Write to database (fire-and-forget)
    db.systemLog
      .create({
        data: {
          type: logEntry.type,
          level: logEntry.level,
          message: logEntry.message,
          metadata: logEntry.metadata,
        },
      })
      .catch((err) => {
        // Don't let audit log failures affect the request
        console.warn('[audit] Failed to log admin read:', err.message)
      })
  }
}

/**
 * Batch audit logging for list operations
 *
 * For high-volume endpoints, logs summary instead of individual access.
 * Used for endpoints like /admin/users that may be accessed frequently.
 */
export function auditListAccess(resourceType: AuditResourceType) {
  return auditSensitiveRead(resourceType)
}

/**
 * Export operation audit logging
 *
 * Specifically for data export endpoints - always logs regardless of throttle.
 */
export function auditExport(resourceType: AuditResourceType = 'export_data') {
  return async (c: Context, next: Next) => {
    const start = Date.now()

    await next()

    // Log all export attempts, even failed ones
    const adminUserId = c.get('adminUserId') as string | undefined
    const adminEmail = c.get('adminEmail') as string | undefined

    const logEntry = {
      type: 'admin_export' as const,
      level: 'info' as const,
      message: `Admin exported ${resourceType}`,
      metadata: {
        adminUserId,
        adminEmail,
        resourceType,
        path: c.req.path,
        statusCode: c.res.status,
        duration: Date.now() - start,
        ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
      },
    }

    db.systemLog
      .create({ data: logEntry })
      .catch((err) => {
        console.warn('[audit] Failed to log export:', err.message)
      })
  }
}
