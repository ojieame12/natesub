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
      // If Redis fails, log and fail CLOSED for security-critical endpoints
      // This prevents abuse during Redis outages
      console.error('Rate limit error:', error)

      // Check if this is a security-critical endpoint that should fail closed
      const criticalPrefixes = ['auth_verify', 'auth_magic', 'payment', 'checkout']
      const isCritical = criticalPrefixes.some(p => config.keyPrefix.startsWith(p))

      if (isCritical) {
        return c.json({
          error: 'Service temporarily unavailable. Please try again in a moment.',
        }, 503)
      }

      // Non-critical endpoints fail open (allow request)
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

/**
 * Webhook rate limiter - IP-based
 * 100 requests per hour per IP to prevent abuse
 * Stripe/Paystack webhooks should never hit this limit under normal use
 */
export const webhookRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 100,
  keyPrefix: 'webhook_ratelimit',
  keyGenerator: (c) => {
    // Use IP address for webhook rate limiting (not user ID)
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || c.req.header('x-real-ip')
      || 'unknown'
    return `webhook_ratelimit:${ip}`
  },
  message: 'Too many webhook requests. Please contact support if this persists.',
})

/**
 * Magic link request rate limiter - IP + email based
 * Prevents email enumeration and spam
 * 5 requests per 10 minutes per IP
 */
export const authMagicLinkRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,  // 10 minutes
  maxRequests: 5,
  keyPrefix: 'auth_magic_ratelimit',
  keyGenerator: (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || c.req.header('x-real-ip')
      || 'unknown'
    return `auth_magic_ratelimit:${ip}`
  },
  message: 'Too many login attempts. Please wait 10 minutes before trying again.',
})

/**
 * Auth verify rate limiter - IP-based
 * Prevents brute force OTP guessing
 * 5 attempts per 15 minutes per IP
 */
export const authVerifyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 5,
  keyPrefix: 'auth_verify_ratelimit',
  keyGenerator: (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || c.req.header('x-real-ip')
      || 'unknown'
    return `auth_verify_ratelimit:${ip}`
  },
  message: 'Too many verification attempts. Please wait 15 minutes before trying again.',
})

/**
 * Payment endpoint rate limiter - User-based
 * Prevents abuse of payment provider APIs
 * 10 requests per hour per user
 */
export const paymentRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 10,
  keyPrefix: 'payment_ratelimit',
  message: 'Too many payment requests. Please try again later.',
})

/**
 * Checkout rate limiter - IP-based
 * Prevents checkout spam
 * 20 requests per hour per IP
 */
export const checkoutRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 20,
  keyPrefix: 'checkout_ratelimit',
  keyGenerator: (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || c.req.header('x-real-ip')
      || 'unknown'
    return `checkout_ratelimit:${ip}`
  },
  message: 'Too many checkout requests. Please try again later.',
})

/**
 * Public endpoint rate limiter - IP-based
 * Prevents enumeration and DoS on public endpoints
 * 100 requests per hour per IP
 */
export const publicRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 100,
  keyPrefix: 'public_ratelimit',
  keyGenerator: (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || c.req.header('x-real-ip')
      || 'unknown'
    return `public_ratelimit:${ip}`
  },
  message: 'Too many requests. Please try again later.',
})

/**
 * Stricter public rate limiter - IP-based
 * For sensitive public endpoints like username check
 * 30 requests per hour per IP
 */
export const publicStrictRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 30,
  keyPrefix: 'public_strict_ratelimit',
  keyGenerator: (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || c.req.header('x-real-ip')
      || 'unknown'
    return `public_strict_ratelimit:${ip}`
  },
  message: 'Too many requests. Please try again later.',
})

/**
 * Update send rate limiter - User-based
 * Prevents creators from spamming subscribers
 * 5 updates per day per creator
 */
export const updateSendRateLimit = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,  // 24 hours
  maxRequests: 5,
  keyPrefix: 'update_send_ratelimit',
  message: 'You can only send 5 updates per day. Please try again tomorrow.',
})

/**
 * Media upload rate limiter - User-based
 * Prevents upload spam/abuse
 * 30 uploads per hour per user
 */
export const mediaUploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 30,
  keyPrefix: 'media_upload_ratelimit',
  message: 'Too many uploads. Please try again later.',
})
