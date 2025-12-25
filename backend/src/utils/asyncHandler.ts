/**
 * Async Handler Utility
 *
 * Wraps async route handlers with error handling to catch unhandled
 * exceptions and return appropriate error responses.
 */

import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'

/**
 * Wraps async route handlers with try/catch error handling
 *
 * Usage:
 * ```typescript
 * admin.get('/users', asyncHandler(async (c) => {
 *   // handler code here
 * }))
 * ```
 *
 * Benefits:
 * - Catches unhandled promise rejections
 * - Re-throws HTTPExceptions (they have proper status codes)
 * - Logs errors with context
 * - Returns generic error message (doesn't expose internals)
 */
export function asyncHandler<T>(
  handler: (c: Context) => Promise<T>
): (c: Context) => Promise<T | Response> {
  return async (c: Context): Promise<T | Response> => {
    try {
      return await handler(c)
    } catch (error) {
      // Re-throw HTTP exceptions - they have proper status codes
      if (error instanceof HTTPException) {
        throw error
      }

      // Log the error with context
      const requestId = c.req.header('x-request-id')
      const path = c.req.path
      const method = c.req.method

      console.error('[asyncHandler] Unhandled error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        path,
        method,
        requestId,
      })

      // Return generic error (don't expose internal details)
      return c.json(
        {
          error: 'An internal error occurred',
          requestId: requestId || undefined,
        },
        500
      )
    }
  }
}

/**
 * Creates an error handler middleware for admin routes
 * Provides consistent error formatting across admin endpoints
 */
export function adminErrorHandler() {
  return async (c: Context, next: () => Promise<void>) => {
    try {
      await next()
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error
      }

      const requestId = c.req.header('x-request-id')

      console.error('[admin] Unhandled error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        path: c.req.path,
        adminUserId: c.get('adminUserId'),
        requestId,
      })

      return c.json(
        {
          error: 'An internal error occurred',
          requestId: requestId || undefined,
        },
        500
      )
    }
  }
}
