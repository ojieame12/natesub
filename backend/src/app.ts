import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { secureHeaders } from 'hono/secure-headers'
import { HTTPException } from 'hono/http-exception'
import { ZodError } from 'zod'
import { env } from './config/env.js'
import { requestIdMiddleware } from './middleware/requestId.js'
import { db } from './db/client.js'
import { redis } from './db/redis.js'

// Routes
import auth from './routes/auth.js'
import profile from './routes/profile.js'
import users from './routes/users.js'
import stripeRoutes from './routes/stripe.js'
import paystackRoutes from './routes/paystack.js'
import checkout from './routes/checkout.js'
import webhooks from './routes/webhooks/index.js'
import media from './routes/media.js'
import subscriptions from './routes/subscriptions.js'
import mySubscriptions from './routes/my-subscriptions.js'
import subscriptionManage from './routes/subscription-manage.js'
import activity from './routes/activity.js'
import requests from './routes/requests.js'
import updates from './routes/updates.js'
import ai from './routes/ai.js'
import jobs from './routes/jobs.js'
import payroll from './routes/payroll.js'
import billing from './routes/billing.js'
import analytics from './routes/analytics.js'
import admin from './routes/admin/index.js'
import support from './routes/support.js'
import config from './routes/config.js'
import subscriber from './routes/subscriber.js'

const app = new Hono()

// Log Stripe API version on startup (ensure this matches your Stripe dashboard settings)
if (process.env.NODE_ENV !== 'test') {
  console.log('[stripe] API version: 2025-11-17.clover')
}

// Global middleware
app.use('*', requestIdMiddleware)
app.use('*', logger())
app.use('*', secureHeaders({
  // Content Security Policy
  contentSecurityPolicy: env.NODE_ENV === 'production' ? {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'", 'https://api.stripe.com', 'https://api.paystack.co'],
    frameSrc: ["'self'", 'https://js.stripe.com', 'https://checkout.paystack.com'],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
  } : undefined,
  // Additional security headers
  xContentTypeOptions: 'nosniff',
  xFrameOptions: 'DENY',
  xXssProtection: '1; mode=block',
}))

// CORS - allow multiple origins for web and mobile
// Production: Only allow production domains + Capacitor (mobile apps)
// Dev/Test: Also allow localhost for development
const allowedOrigins = [
  env.APP_URL,
  env.PUBLIC_PAGE_URL,          // Public subscribe pages (natepay.co)
  'https://natepay.co',         // Production vanity domain
  'https://www.natepay.co',     // Production www subdomain
  'capacitor://localhost',      // iOS Capacitor (always allowed - mobile app)
  'http://localhost',           // Android Capacitor (always allowed - mobile app)
  // Dev-only origins (localhost with ports) - excluded in production
  ...(env.NODE_ENV !== 'production' ? [
    'http://localhost:5173',    // Local dev
    'http://localhost:5174',    // Local dev alt port
  ] : []),
]

// Normalize origin - handles non-http protocols like capacitor://
function normalizeOrigin(o: string): string | null {
  if (!o) return null
  const trimmed = o.trim()
  // For capacitor:// and other non-http schemes, URL.origin returns 'null'
  // So we handle them specially
  if (trimmed.startsWith('capacitor://')) return trimmed
  try {
    const origin = new URL(trimmed).origin
    return origin !== 'null' ? origin : trimmed
  } catch {
    return null
  }
}

const allowedOriginSet = new Set(
  allowedOrigins
    .map(normalizeOrigin)
    .filter((o): o is string => Boolean(o))
)

function resolveAllowedOrigin(origin: string): string | null {
  // `hono/cors` passes an empty string when Origin is missing.
  if (!origin) return null

  const normalized = normalizeOrigin(origin)
  if (!normalized) return null

  // Exact origin allowlist.
  if (allowedOriginSet.has(normalized)) return normalized

  // Allow any localhost port when `http://localhost` is allowlisted.
  // This supports Capacitor/Android and local dev without unsafe prefix matching.
  try {
    const url = new URL(origin)
    if (url.protocol === 'http:' && url.hostname === 'localhost' && allowedOriginSet.has('http://localhost')) {
      return normalized
    }
  } catch {
    // Not a valid URL, skip localhost check
  }

  return null
}

