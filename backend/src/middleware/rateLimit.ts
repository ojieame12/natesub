/**
 * Rate Limiting Middleware
 *
 * Uses Redis for distributed rate limiting.
 * Supports per-user limits with configurable windows.
 */

import type { Context, Next } from 'hono'
import { redis } from '../db/redis.js'

interface RateLimitOptions {
  windowMs: number      // Time window in milliseconds
  maxRequests: number   // Max requests per window
  keyPrefix: string     // Redis key prefix
  keyGenerator?: (c: Context) => string  // Custom key generator
  message?: string      // Error message
}

const defaultOptions: RateLimitOptions = {
  windowMs: 60 * 1000,  // 1 minute
  maxRequests: 10,
  keyPrefix: 'ratelimit',
  message: 'Too many requests, please try again later',
}

/**
 * Create a rate limiting middleware
 */
export function rateLimit(options: Partial<RateLimitOptions> = {}) {
  const config = { ...defaultOptions, ...options }

  return async (c: Context, next: Next) => {
    // Get user ID from auth middleware (if authenticated)
    const userId = c.get('userId') as string | undefined

    // Generate rate limit key
    const key = config.keyGenerator
      ? config.keyGenerator(c)
      : `${config.keyPrefix}:${userId || c.req.header('x-forwarded-for') || 'anonymous'}`

    try {
      // Increment counter
      const count = await redis.incr(key)

      // Set expiry on first request
      if (count === 1) {
        await redis.expire(key, Math.ceil(config.windowMs / 1000))
      }

      // Get TTL for headers
      const ttl = await redis.ttl(key)

      // Set rate limit headers
      c.header('X-RateLimit-Limit', config.maxRequests.toString())
      c.header('X-RateLimit-Remaining', Math.max(0, config.maxRequests - count).toString())
      c.header('X-RateLimit-Reset', (Date.now() + ttl * 1000).toString())

      // Check if over limit
      if (count > config.maxRequests) {
        c.header('Retry-After', ttl.toString())
        return c.json({ error: config.message }, 429)
      }

      await next()
    } catch (error) {
      // If Redis fails, allow the request (fail open)
      console.error('Rate limit error:', error)
      await next()
    }
  }
}

/**
 * AI-specific rate limiter
 * More restrictive: 20 requests per day per user
 */
export const aiRateLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,  // 24 hours
  maxRequests: 20,
  keyPrefix: 'ai_ratelimit',
  message: 'AI generation limit reached. Please try again tomorrow.',
})

/**
 * Stricter rate limit for expensive operations (audio processing)
 * 10 audio requests per day
 */
export const aiAudioRateLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,  // 24 hours
  maxRequests: 10,
  keyPrefix: 'ai_audio_ratelimit',
  message: 'Voice processing limit reached. Please try again tomorrow.',
})
