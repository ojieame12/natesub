/**
 * Request ID Middleware
 *
 * Adds correlation IDs to requests for error tracking and debugging.
 * Uses existing X-Request-ID header if present, otherwise generates one.
 */

import crypto from 'crypto'
import type { Context, Next } from 'hono'

export async function requestIdMiddleware(c: Context, next: Next) {
  // Use existing request ID from header (e.g., from load balancer)
  // or generate a new one
  const requestId = c.req.header('x-request-id') || crypto.randomUUID()

  // Set the request ID in context for use in handlers
  c.set('requestId', requestId)

  // Add to response headers for client-side correlation
  c.header('x-request-id', requestId)

  await next()
}

// Helper to get request ID from context
export function getRequestId(c: Context): string {
  return c.get('requestId') || 'unknown'
}

// Logger helper that includes request ID
export function logWithRequestId(c: Context, level: 'info' | 'error' | 'warn', message: string, data?: any) {
  const requestId = getRequestId(c)
  const timestamp = new Date().toISOString()
  const logData = data ? JSON.stringify(data) : ''

  switch (level) {
    case 'error':
      console.error(`[${timestamp}] [${requestId}] ERROR: ${message}`, logData)
      break
    case 'warn':
      console.warn(`[${timestamp}] [${requestId}] WARN: ${message}`, logData)
      break
    default:
      console.log(`[${timestamp}] [${requestId}] INFO: ${message}`, logData)
  }
}
