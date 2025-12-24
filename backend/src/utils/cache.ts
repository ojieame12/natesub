/**
 * Redis Cache Utility
 *
 * Simple caching layer for expensive database queries.
 * Uses Redis with automatic fallback to no-caching if Redis is unavailable.
 */

import { redis } from '../db/redis.js'

// Cache TTLs in seconds
export const CACHE_TTL = {
  SHORT: 60,         // 1 minute - for frequently changing data
  MEDIUM: 300,       // 5 minutes - for dashboard stats
  LONG: 900,         // 15 minutes - for historical aggregates
  DAILY: 3600,       // 1 hour - for daily snapshots
} as const

/**
 * Get a cached value or compute it
 *
 * @param key - Cache key
 * @param ttlSeconds - Time to live in seconds
 * @param compute - Function to compute the value if not cached
 * @returns The cached or computed value
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>
): Promise<T> {
  // Tests run with an in-memory Redis mock shared across suites.
  // Skipping caching in tests prevents cross-test contamination.
  if (process.env.NODE_ENV === 'test') {
    return compute()
  }

  try {
    // Try to get from cache
    const cached = await redis.get(key)
    if (cached) {
      return JSON.parse(cached) as T
    }
  } catch (err) {
    // Redis error - fall through to compute
    console.warn(`[cache] Redis get failed for ${key}:`, err)
  }

  // Compute the value
  const value = await compute()

  try {
    // Store in cache (don't await - fire and forget)
    redis.setex(key, ttlSeconds, JSON.stringify(value)).catch((err: unknown) => {
      console.warn(`[cache] Redis setex failed for ${key}:`, err)
    })
  } catch (err) {
    // Ignore cache write errors
  }

  return value
}

/**
 * Invalidate a cache key or pattern
 *
 * For pattern-based invalidation, uses SCAN instead of KEYS to avoid
 * blocking Redis on large keyspaces. SCAN is O(1) per iteration vs O(n) for KEYS.
 */
export async function invalidateCache(keyOrPattern: string): Promise<void> {
  try {
    if (keyOrPattern.includes('*')) {
      // Use SCAN for pattern-based invalidation (non-blocking, safer for large keyspaces)
      // KEYS is O(n) and can block Redis; SCAN is O(1) per iteration
      let cursor = '0'
      const keysToDelete: string[] = []

      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', keyOrPattern, 'COUNT', 100)
        cursor = nextCursor
        keysToDelete.push(...keys)
      } while (cursor !== '0')

      if (keysToDelete.length > 0) {
        // Delete in batches to avoid memory issues with large key sets
        const batchSize = 100
        for (let i = 0; i < keysToDelete.length; i += batchSize) {
          const batch = keysToDelete.slice(i, i + batchSize)
          await redis.del(...batch)
        }
      }
    } else {
      await redis.del(keyOrPattern)
    }
  } catch (err) {
    console.warn(`[cache] Invalidation failed for ${keyOrPattern}:`, err)
  }
}

/**
 * Generate a cache key for admin revenue endpoints
 */
export function adminRevenueKey(endpoint: string, params?: Record<string, any>): string {
  const base = `admin:revenue:${endpoint}`
  if (!params || Object.keys(params).length === 0) {
    return base
  }
  // Sort keys for consistent cache keys
  const sortedParams = Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join(':')
  return `${base}:${sortedParams}`
}

/**
 * Generate a cache key for admin dashboard endpoints
 */
export function adminDashboardKey(endpoint: string): string {
  return `admin:dashboard:${endpoint}`
}

/**
 * Invalidate all admin revenue caches
 *
 * Call this after payment mutations (webhook processing, refunds, etc.)
 * to ensure admin dashboard shows fresh data.
 */
export async function invalidateAdminRevenueCache(): Promise<void> {
  const patterns = [
    'admin:revenue:overview',
    'admin:revenue:by-provider:*',
    'admin:revenue:by-currency:*',
    'admin:revenue:daily:*',
    'admin:revenue:monthly:*',
    'admin:revenue:top-creators:*',
    'admin:revenue:refunds:*',
    'admin:dashboard:*',
  ]

  for (const pattern of patterns) {
    await invalidateCache(pattern)
  }
}
