/**
 * Rate Limiting Middleware
 *
 * Uses Redis for distributed rate limiting.
 * Supports per-user limits with configurable windows.
 */

import type { Context, Next } from 'hono'
import { createHash } from 'crypto'
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

function getClientIp(c: Context): string | null {
  const candidates = [
    c.req.header('cf-connecting-ip'),
    c.req.header('true-client-ip'),
    c.req.header('fly-client-ip'),
    c.req.header('x-real-ip'),
    c.req.header('x-forwarded-for'),
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    const raw = candidate.trim()
    if (!raw) continue

    // x-forwarded-for may contain multiple IPs.
    const first = raw.split(',')[0]?.trim()
    if (!first) continue

    // Strip :port for IPv4 (keep IPv6 which uses colons).
    if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(first)) {
      return first.replace(/:\d+$/, '')
    }

    return first
  }

  const forwarded = c.req.header('forwarded')
  if (forwarded) {
    // RFC 7239: Forwarded: for=192.0.2.60;proto=http;by=203.0.113.43
    const match = forwarded.match(/for=(?:"?)([^;,"]+)/i)
    if (match?.[1]) {
      let value = match[1].trim()
      value = value.replace(/^"|"$/g, '')
      value = value.replace(/^\[|\]$/g, '')
      if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) {
        value = value.replace(/:\d+$/, '')
      }
      if (value) return value
    }
  }

  return null
}

function getClientIdentifier(c: Context): string {
  const ip = getClientIp(c)
  if (ip) return ip

  // Last-resort fallback to avoid global collisions when proxies omit IP headers.
  const ua = c.req.header('user-agent') || ''
  const lang = c.req.header('accept-language') || ''
  const fingerprint = createHash('sha256').update(`${ua}|${lang}`).digest('hex').slice(0, 16)
  return `unknown:${fingerprint}`
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
      : `${config.keyPrefix}:${userId || getClientIdentifier(c)}`

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
      // If Redis fails, log and decide whether to fail open or closed
      console.error('Rate limit error:', error)

      // In pre-production, allow failing open to prevent total outage
      // Set REDIS_FAIL_OPEN=true in Railway when Redis quota is exceeded
      const failOpen = process.env.REDIS_FAIL_OPEN === 'true'

      if (failOpen) {
        console.warn(`[rateLimit] Redis unavailable, failing OPEN for ${config.keyPrefix}`)
        await next()
        return
      }

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
    return `webhook_ratelimit:${getClientIdentifier(c)}`
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
    return `auth_magic_ratelimit:${getClientIdentifier(c)}`
  },
  message: 'Too many login attempts. Please wait 10 minutes before trying again.',
})

/**
 * Auth verify rate limiter - IP-based
 * Prevents brute force OTP guessing
 * 15 attempts per 15 minutes per IP (enough for retries during network issues)
 */
export const authVerifyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 15,
  keyPrefix: 'auth_verify_ratelimit',
  keyGenerator: (c) => {
    return `auth_verify_ratelimit:${getClientIdentifier(c)}`
  },
  message: 'Too many verification attempts. Please wait a few minutes before trying again.',
})

/**
 * Payment endpoint rate limiter - User-based
 * Prevents abuse of payment provider APIs
 * 10 requests per hour per user
 */
export const paymentRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 50,  // Increased for testing (was 10)
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
    return `checkout_ratelimit:${getClientIdentifier(c)}`
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
    return `public_ratelimit:${getClientIdentifier(c)}`
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
    return `public_strict_ratelimit:${getClientIdentifier(c)}`
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

/**
 * Admin sensitive operations rate limiter - Admin user-based
 * Protects financial and destructive admin operations
 * 10 requests per minute per admin
 */
export const adminSensitiveRateLimit = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  maxRequests: 10,
  keyPrefix: 'admin_sensitive_ratelimit',
  message: 'Too many admin operations. Please slow down.',
})
