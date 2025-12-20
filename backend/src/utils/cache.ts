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
 */
export async function invalidateCache(keyOrPattern: string): Promise<void> {
  try {
    if (keyOrPattern.includes('*')) {
      // Pattern-based invalidation (use with caution - expensive)
      const keys = await redis.keys(keyOrPattern)
      if (keys.length > 0) {
        await redis.del(...keys)
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
