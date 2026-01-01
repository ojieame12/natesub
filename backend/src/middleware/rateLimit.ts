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

/**
 * Normalize an IP address by stripping port numbers
 */
function normalizeIp(ip: string): string | null {
  const trimmed = ip.trim()
  if (!trimmed) return null

  // Strip :port for IPv4 (keep IPv6 which uses colons differently)
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(trimmed)) {
    return trimmed.replace(/:\d+$/, '')
  }

  return trimmed
}

function getClientIp(c: Context): string | null {
  // SECURITY: Prioritize trusted proxy headers that cannot be spoofed by clients
  // These are set by the reverse proxy (Cloudflare, Railway) and overwrite any client-provided values

  // 1. Cloudflare's real IP header (most trusted when using Cloudflare)
  const cfIp = c.req.header('cf-connecting-ip')
  if (cfIp) return normalizeIp(cfIp)

  // 2. Railway/other proxy headers (trusted, set by infrastructure)
  const trustedHeaders = [
    c.req.header('true-client-ip'),
    c.req.header('fly-client-ip'),
    c.req.header('x-real-ip'),
  ].filter(Boolean) as string[]

  for (const ip of trustedHeaders) {
    const normalized = normalizeIp(ip)
    if (normalized) return normalized
  }

  // 3. x-forwarded-for: Take the RIGHTMOST IP (added by trusted proxy)
  // Format: "client, proxy1, proxy2" - rightmost is from our trusted proxy
  // SECURITY: DO NOT use leftmost IP as it's client-provided and spoofable
  const xff = c.req.header('x-forwarded-for')
  if (xff) {
    const ips = xff.split(',').map(ip => ip.trim()).filter(Boolean)
    // Take last IP (added by our trusted proxy)
    const lastIp = ips[ips.length - 1]
    if (lastIp) return normalizeIp(lastIp)
  }

  // 4. RFC 7239 Forwarded header (fallback)
  const forwarded = c.req.header('forwarded')
  if (forwarded) {
    const match = forwarded.match(/for=(?:"?)([^;,"]+)/i)
    if (match?.[1]) {
      let value = match[1].trim()
      value = value.replace(/^"|"$/g, '')  // Remove quotes
      value = value.replace(/^\[|\]$/g, '') // Remove IPv6 brackets
      return normalizeIp(value)
    }
  }

  return null
}

export function getClientIdentifier(c: Context): string {
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
    // Skip rate limiting in test environment unless explicitly enabled
    if (process.env.NODE_ENV === 'test' && process.env.RATE_LIMIT_IN_TESTS !== 'true') {
      await next()
      return
    }

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
      // If Redis fails, log and fail closed by default (security-first)
      console.error('[rateLimit] Redis error, failing closed:', error)

      // SECURITY: Default to fail-closed to prevent abuse when Redis is down
      // Public read-only endpoints can fail open to maintain availability
      const failOpenOverride = process.env.REDIS_FAIL_OPEN === 'true'

      // Security-critical endpoints ALWAYS fail closed regardless of override
      const criticalPrefixes = ['auth_verify', 'auth_magic', 'payment', 'checkout', 'admin_sensitive', 'webhook']
      const isCritical = criticalPrefixes.some(p => config.keyPrefix.startsWith(p))

      if (isCritical) {
        // Critical endpoints never fail open
        return c.json({
          error: 'Service temporarily unavailable. Please try again in a moment.',
        }, 503)
      }

      // Public read-only endpoints fail open by default to maintain availability
      // These are low-risk since they don't mutate data or access sensitive info
      const failOpenByDefaultPrefixes = ['public_ratelimit', 'public_strict_ratelimit']
      const canFailOpen = failOpenByDefaultPrefixes.some(p => config.keyPrefix.startsWith(p))

      if (canFailOpen || failOpenOverride) {
        // Public endpoints fail open to prevent 503 errors during Redis outages
        console.warn(`[rateLimit] Redis unavailable, failing OPEN for ${config.keyPrefix}`)
        await next()
        return
      }

      // Default: fail closed for all other endpoints when Redis is down
      // This protects against abuse during Redis outages
      return c.json({
        error: 'Service temporarily unavailable. Please try again in a moment.',
      }, 503)
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
 * 1000 requests per hour per IP to prevent abuse while allowing production scale
 *
 * Rationale for 1000/hour:
 * - Stripe/Paystack IPs can send bursts during retries or billing cycles
 * - 100 active subscribers × 3-4 webhooks each = 300-400 webhooks per billing run
 * - Signature verification is the primary security; rate limit is secondary
 * - 1000/hour is ~17/minute average, generous but not abusable
 */
export const webhookRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 1000,
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
 * Prevents checkout spam while allowing shared IP/NAT scenarios
 * 50 requests per hour per IP
 */
export const checkoutRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 50,
  keyPrefix: 'checkout_ratelimit',
  keyGenerator: (c) => {
    return `checkout_ratelimit:${getClientIdentifier(c)}`
  },
  message: 'Too many checkout requests. Please try again later.',
})

/**
 * Public endpoint rate limiter - IP-based
 * Prevents enumeration and DoS on public endpoints
 * 500 requests per hour per IP (increased from 100 to avoid undercounting viral pages)
 */
export const publicRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 500,
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
  keyGenerator: (c) => {
    // Use adminUserId (set by adminAuth) instead of userId
    const adminUserId = c.get('adminUserId') as string | undefined
    return `admin_sensitive_ratelimit:${adminUserId || getClientIdentifier(c)}`
  },
  message: 'Too many admin operations. Please slow down.',
})

/**
 * Admin read operations rate limiter - Admin user-based
 * Prevents data enumeration and excessive API usage
 * 100 requests per minute per admin
 */
export const adminReadRateLimit = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  maxRequests: 100,
  keyPrefix: 'admin_read_ratelimit',
  keyGenerator: (c) => {
    const adminUserId = c.get('adminUserId') as string | undefined
    return `admin_read_ratelimit:${adminUserId || getClientIdentifier(c)}`
  },
  message: 'Too many requests. Please slow down.',
})

/**
 * Admin export rate limiter - Admin user-based
 * Prevents excessive data exports
 * 10 exports per hour per admin
 */
export const adminExportRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 10,
  keyPrefix: 'admin_export_ratelimit',
  keyGenerator: (c) => {
    const adminUserId = c.get('adminUserId') as string | undefined
    return `admin_export_ratelimit:${adminUserId || getClientIdentifier(c)}`
  },
  message: 'Too many export requests. Please wait before exporting more data.',
})

/**
 * Support ticket rate limiter - IP-based
 * Prevents ticket spam from unauthenticated users
 * 5 tickets per hour per IP
 */
export const supportTicketRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 5,
  keyPrefix: 'support_ticket_ratelimit',
  keyGenerator: (c) => {
    return `support_ticket_ratelimit:${getClientIdentifier(c)}`
  },
  message: 'Too many support tickets. Please wait before submitting another.',
})

/**
 * Analytics write rate limiter - IP-based
 * Prevents spam of page view and conversion tracking
 * 60 requests per hour per IP (stricter than general public)
 */
export const analyticsRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 60,
  keyPrefix: 'analytics_ratelimit',
  keyGenerator: (c) => {
    return `analytics_ratelimit:${getClientIdentifier(c)}`
  },
  message: 'Too many requests. Please try again later.',
})
