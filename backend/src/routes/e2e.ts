/**
 * E2E Testing Endpoints
 *
 * SECURITY: These endpoints are ONLY available when ALL conditions are met:
 * - NODE_ENV !== 'production'
 * - E2E_MODE === 'true'
 * - x-e2e-api-key header matches E2E_API_KEY env var
 *
 * They provide seed and query helpers for deterministic E2E testing.
 *
 * IMPORTANT: These endpoints can create/modify data. Triple-guarded to never run in production.
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { env } from '../config/env.js'
import { db } from '../db/client.js'
import {
  generateManageToken,
  generateCancelToken,
  generatePortalToken,
  generateExpressDashboardToken,
} from '../utils/cancelToken.js'

const e2e = new Hono()

// Triple guard: Only available in non-production with E2E_MODE + API key
const requireE2EMode = async (c: any, next: () => Promise<void>) => {
  // Guard 1: Never in production
  if (env.NODE_ENV === 'production') {
    console.error('[SECURITY] E2E endpoint called in production!')
    return c.json({ error: 'Not available' }, 404)
  }

  // Guard 2: E2E_MODE must be explicitly enabled
  if (env.E2E_MODE !== 'true') {
    return c.json({ error: 'E2E mode not enabled' }, 404)
  }

  // Guard 3: API key is REQUIRED when E2E_MODE is enabled
  // This prevents accidental exposure if E2E_MODE is enabled without key
  const apiKey = c.req.header('x-e2e-api-key')
  const expectedKey = env.E2E_API_KEY
  if (!expectedKey) {
    console.error('[SECURITY] E2E_MODE enabled but E2E_API_KEY not set!')
    return c.json({ error: 'E2E API key not configured' }, 500)
  }
  if (apiKey !== expectedKey) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
}

e2e.use('*', requireE2EMode)

// E2E test data markers for safe cleanup
// All E2E data uses one of these prefixes
const E2E_PREFIX = 'e2e-test-'
const E2E_RUN_PREFIX = 'e2e-run-'

// Generate a unique run ID for test isolation
// Format: e2e-run-{timestamp}-{random}
function generateE2ERunId(): string {
  return `${E2E_RUN_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// Get the marker prefix for a run (uses runId if provided, otherwise E2E_PREFIX)
function getMarkerPrefix(runId?: string): string {
  return runId || E2E_PREFIX
}

// Check if a string has an E2E marker (accepts both e2e-test- and e2e-run- prefixes)
function hasE2EMarker(value: string | null | undefined): boolean {
  return !!value && (value.startsWith(E2E_PREFIX) || value.startsWith(E2E_RUN_PREFIX))
}

// ============================================
// SEED ENDPOINTS
// ============================================

/**
 * Seed a reminder directly
 *
 * POST /e2e/seed-reminder
 *
 * NOTE: e2eRunId is for logging/correlation. Cleanup uses subscription entityId
 * to find and delete related reminders when run-scoped cleanup is requested.
 */
e2e.post(
  '/seed-reminder',
  zValidator('json', z.object({
    userId: z.string(), // Who to remind
    entityType: z.enum(['subscription', 'request', 'profile', 'payroll', 'payment']),
    entityId: z.string(),
    type: z.enum([
      // Request/Invoice reminders
      'request_unopened_24h',
      'request_unopened_72h',
      'request_unpaid_3d',
      'request_expiring',
      'invoice_due_7d',
      'invoice_due_3d',
      'invoice_due_1d',
      'invoice_overdue_1d',
      'invoice_overdue_7d',
      // Payout notifications
      'payout_completed',
      'payout_failed',
      // Payroll
      'payroll_ready',
      // Onboarding
      'onboarding_incomplete_24h',
      'onboarding_incomplete_72h',
      'bank_setup_incomplete',
      // Engagement
      'no_subscribers_7d',
      // Subscription renewal
      'subscription_renewal_7d',
      'subscription_renewal_3d',
      'subscription_renewal_1d',
    ]),
    channel: z.enum(['email', 'sms']).default('email'),
    scheduledFor: z.string().datetime(), // ISO date
    status: z.enum(['scheduled', 'sent', 'failed', 'canceled']).default('scheduled'),
    e2eRunId: z.string().optional(), // Optional run ID for scoped cleanup
  })),
  async (c) => {
    const data = c.req.valid('json')
    const runId = data.e2eRunId || generateE2ERunId()

    console.log(`[e2e] Seeding reminder: type=${data.type}, entityId=${data.entityId}, runId=${runId}`)

    const reminder = await db.reminder.create({
      data: {
        userId: data.userId,
        entityType: data.entityType,
        entityId: data.entityId,
        type: data.type,
        channel: data.channel,
        scheduledFor: new Date(data.scheduledFor),
        status: data.status,
      },
    })

    return c.json({
      success: true,
      reminderId: reminder.id,
      e2eRunId: runId, // Return for scoped cleanup
    })
  }
)

/**
 * Seed pageviews (for cleanup test)
 *
 * POST /e2e/seed-pageviews
 */
e2e.post(
  '/seed-pageviews',
  zValidator('json', z.object({
    creatorUsername: z.string(),
    count: z.number().int().positive().max(1000),
    createdAt: z.string().datetime(), // When the pageviews were created
    e2eRunId: z.string().optional(), // Optional run ID for scoped cleanup
  })),
  async (c) => {
    const data = c.req.valid('json')
    const runId = data.e2eRunId || generateE2ERunId()
    const marker = getMarkerPrefix(runId)

    console.log(`[e2e] Seeding ${data.count} pageviews for ${data.creatorUsername}, runId=${runId}`)

    // Find creator profile
    const profile = await db.profile.findUnique({
      where: { username: data.creatorUsername },
    })

    if (!profile) {
      return c.json({ error: 'Creator not found' }, 404)
    }

    const createdAt = new Date(data.createdAt)

    // Create pageviews in batch with specified createdAt and run marker
    // This allows testing cleanup jobs that delete old pageviews (>90 days)
    const pageviews = await db.pageView.createMany({
      data: Array.from({ length: data.count }, () => ({
        profileId: profile.id,
        country: 'US',
        referrer: `${marker}referrer`,
        createdAt, // Use the provided timestamp for deterministic tests
      })),
    })

    return c.json({
      success: true,
      count: pageviews.count,
      e2eRunId: runId, // Return for scoped cleanup
    })
  }
)