app.use('*', cors({
  origin: (origin) => resolveAllowedOrigin(origin),
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Health check - deep check for production readiness
app.get('/health', async (c) => {
  const checks = {
    database: false,
    redis: false,
  }

  // Check database (with timeout)
  try {
    await Promise.race([
      db.$queryRaw`SELECT 1`,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
    ])
    checks.database = true
  } catch (err) {
    console.error('[health] Database check failed:', err)
  }

  // Check Redis (optional)
  try {
    const pong = await redis.ping()
    checks.redis = pong === 'PONG'
  } catch (err) {
    console.error('[health] Redis check failed:', err)
  }

  // Only fail if DATABASE is down. Redis is optional/cache.
  const isHealthy = checks.database
  const status = isHealthy ? (checks.redis ? 'ok' : 'degraded') : 'down'

  return c.json({
    status,
    timestamp: new Date().toISOString(),
    checks,
  }, isHealthy ? 200 : 503)
})

// Lightweight liveness probe (for k8s)
app.get('/health/live', (c) => c.json({ status: 'ok' }))

// Geo detection endpoint - uses CDN headers with ipapi.co fallback
// This moves the external API call server-side for better reliability
app.get('/geo', async (c) => {
  // 1. Try CDN headers first (instant, no external call)
  const cfCountry = c.req.header('CF-IPCountry')
  const vercelCountry = c.req.header('x-vercel-ip-country')
  const railwayCountry = c.req.header('x-railway-country') // Future-proofing

  const cdnCountry = cfCountry || vercelCountry || railwayCountry
  if (cdnCountry && /^[A-Z]{2}$/.test(cdnCountry)) {
    return c.json({ country: cdnCountry, source: 'cdn' })
  }

  // 2. Get client IP - don't cache if unknown
  const clientIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || c.req.header('x-real-ip')

  // Don't cache unknown IPs - can't reliably determine geo
  if (!clientIp) {
    return c.json({ country: null, source: 'unknown', fallback: 'US' })
  }

  // 3. Check Redis cache for this IP
  const cacheKey = `geo:${clientIp}`
  try {
    const cached = await redis.get(cacheKey)
    if (cached && /^[A-Z]{2}$/.test(cached)) {
      return c.json({ country: cached, source: 'cache' })
    }
  } catch {
    // Redis unavailable, continue to fallback
  }

  // 4. Fallback to ipapi.co (server-side, with shorter timeout)
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000) // 2s timeout

    const response = await fetch('https://ipapi.co/country/', {
      signal: controller.signal,
      headers: {
        'User-Agent': 'NatePay/1.0', // Be a good API citizen
      },
    })
    clearTimeout(timeoutId)

    if (response.ok) {
      const text = await response.text()
      const country = text.trim().toUpperCase()

      if (/^[A-Z]{2}$/.test(country)) {
        // Cache successful lookups for 24 hours
        try {
          await redis.set(cacheKey, country, 'EX', 86400)
        } catch {
          // Cache write failed, continue
        }
        return c.json({ country, source: 'ipapi' })
      }
    }
  } catch {
    // ipapi.co failed or timed out - don't cache, let next request retry
  }

  // 5. Return unknown with US fallback (but don't cache failure)
  // Frontend can decide how to handle country: null
  return c.json({ country: null, source: 'lookup_failed', fallback: 'US' })
})

// Metrics endpoint for monitoring dashboards
app.get('/metrics', async (c) => {
  // Only allow in non-production or with valid API key
  const apiKey = c.req.header('X-API-Key')
  // Require JOBS_API_KEY to be set in production, and header must match
  if (env.NODE_ENV === 'production' && (!env.JOBS_API_KEY || apiKey !== env.JOBS_API_KEY)) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  try {
    const now = new Date()
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)

    // Get key metrics in parallel
    const [
      activeSubscriptions,
      subscriptionsToday,
      paymentsToday,
      revenueToday,
      webhookStats,
      activeCreators,
    ] = await Promise.all([
      // Active subscriptions count
      db.subscription.count({ where: { status: 'active' } }),
      // New subscriptions in last 24h
      db.subscription.count({ where: { createdAt: { gte: oneDayAgo } } }),
      // Successful payments in last 24h
      db.payment.count({
        where: { createdAt: { gte: oneDayAgo }, status: 'succeeded', type: { in: ['one_time', 'recurring'] } },
      }),
      // Revenue in last 24h (sum of netCents)
      db.payment.aggregate({
        where: { createdAt: { gte: oneDayAgo }, status: 'succeeded', type: { in: ['one_time', 'recurring'] } },
        _sum: { netCents: true },
      }),
      // Webhook processing stats (last hour)
      db.webhookEvent.groupBy({
        by: ['status'],
        where: { createdAt: { gte: oneHourAgo } },
        _count: true,
      }),
      // Creators with active payout status
      db.profile.count({ where: { payoutStatus: 'active' } }),
    ])

    // Format webhook stats
    const webhooks = webhookStats.reduce((acc, s) => {
      acc[s.status] = s._count
      return acc
    }, {} as Record<string, number>)

    return c.json({
      timestamp: now.toISOString(),
      subscriptions: {
        active: activeSubscriptions,
        newLast24h: subscriptionsToday,
      },
      payments: {
        successfulLast24h: paymentsToday,
        revenueLast24hCents: revenueToday._sum.netCents || 0,
      },
      webhooks: {
        lastHour: webhooks,
      },
      creators: {
        payoutsActive: activeCreators,
      },
    })
  } catch (err) {
    console.error('[metrics] Error fetching metrics:', err)
    return c.json({ error: 'Failed to fetch metrics' }, 500)
  }
})

// API routes
app.route('/config', config)  // Public config (fee constants, etc.)
app.route('/auth', auth)
app.route('/profile', profile)
app.route('/users', users)
app.route('/stripe', stripeRoutes)
app.route('/paystack', paystackRoutes)
app.route('/checkout', checkout)
app.route('/webhooks', webhooks)
app.route('/media', media)
app.route('/subscriptions', subscriptions)
app.route('/my-subscriptions', mySubscriptions)
app.route('/subscription/manage', subscriptionManage)
app.route('/activity', activity)
app.route('/requests', requests)
app.route('/updates', updates)
app.route('/ai', ai)
app.route('/jobs', jobs)
app.route('/payroll', payroll)
app.route('/billing', billing)
app.route('/analytics', analytics)
app.route('/admin', admin)
app.route('/support', support)
app.route('/subscriber', subscriber)  // Public subscriber portal

// 404 handler
app.notFound((c) => c.json({ error: 'Not found' }, 404))

// Error handler
app.onError((err, c) => {
  // Handle HTTPException (from middleware like admin auth)
  if (err instanceof HTTPException) {
    return c.json({ error: err.message, message: err.message }, err.status)
  }
  // Handle Zod validation errors (bad query/body params)
  if (err instanceof ZodError) {
    return c.json({ error: 'Invalid request', issues: err.issues }, 400)
  }
  console.error('Unhandled error:', err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