/**
 * Seed a request (one-time payment/invoice request)
 *
 * POST /e2e/seed-request
 */
e2e.post(
  '/seed-request',
  zValidator('json', z.object({
    creatorUsername: z.string(),
    recipientName: z.string().default('E2E Test Recipient'),
    recipientEmail: z.string().email(),
    amountCents: z.number().int().positive(),
    currency: z.string().default('USD'),
    status: z.enum(['draft', 'sent', 'pending_payment', 'accepted', 'declined', 'expired']).default('sent'),
    dueDate: z.string().datetime().optional(),
    expiresAt: z.string().datetime().optional(),
    e2eRunId: z.string().optional(), // Optional run ID for scoped cleanup
  })),
  async (c) => {
    const data = c.req.valid('json')
    const runId = data.e2eRunId || generateE2ERunId()
    const marker = getMarkerPrefix(runId)

    console.log(`[e2e] Seeding request for ${data.creatorUsername}, runId=${runId}`)

    const profile = await db.profile.findUnique({
      where: { username: data.creatorUsername },
    })

    if (!profile) {
      return c.json({ error: 'Creator not found' }, 404)
    }

    const tokenHash = `${marker}${Date.now()}_${Math.random().toString(36).slice(2)}`

    const request = await db.request.create({
      data: {
        creatorId: profile.userId,
        recipientName: data.recipientName,
        recipientEmail: data.recipientEmail.toLowerCase(),
        relationship: 'other',
        amountCents: data.amountCents,
        currency: data.currency,
        status: data.status,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        tokenExpiresAt: data.expiresAt ? new Date(data.expiresAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        publicTokenHash: tokenHash,
      },
    })

    return c.json({
      success: true,
      requestId: request.id,
      tokenHash,
      e2eRunId: runId, // Return for scoped cleanup
    })
  }
)

/**
 * Seed expired sessions (for cleanup test)
 *
 * POST /e2e/seed-expired-sessions
 */
e2e.post(
  '/seed-expired-sessions',
  zValidator('json', z.object({
    userEmail: z.string().email(),
    count: z.number().int().positive().max(100),
    expiredDaysAgo: z.number().int().positive().default(7),
    e2eRunId: z.string().optional(), // Optional run ID for scoped cleanup
  })),
  async (c) => {
    const data = c.req.valid('json')
    const runId = data.e2eRunId || generateE2ERunId()
    const marker = getMarkerPrefix(runId)

    console.log(`[e2e] Seeding ${data.count} expired sessions, runId=${runId}`)

    // Find or create user
    let user = await db.user.findUnique({
      where: { email: data.userEmail.toLowerCase() },
    })
    if (!user) {
      user = await db.user.create({
        data: { email: data.userEmail.toLowerCase() },
      })
    }

    const expiredAt = new Date()
    expiredAt.setDate(expiredAt.getDate() - data.expiredDaysAgo)

    const sessions = await db.session.createMany({
      data: Array.from({ length: data.count }, () => ({
        userId: user!.id,
        token: `${marker}expired_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        expiresAt: expiredAt,
      })),
    })

    return c.json({
      success: true,
      count: sessions.count,
      e2eRunId: runId, // Return for scoped cleanup
    })
  }
)

/**
 * Seed a subscription with specific state (for cron job testing)
 *
 * POST /e2e/seed-subscription
 */
e2e.post(
  '/seed-subscription',
  zValidator('json', z.object({
    creatorUsername: z.string(),
    subscriberEmail: z.string().email(),
    amount: z.number().int().positive().default(500),
    currency: z.string().default('USD'),
    interval: z.enum(['month', 'one_time']).default('month'),
    // Cron job testing fields
    periodEndDaysFromNow: z.number().optional(), // Relative days (negative = past)
    cancelAtPeriodEnd: z.boolean().default(false),
    status: z.enum(['pending', 'active', 'canceled', 'past_due', 'paused']).default('active'),
    // Run isolation
    e2eRunId: z.string().optional(), // Optional run ID for scoped cleanup
  })),
  async (c) => {
    const data = c.req.valid('json')
    const runId = data.e2eRunId || generateE2ERunId()
    const marker = getMarkerPrefix(runId)

    console.log(`[e2e] Seeding subscription: creator=${data.creatorUsername}, subscriber=${data.subscriberEmail}, runId=${runId}`)

    // Find creator profile
    const profile = await db.profile.findUnique({
      where: { username: data.creatorUsername },
      include: { user: true },
    })

    if (!profile) {
      return c.json({ error: 'Creator not found' }, 404)
    }

    // Find or create subscriber
    let subscriber = await db.user.findUnique({
      where: { email: data.subscriberEmail.toLowerCase() },
    })
    if (!subscriber) {
      subscriber = await db.user.create({
        data: { email: data.subscriberEmail.toLowerCase() },
      })
    }

    // Calculate currentPeriodEnd if specified
    let currentPeriodEnd: Date | undefined
    if (data.periodEndDaysFromNow !== undefined) {
      currentPeriodEnd = new Date()
      currentPeriodEnd.setDate(currentPeriodEnd.getDate() + data.periodEndDaysFromNow)
    }

    // Generate manage token nonce with run marker
    const nonce = `${marker}nonce_${Date.now()}_${Math.random().toString(36).slice(2)}`

    const subscription = await db.subscription.create({
      data: {
        creatorId: profile.userId,
        subscriberId: subscriber.id,
        status: data.status,
        amount: data.amount,
        currency: data.currency,
        interval: data.interval,
        cancelAtPeriodEnd: data.cancelAtPeriodEnd,
        currentPeriodEnd,
        stripeSubscriptionId: profile.paymentProvider !== 'paystack' ? `${marker}sub_${Date.now()}` : null,
        paystackAuthorizationCode: profile.paymentProvider === 'paystack' ? `${marker}auth_${Date.now()}` : null,
        manageTokenNonce: nonce,
      },
    })

    // Generate signed manage token for testing manage page
    const manageToken = generateManageToken(subscription.id, nonce)

    // Generate cancel token for unsubscribe flow testing
    const cancelToken = generateCancelToken(subscription.id, nonce)

    return c.json({
      success: true,
      subscriptionId: subscription.id,
      manageToken,
      cancelToken, // For testing unsubscribe flow
      e2eRunId: runId, // Return for scoped cleanup
      manageUrl: `/subscription/manage/${manageToken}`,
      cancelUrl: `/unsubscribe/${cancelToken}`,
    })
  }
)

/**
 * Generate tokens for an existing subscription (for testing token-based flows)
 *
 * POST /e2e/generate-tokens
 */
e2e.post(
  '/generate-tokens',
  zValidator('json', z.object({
    subscriptionId: z.string().uuid(),
  })),
  async (c) => {
    const { subscriptionId } = c.req.valid('json')

    // Find subscription with Stripe customer ID for portal token
    const subscription = await db.subscription.findUnique({
      where: { id: subscriptionId },
      select: {
        id: true,
        manageTokenNonce: true,
        stripeCustomerId: true,
        creator: {
          select: {
            profile: {
              select: { stripeAccountId: true },
            },
          },
        },
      },
    })

    if (!subscription) {
      return c.json({ error: 'Subscription not found' }, 404)
    }

    const nonce = subscription.manageTokenNonce || ''

    // Generate all token types
    const cancelToken = generateCancelToken(subscriptionId, nonce)
    const manageToken = generateManageToken(subscriptionId, nonce)

    // Portal token requires Stripe customer ID
    const portalToken = subscription.stripeCustomerId
      ? generatePortalToken(subscription.stripeCustomerId, subscriptionId)
      : null

    // Express dashboard token requires Stripe account ID
    const expressDashboardToken = subscription.creator?.profile?.stripeAccountId
      ? generateExpressDashboardToken(subscription.creator.profile.stripeAccountId)
      : null

    return c.json({
      subscriptionId,
      cancelToken,
      manageToken,
      portalToken,
      expressDashboardToken,
      urls: {
        cancel: `/unsubscribe/${cancelToken}`,
        manage: `/subscription/manage/${manageToken}`,
        portal: portalToken ? `/manage/${portalToken}` : null,
        expressDashboard: expressDashboardToken ? `/express-dashboard/${expressDashboardToken}` : null,
      },
    })
  }
)

/**
 * Seed a notification log entry (for testing notification dedup)
 *
 * POST /e2e/seed-notification-log
 *
 * NOTE: e2eRunId is for logging/correlation only.
 * Notification logs are cleaned via their subscription's cleanup.
 */
e2e.post(
  '/seed-notification-log',
  zValidator('json', z.object({
    subscriptionId: z.string(),
    type: z.string(), // 'renewal_reminder' | 'payment_failed' | etc.
    e2eRunId: z.string().optional(), // Optional run ID for scoped cleanup
  })),
  async (c) => {
    const data = c.req.valid('json')
    const runId = data.e2eRunId || generateE2ERunId()

    console.log(`[e2e] Seeding notification log: type=${data.type}, subId=${data.subscriptionId}, runId=${runId}`)

    const log = await db.notificationLog.create({
      data: {
        subscriptionId: data.subscriptionId,
        type: data.type,
      },
    })

    return c.json({
      success: true,
      notificationLogId: log.id,
      e2eRunId: runId, // Return for scoped cleanup
    })
  }
)

// ============================================
// QUERY ENDPOINTS (Assert Effects)
// ============================================

/**
 * Get reminders for an entity
 *
 * GET /e2e/reminders?entityId=xxx&entityType=subscription
 */
e2e.get('/reminders', async (c) => {
  const entityId = c.req.query('entityId')
  const entityType = c.req.query('entityType')
  const status = c.req.query('status')
  const userId = c.req.query('userId')

  const where: any = {}
  if (entityId) where.entityId = entityId
  if (entityType) where.entityType = entityType
  if (status) where.status = status
  if (userId) where.userId = userId

  const reminders = await db.reminder.findMany({
    where,
    orderBy: { scheduledFor: 'desc' },
    take: 100,
  })

  return c.json({
    reminders: reminders.map(r => ({
      id: r.id,
      type: r.type,
      channel: r.channel,
      status: r.status,
      entityType: r.entityType,
      entityId: r.entityId,
      scheduledFor: r.scheduledFor.toISOString(),
      sentAt: r.sentAt?.toISOString() || null,
    })),
  })
})

/**
 * Get notification logs for a subscription
 *
 * GET /e2e/notification-logs?subscriptionId=xxx
 */
e2e.get('/notification-logs', async (c) => {
  const subscriptionId = c.req.query('subscriptionId')

  if (!subscriptionId) {
    return c.json({ error: 'subscriptionId required' }, 400)
  }

  const logs = await db.notificationLog.findMany({
    where: { subscriptionId },
    orderBy: { sentAt: 'desc' },
  })

  return c.json({
    notifications: logs.map(l => ({
      id: l.id,
      type: l.type,
      sentAt: l.sentAt.toISOString(),
    })),
  })
})

/**
 * Get subscription by ID
 *
 * GET /e2e/subscription/:id
 */
e2e.get('/subscription/:id', async (c) => {
  const id = c.req.param('id')

  const subscription = await db.subscription.findUnique({
    where: { id },
    include: {
      creator: { select: { email: true } },
      subscriber: { select: { email: true } },
    },
  })

  if (!subscription) {
    return c.json({ error: 'Subscription not found' }, 404)
  }

  return c.json({
    id: subscription.id,
    status: subscription.status,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() || null,
    amount: subscription.amount,
    currency: subscription.currency,
    creatorEmail: subscription.creator.email,
    subscriberEmail: subscription.subscriber.email,
    stripeSubscriptionId: subscription.stripeSubscriptionId,
  })
})

/**
 * Query subscriptions by creator and/or subscriber
 * Used for downstream validation in webhook tests
 *
 * GET /e2e/subscriptions?creatorId=xxx&subscriberId=yyy
 */
e2e.get('/subscriptions', async (c) => {
  const creatorId = c.req.query('creatorId')
  const subscriberId = c.req.query('subscriberId')

  if (!creatorId && !subscriberId) {
    return c.json({ error: 'creatorId or subscriberId required' }, 400)
  }

  const where: any = {}
  if (creatorId) where.creatorId = creatorId
  if (subscriberId) where.subscriberId = subscriberId

  const subscriptions = await db.subscription.findMany({
    where,
    include: {
      creator: { select: { email: true } },
      subscriber: { select: { email: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  return c.json({
    subscriptions: subscriptions.map(sub => ({
      id: sub.id,
      status: sub.status,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() || null,
      amount: sub.amount,
      currency: sub.currency,
      creatorEmail: sub.creator.email,
      subscriberEmail: sub.subscriber.email,
      stripeSubscriptionId: sub.stripeSubscriptionId,
      createdAt: sub.createdAt.toISOString(),
    })),
  })
})

/**
 * Query payments by creator and/or subscriber
 * Used for downstream validation in webhook tests
 *
 * GET /e2e/payments?creatorId=xxx&subscriberId=yyy
 */
e2e.get('/payments', async (c) => {
  const creatorId = c.req.query('creatorId')
  const subscriberId = c.req.query('subscriberId')

  if (!creatorId && !subscriberId) {
    return c.json({ error: 'creatorId or subscriberId required' }, 400)
  }

  const where: any = {}
  if (creatorId) where.creatorId = creatorId
  if (subscriberId) where.subscriberId = subscriberId

  const payments = await db.payment.findMany({
    where,
    orderBy: { occurredAt: 'desc' },
    take: 10,
  })

  return c.json({
    payments: payments.map(p => ({
      id: p.id,
      status: p.status,
      amountCents: p.amountCents,
      feeCents: p.feeCents,
      netCents: p.netCents,
      currency: p.currency,
      type: p.type,
      stripePaymentIntentId: p.stripePaymentIntentId,
      occurredAt: p.occurredAt?.toISOString() || null,
    })),
  })
})

/**
 * Query activities for a user
 * Used for downstream validation in webhook tests
 *
 * GET /e2e/activities?userId=xxx&type=yyy
 */
e2e.get('/activities', async (c) => {
  const userId = c.req.query('userId')
  const type = c.req.query('type')

  if (!userId) {
    return c.json({ error: 'userId required' }, 400)
  }

  const where: any = { userId }
  if (type) where.type = type

  const activities = await db.activity.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  return c.json({
    activities: activities.map(a => ({
      id: a.id,
      type: a.type,
      payload: a.payload,
      createdAt: a.createdAt.toISOString(),
    })),
  })
})

/**
 * Get request by ID
 *
 * GET /e2e/request/:id
 */
e2e.get('/request/:id', async (c) => {
  const id = c.req.param('id')

  const request = await db.request.findUnique({
    where: { id },
  })

  if (!request) {
    return c.json({ error: 'Request not found' }, 404)
  }

  return c.json({
    id: request.id,
    status: request.status,
    amountCents: request.amountCents,
    currency: request.currency,
    recipientEmail: request.recipientEmail,
    dueDate: request.dueDate?.toISOString() || null,
    tokenExpiresAt: request.tokenExpiresAt?.toISOString() || null,
  })
})

/**
 * Get pageview count for a creator
 *
 * GET /e2e/pageview-count?creatorUsername=xxx
 */
e2e.get('/pageview-count', async (c) => {
  const username = c.req.query('creatorUsername')
  const olderThan = c.req.query('olderThan') // ISO date

  if (!username) {
    return c.json({ error: 'creatorUsername required' }, 400)
  }

  const profile = await db.profile.findUnique({
    where: { username },
  })

  if (!profile) {
    return c.json({ error: 'Creator not found' }, 404)
  }

  const where: any = { profileId: profile.id }
  if (olderThan) {
    where.createdAt = { lt: new Date(olderThan) }
  }

  const count = await db.pageView.count({ where })

  return c.json({ count })
})

/**
 * Get session count (for cleanup test)
 *
 * GET /e2e/session-count?userEmail=xxx
 */
e2e.get('/session-count', async (c) => {
  const email = c.req.query('userEmail')
  const expired = c.req.query('expired') === 'true'

  if (!email) {
    return c.json({ error: 'userEmail required' }, 400)
  }

  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
  })

  if (!user) {
    return c.json({ count: 0 })
  }

  const where: any = { userId: user.id }
  if (expired) {
    where.expiresAt = { lt: new Date() }
  }

  const count = await db.session.count({ where })

  return c.json({ count })
})

// ============================================
// PAYMENT & PAYOUT SEED ENDPOINTS
// ============================================

/**
 * Seed a payment for metrics testing
 *
 * POST /e2e/seed-payment
 * {
 *   creatorUsername: string,
 *   subscriberEmail: string,
 *   amountCents: number,        // Creator's base price (e.g., 1000 = $10)
 *   currency: string,
 *   status: 'pending' | 'succeeded' | 'failed' | 'refunded',
 *   e2eRunId?: string
 * }
 *
 * Returns split-model fees:
 * - grossCents: Total subscriber paid (amountCents + 4.5% subscriber fee)
 * - amountCents: Creator's base price
 * - feeCents: Total platform fee (9%)
 * - subscriberFeeCents: Subscriber's portion (4.5%)
 * - creatorFeeCents: Creator's portion (4.5%)
 * - netCents: What creator receives (amountCents - 4.5%)
 */
e2e.post('/seed-payment', async (c) => {
  const body = await c.req.json()
  const { creatorUsername, subscriberEmail, amountCents, currency, status, e2eRunId } = body
  const runId = e2eRunId || generateE2ERunId()
  const marker = getMarkerPrefix(runId)

  if (!creatorUsername || !subscriberEmail || !amountCents) {
    return c.json({ error: 'creatorUsername, subscriberEmail, amountCents required' }, 400)
  }

  // Find creator profile
  const profile = await db.profile.findUnique({
    where: { username: creatorUsername },
    include: { user: true },
  })

  if (!profile) {
    return c.json({ error: 'Creator not found' }, 404)
  }

  // Find or create subscriber
  let subscriber = await db.user.findUnique({
    where: { email: subscriberEmail.toLowerCase() },
  })

  if (!subscriber) {
    subscriber = await db.user.create({
      data: { email: subscriberEmail.toLowerCase() },
    })
  }

  // Use the split fee model (4.5% subscriber + 4.5% creator = 9% total)
  // Import from constants for consistency
  const SPLIT_RATE = 0.045 // 4.5% each side
  const totalFeeRate = SPLIT_RATE * 2 // 9% total

  // Calculate fees using the split model
  const totalFeeCents = Math.round(amountCents * totalFeeRate)
  const subscriberFeeCents = Math.round(amountCents * SPLIT_RATE)
  const creatorFeeCents = totalFeeCents - subscriberFeeCents // Avoid rounding drift

  // Split model amounts:
  // - grossCents: what subscriber pays (amountCents + subscriberFeeCents)
  // - netCents: what creator receives (amountCents - creatorFeeCents)
  const grossCents = amountCents + subscriberFeeCents
  const netCents = amountCents - creatorFeeCents

  // Create payment with proper split fee tracking
  const payment = await db.payment.create({
    data: {
      creatorId: profile.userId,
      subscriberId: subscriber.id,
      grossCents, // Total subscriber paid
      amountCents, // Creator's base price
      feeCents: totalFeeCents, // Total platform fee (9%)
      subscriberFeeCents, // Subscriber's portion (4.5%)
      creatorFeeCents, // Creator's portion (4.5%)
      netCents, // What creator receives
      currency: currency || 'USD',
      status: status || 'succeeded',
      type: 'recurring',
      stripePaymentIntentId: `${marker}pi_${Date.now()}`,
      occurredAt: new Date(),
      feeModel: 'split_v1',
      feeEffectiveRate: SPLIT_RATE,
    },
  })

  console.log(`[e2e] Seeded payment ${payment.id} for ${creatorUsername} (gross=${grossCents}, net=${netCents} ${currency}), runId=${runId}`)

  return c.json({
    paymentId: payment.id,
    grossCents,
    amountCents,
    feeCents: totalFeeCents,
    subscriberFeeCents,
    creatorFeeCents,
    netCents,
    status: payment.status,
    e2eRunId: runId, // Return for scoped cleanup
  })
})

/**
 * Seed a payout record
 *
 * POST /e2e/seed-payout
 * {
 *   creatorUsername: string,
 *   amountCents: number,
 *   currency: string,
 *   status: 'pending' | 'paid' | 'failed',
 *   e2eRunId?: string
 * }
 */
e2e.post('/seed-payout', async (c) => {
  const body = await c.req.json()
  const { creatorUsername, amountCents, currency, status, e2eRunId } = body
  const runId = e2eRunId || generateE2ERunId()
  const marker = getMarkerPrefix(runId)

  if (!creatorUsername || !amountCents) {
    return c.json({ error: 'creatorUsername, amountCents required' }, 400)
  }

  // Find creator profile
  const profile = await db.profile.findUnique({
    where: { username: creatorUsername },
    include: { user: true },
  })

  if (!profile) {
    return c.json({ error: 'Creator not found' }, 404)
  }

  // Create payout as a Payment record with type='payout'
  const payment = await db.payment.create({
    data: {
      creatorId: profile.userId,
      amountCents,
      netCents: amountCents, // Payouts are net (already deducted fees)
      currency: currency || 'USD',
      status: status === 'paid' ? 'succeeded' : status || 'succeeded',
      type: 'payout',
      stripePaymentIntentId: `${marker}po_${Date.now()}`, // Payout ID with marker
      occurredAt: new Date(),
    },
  })

  // Also create activity record
  await db.activity.create({
    data: {
      userId: profile.userId,
      type: status === 'failed' ? 'payout_failed' : 'payout_completed',
      payload: {
        payoutId: payment.stripePaymentIntentId,
        amount: amountCents,
        currency: currency || 'USD',
        arrivalDate: new Date().toISOString(),
      },
    },
  })

  console.log(`[e2e] Seeded payout ${payment.id} for ${creatorUsername} (${amountCents} ${currency}), runId=${runId}`)

  return c.json({
    payoutId: payment.id,
    amountCents,
    status: payment.status,
    e2eRunId: runId, // Return for scoped cleanup
  })
})

/**
 * Seed an activity record
 *
 * POST /e2e/seed-activity
 * {
 *   creatorUsername: string,
 *   type: string,
 *   payload?: object,
 *   e2eRunId?: string
 * }
 *
 * NOTE: e2eRunId is stored in payload.e2eRunId for run-scoped cleanup.
 */
e2e.post('/seed-activity', async (c) => {
  const body = await c.req.json()
  const { creatorUsername, type, payload, e2eRunId } = body
  const runId = e2eRunId || generateE2ERunId()

  if (!creatorUsername || !type) {
    return c.json({ error: 'creatorUsername, type required' }, 400)
  }

  const profile = await db.profile.findUnique({
    where: { username: creatorUsername },
    include: { user: true },
  })

  if (!profile) {
    return c.json({ error: 'Creator not found' }, 404)
  }

  // Store e2eRunId in payload for run-scoped cleanup
  const activityPayload = {
    ...(payload || {}),
    e2eRunId: runId,
  }

  const activity = await db.activity.create({
    data: {
      userId: profile.userId,
      type,
      payload: activityPayload,
    },
  })

  console.log(`[e2e] Seeded activity ${activity.id} type=${type}, runId=${runId}`)

  return c.json({
    activityId: activity.id,
    type: activity.type,
    e2eRunId: runId, // Return for scoped cleanup
  })
})

/**
 * Unlock salary mode for a creator (for testing salary mode enable flow)
 *
 * POST /e2e/unlock-salary-mode
 * {
 *   username: string
 * }
 *
 * This sets paydayAlignmentUnlocked=true on the profile, simulating
 * having 2+ successful payments without actually seeding them.
 */
e2e.post('/unlock-salary-mode', async (c) => {
  const body = await c.req.json()
  const { username } = body

  if (!username) {
    return c.json({ error: 'username required' }, 400)
  }

  const profile = await db.profile.findUnique({
    where: { username },
  })

  if (!profile) {
    return c.json({ error: 'Creator not found' }, 404)
  }

  // Set paydayAlignmentUnlocked=true (schema field name)
  await db.profile.update({
    where: { username },
    data: {
      paydayAlignmentUnlocked: true,
    },
  })

  console.log(`[e2e] Unlocked salary mode for ${username}`)

  return c.json({
    success: true,
    username,
    paydayAlignmentUnlocked: true,
  })
})

/**
 * Seed a platform subscription on a profile for portal testing
 *
 * POST /e2e/seed-platform-subscription
 * {
 *   username: string
 *   status?: 'trialing' | 'active' | 'past_due' | 'canceled' (default: 'active')
 * }
 *
 * This sets platformCustomerId, platformSubscriptionId, and platformSubscriptionStatus
 * so that portal session creation succeeds.
 */
e2e.post('/seed-platform-subscription', async (c) => {
  const body = await c.req.json()
  const { username, status = 'active' } = body

  if (!username) {
    return c.json({ error: 'username required' }, 400)
  }

  const profile = await db.profile.findUnique({
    where: { username },
  })

  if (!profile) {
    return c.json({ error: 'Creator not found' }, 404)
  }

  const ts = Date.now()
  await db.profile.update({
    where: { username },
    data: {
      platformCustomerId: `cus_e2e_${ts}`,
      platformSubscriptionId: `sub_e2e_${ts}`,
      platformSubscriptionStatus: status,
      platformTrialEndsAt: status === 'trialing' ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) : null,
    },
  })

  console.log(`[e2e] Seeded platform subscription for ${username} with status=${status}`)

  return c.json({
    success: true,
    username,
    platformCustomerId: `cus_e2e_${ts}`,
    platformSubscriptionId: `sub_e2e_${ts}`,
    platformSubscriptionStatus: status,
  })
})

/**
 * Seed platform debit on a profile for debit testing
 *
 * POST /e2e/seed-platform-debit
 * {
 *   username: string
 *   amountCents: number
 * }
 *
 * This sets platformDebitCents to simulate accumulated platform debt.
 */
e2e.post('/seed-platform-debit', async (c) => {
  const body = await c.req.json()
  const { username, amountCents } = body

  if (!username) {
    return c.json({ error: 'username required' }, 400)
  }
  if (typeof amountCents !== 'number' || amountCents < 0) {
    return c.json({ error: 'amountCents must be a non-negative number' }, 400)
  }

  const profile = await db.profile.findUnique({
    where: { username },
  })

  if (!profile) {
    return c.json({ error: 'Creator not found' }, 404)
  }

  await db.profile.update({
    where: { username },
    data: {
      platformDebitCents: amountCents,
    },
  })

  console.log(`[e2e] Seeded platform debit for ${username}: ${amountCents} cents`)

  return c.json({
    success: true,
    username,
    platformDebitCents: amountCents,
  })
})

/**
 * Cancel a platform subscription for testing checkout flow
 *
 * POST /e2e/cancel-platform-subscription
 * {
 *   username: string
 * }
 *
 * This sets platformSubscriptionStatus to 'canceled' to allow checkout testing.
 */
e2e.post('/cancel-platform-subscription', async (c) => {
  const body = await c.req.json()
  const { username } = body

  if (!username) {
    return c.json({ error: 'username required' }, 400)
  }

  const profile = await db.profile.findUnique({
    where: { username },
    select: {
      id: true,
      platformSubscriptionId: true,
      platformSubscriptionStatus: true,
    },
  })

  if (!profile) {
    return c.json({ error: 'Creator not found' }, 404)
  }

  if (!profile.platformSubscriptionId) {
    return c.json({ error: 'No platform subscription to cancel' }, 400)
  }

  await db.profile.update({
    where: { username },
    data: {
      platformSubscriptionStatus: 'canceled',
    },
  })

  console.log(`[e2e] Canceled platform subscription for ${username}`)

  return c.json({
    success: true,
    username,
    platformSubscriptionId: profile.platformSubscriptionId,
    platformSubscriptionStatus: 'canceled',
  })
})

/**
 * Seed a page view with a custom timestamp for analytics boundary testing
 *
 * POST /e2e/seed-page-view
 * {
 *   profileId: string
 *   visitorHash?: string
 *   createdAt?: string (ISO date) - defaults to now
 *   minutesAgo?: number - alternative to createdAt, sets createdAt to N minutes ago
 * }
 *
 * This creates a PageView record with a specific timestamp so we can test
 * the 30-minute dedupe boundary without waiting.
 */
e2e.post('/seed-page-view', async (c) => {
  const body = await c.req.json()
  const { profileId, visitorHash, createdAt, minutesAgo } = body

  if (!profileId) {
    return c.json({ error: 'profileId required' }, 400)
  }

  // Verify profile exists
  const profile = await db.profile.findUnique({
    where: { id: profileId },
  })

  if (!profile) {
    return c.json({ error: 'Profile not found' }, 404)
  }

  // Calculate timestamp
  let timestamp: Date
  if (minutesAgo !== undefined && typeof minutesAgo === 'number') {
    timestamp = new Date(Date.now() - minutesAgo * 60 * 1000)
  } else if (createdAt) {
    timestamp = new Date(createdAt)
  } else {
    timestamp = new Date()
  }

  const pageView = await db.pageView.create({
    data: {
      profileId,
      visitorHash: visitorHash || `e2e-${Date.now()}`,
      createdAt: timestamp,
    },
  })

  console.log(`[e2e] Seeded page view for profile ${profileId} at ${timestamp.toISOString()}`)

  return c.json({
    success: true,
    viewId: pageView.id,
    visitorHash: pageView.visitorHash,
    createdAt: pageView.createdAt.toISOString(),
  })
})

// ============================================
// CLEANUP ENDPOINTS
// ============================================

/**
 * Clean up E2E test data by marker
 * ONLY deletes data with explicit E2E markers
 *
 * POST /e2e/cleanup
 *
 * Optional body:
 * - e2eRunId: Only delete data from a specific run (recommended for isolation)
 *
 * SCOPING BEHAVIOR:
 * - With e2eRunId: All data types scope to that run:
 *   - Sessions, subscriptions, payments: by marker prefix in IDs
 *   - Reminders: by subscription entityIds with run marker
 *   - Activities: by payload.e2eRunId JSON field
 * - Without e2eRunId: Falls back to email domain cleanup for reminders/activities/users
 * - Users: Cleaned by email domain (@e2e.natepay.co, @e2e-test.natepay.co, @test.natepay.co)
 */
e2e.post(
  '/cleanup',
  zValidator('json', z.object({
    e2eRunId: z.string().optional(), // If provided, only cleanup this run's data
  }).optional()),
  async (c) => {
    const body = c.req.valid('json') || {}
    const runId = body.e2eRunId

    console.log(`[e2e] Cleaning up E2E test data${runId ? ` for run: ${runId}` : ' (all E2E data)'}`)

    // Build marker pattern for queries
    const markerPattern = runId || E2E_PREFIX

    // Delete sessions with e2e marker
    const sessions = await db.session.deleteMany({
      where: { token: { startsWith: markerPattern } },
    })

    // Delete pageviews with e2e referrer marker
    const pageviews = await db.pageView.deleteMany({
      where: { referrer: { startsWith: markerPattern } },
    })

    // Delete requests with e2e prefix token
    const requests = await db.request.deleteMany({
      where: { publicTokenHash: { startsWith: markerPattern } },
    })

    // Delete subscriptions with e2e marker in Stripe/Paystack IDs
    const subscriptions = await db.subscription.deleteMany({
      where: {
        OR: [
          { stripeSubscriptionId: { startsWith: markerPattern } },
          { paystackAuthorizationCode: { startsWith: markerPattern } },
          { manageTokenNonce: { startsWith: markerPattern } },
        ],
      },
    })

    // Get E2E user IDs for fallback cleanup
    const e2eUserIds = await db.user.findMany({
      where: {
        OR: [
          { email: { endsWith: '@e2e.natepay.co' } },
          { email: { endsWith: '@e2e-test.natepay.co' } },
          { email: { endsWith: '@test.natepay.co' } },
        ],
      },
      select: { id: true },
    })

    // Delete reminders by runId (via entity markers) or fallback to email domain
    let reminders: { count: number }
    if (runId) {
      // Find subscriptions with this runId marker
      const e2eSubscriptions = await db.subscription.findMany({
        where: {
          OR: [
            { stripeSubscriptionId: { startsWith: runId } },
            { paystackAuthorizationCode: { startsWith: runId } },
            { manageTokenNonce: { startsWith: runId } },
          ],
        },
        select: { id: true },
      })
      const subIds = e2eSubscriptions.map(s => s.id)

      // Find requests with this runId marker
      const e2eRequests = await db.request.findMany({
        where: { publicTokenHash: { startsWith: runId } },
        select: { id: true },
      })
      const requestIds = e2eRequests.map(r => r.id)

      // Find payments with this runId marker
      const e2ePayments = await db.payment.findMany({
        where: { stripePaymentIntentId: { startsWith: runId } },
        select: { id: true },
      })
      const paymentIds = e2ePayments.map(p => p.id)

      // Delete reminders ONLY for entities with run markers (no user fallback to avoid over-deletion)
      // Build OR clauses only for non-empty ID arrays
      const orClauses: Array<{ entityId: { in: string[] }; entityType: string }> = []
      if (subIds.length > 0) orClauses.push({ entityId: { in: subIds }, entityType: 'subscription' })
      if (requestIds.length > 0) orClauses.push({ entityId: { in: requestIds }, entityType: 'request' })
      if (paymentIds.length > 0) orClauses.push({ entityId: { in: paymentIds }, entityType: 'payment' })

      if (orClauses.length > 0) {
        reminders = await db.reminder.deleteMany({
          where: { OR: orClauses },
        })
      } else {
        reminders = { count: 0 }
      }
    } else {
      // Fallback: delete all E2E user reminders (only when no runId specified)
      reminders = await db.reminder.deleteMany({
        where: { userId: { in: e2eUserIds.map(u => u.id) } },
      })
    }

    // Delete payments with e2e marker in Stripe IDs
    const payments = await db.payment.deleteMany({
      where: { stripePaymentIntentId: { startsWith: markerPattern } },
    })

    // Delete activities by runId (stored in payload.e2eRunId) or fallback to email domain
    let activities: { count: number }
    if (runId) {
      // Use raw query to filter by JSON payload field
      const result = await db.$executeRaw`
        DELETE FROM activities
        WHERE payload->>'e2eRunId' LIKE ${runId + '%'}
      `
      activities = { count: result }
    } else {
      // Fallback: delete all E2E user activities
      activities = await db.activity.deleteMany({
        where: { userId: { in: e2eUserIds.map(u => u.id) } },
      })
    }

    // Only delete users with explicit e2e email domains (safe)
    // This MUST come after deleting reminders/activities that reference users
    const users = await db.user.deleteMany({
      where: {
        OR: [
          { email: { endsWith: '@e2e.natepay.co' } },
          { email: { endsWith: '@e2e-test.natepay.co' } },
          { email: { endsWith: '@test.natepay.co' } },
        ],
      },
    })

    const deleted = {
      sessions: sessions.count,
      pageviews: pageviews.count,
      requests: requests.count,
      subscriptions: subscriptions.count,
      reminders: reminders.count,
      payments: payments.count,
      activities: activities.count,
      users: users.count,
    }

    console.log(`[e2e] Cleanup complete:`, deleted)

    return c.json({
      success: true,
      deleted,
      totalDeleted: Object.values(deleted).reduce((a, b) => a + b, 0),
    })
  }
)

/**
 * Delete a specific subscription (for test cleanup)
 * SECURITY: Only deletes subscriptions with E2E markers
 *
 * DELETE /e2e/subscription/:id
 */
e2e.delete('/subscription/:id', async (c) => {
  const id = c.req.param('id')

  // First, verify the subscription is E2E-seeded (has E2E marker)
  const subscription = await db.subscription.findUnique({
    where: { id },
    select: {
      stripeSubscriptionId: true,
      paystackAuthorizationCode: true,
      manageTokenNonce: true,
    },
  })

  if (!subscription) {
    return c.json({ error: 'Subscription not found' }, 404)
  }

  // Verify E2E marker exists on at least one field
  const isE2ESeeded =
    hasE2EMarker(subscription.stripeSubscriptionId) ||
    hasE2EMarker(subscription.paystackAuthorizationCode) ||
    hasE2EMarker(subscription.manageTokenNonce)

  if (!isE2ESeeded) {
    console.warn(`[e2e] Attempted to delete non-E2E subscription: ${id}`)
    return c.json({ error: 'Cannot delete non-E2E subscription' }, 403)
  }

  // Safe to delete - it's E2E data
  // First delete related notification logs
  const notificationLogs = await db.notificationLog.deleteMany({
    where: { subscriptionId: id },
  })

  // Delete reminders for this subscription
  const reminders = await db.reminder.deleteMany({
    where: { entityType: 'subscription', entityId: id },
  })

  // Delete the subscription
  await db.subscription.delete({
    where: { id },
  })

  return c.json({
    success: true,
    deleted: {
      subscription: 1,
      notificationLogs: notificationLogs.count,
      reminders: reminders.count,
    },
  })
})

// ============================================
// WEBHOOK SIMULATION ENDPOINTS
// ============================================

/**
 * Simulate a Stripe webhook event
 * This bypasses signature validation but goes through the full processing pipeline.
 *
 * POST /e2e/webhook/stripe
 * {
 *   eventType: 'checkout.session.completed' | 'invoice.paid' | etc,
 *   data: { ... event data object ... }
 * }
 */
e2e.post(
  '/webhook/stripe',
  zValidator('json', z.object({
    eventType: z.string(),
    data: z.record(z.any()), // event.data.object
    accountId: z.string().optional(), // For connect events
  })),
  async (c) => {
    const { eventType, data, accountId } = c.req.valid('json')

    console.log(`[e2e] Simulating Stripe webhook: ${eventType}`)

    // Construct a Stripe-like event object
    const event = {
      id: `${E2E_PREFIX}evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      object: 'event',
      type: eventType,
      created: Math.floor(Date.now() / 1000),
      data: {
        object: data,
      },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      account: accountId,
    }

    // Create webhook event record
    const webhookEvent = await db.webhookEvent.create({
      data: {
        provider: 'stripe',
        eventId: event.id,
        eventType: event.type,
        status: 'received',
        payload: JSON.parse(JSON.stringify(event)),
      },
    })

    // Process inline (same as test mode)
    const { webhookProcessor } = await import('../workers/webhookProcessor.js')

    try {
      await webhookProcessor({
        data: {
          provider: 'stripe',
          event,
          webhookEventId: webhookEvent.id,
        },
      } as any)

      return c.json({
        success: true,
        eventId: event.id,
        webhookEventId: webhookEvent.id,
        status: 'processed',
      })
    } catch (error: any) {
      console.error(`[e2e] Stripe webhook processing failed:`, error)
      return c.json({
        success: false,
        eventId: event.id,
        webhookEventId: webhookEvent.id,
        error: error.message,
      }, 500)
    }
  }
)

/**
 * Simulate a Paystack webhook event
 * This bypasses signature validation but goes through the full processing pipeline.
 *
 * POST /e2e/webhook/paystack
 * {
 *   event: 'charge.success' | 'transfer.success' | etc,
 *   data: { ... event data ... }
 * }
 */
e2e.post(
  '/webhook/paystack',
  zValidator('json', z.object({
    event: z.string(),
    data: z.record(z.any()),
  })),
  async (c) => {
    const payload = c.req.valid('json')
    const { event, data } = payload

    console.log(`[e2e] Simulating Paystack webhook: ${event}`)

    // Generate unique event ID from reference or timestamp
    const eventId = data.reference || `${E2E_PREFIX}${Date.now()}`
    const webhookEventId = `paystack_${event}_${eventId}`

    // Create webhook event record
    const webhookEvent = await db.webhookEvent.create({
      data: {
        provider: 'paystack',
        eventId: webhookEventId,
        eventType: event,
        status: 'received',
        payload: JSON.parse(JSON.stringify(payload)),
      },
    })

    // Process inline
    const { webhookProcessor } = await import('../workers/webhookProcessor.js')

    try {
      await webhookProcessor({
        data: {
          provider: 'paystack',
          event: payload, // Full payload { event, data }
          webhookEventId: webhookEvent.id,
        },
      } as any)

      return c.json({
        success: true,
        eventId: webhookEventId,
        webhookEventId: webhookEvent.id,
        status: 'processed',
      })
    } catch (error: any) {
      console.error(`[e2e] Paystack webhook processing failed:`, error)
      return c.json({
        success: false,
        eventId: webhookEventId,
        webhookEventId: webhookEvent.id,
        error: error.message,
      }, 500)
    }
  }
)

/**
 * Get webhook event status
 *
 * GET /e2e/webhook-event/:id
 */
e2e.get('/webhook-event/:id', async (c) => {
  const id = c.req.param('id')

  const event = await db.webhookEvent.findUnique({
    where: { id },
  })

  if (!event) {
    return c.json({ error: 'Webhook event not found' }, 404)
  }

  return c.json({
    id: event.id,
    eventId: event.eventId,
    eventType: event.eventType,
    provider: event.provider,
    status: event.status,
    error: event.error,
    processedAt: event.processedAt?.toISOString() || null,
    processingTimeMs: event.processingTimeMs,
  })
})

export default e2e
