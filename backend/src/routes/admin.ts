/**
 * Admin Routes
 *
 * Protected routes for operational monitoring and management.
 * Accessible via:
 * 1. ADMIN_API_KEY header (for Retool/external tools)
 * 2. Valid user session with email in admin whitelist (for frontend dashboard)
 */

import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { getCookie } from 'hono/cookie'
import { z } from 'zod'
import dlq from '../services/dlq.js'
import { db } from '../db/client.js'
import { getStuckTransfers, getTransferStats } from '../jobs/transfers.js'
import { getMissingTransactions, reconcilePaystackTransactions } from '../jobs/reconciliation.js'
import { checkEmailHealth, sendTestEmail, sendSupportTicketReplyEmail, sendCreatorAccountCreatedEmail } from '../services/email.js'
import { stripe } from '../services/stripe.js'
import { handleInvoicePaid } from './webhooks/stripe/invoice.js'
import { env } from '../config/env.js'
import { validateSession } from '../services/auth.js'
import { ADMIN_EMAILS, isAdminEmail } from '../config/admin.js'
import { listBanks, resolveAccount, createSubaccount, isPaystackSupported, type PaystackCountry } from '../services/paystack.js'
import { RESERVED_USERNAMES } from '../utils/constants.js'
import { displayAmountToCents } from '../utils/currency.js'
import { adminSensitiveRateLimit } from '../middleware/rateLimit.js'

const admin = new Hono()

// Lock for reconciliation to prevent concurrent runs
let reconciliationRunning = false

// Get session token from cookie or Authorization header
function getSessionToken(c: any): string | undefined {
  const cookieToken = getCookie(c, 'session')
  if (cookieToken) return cookieToken
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7)
  return undefined
}

// Admin auth middleware - requires ADMIN_API_KEY OR valid admin user session
// Skip auth for /me endpoint (used to check admin status)
admin.use('*', async (c, next) => {
  const path = c.req.path

  // /admin/me is used to CHECK if user is admin - handle it specially
  // This endpoint doesn't require auth - it returns { isAdmin: false } for non-admins
  if (path === '/admin/me' || path === '/me' || path.endsWith('/me')) {
    await next()
    return
  }

  // All other admin routes require authentication
  // Option 1: API key auth (for Retool/external tools)
  const apiKey = c.req.header('x-admin-api-key')
  const expectedKey = process.env.ADMIN_API_KEY

  if (apiKey && expectedKey && apiKey === expectedKey) {
    await next()
    return
  }

  // Option 2: User session auth (for frontend dashboard)
  const sessionToken = getSessionToken(c)
  if (sessionToken) {
    const session = await validateSession(sessionToken)
    if (session) {
      const user = await db.user.findUnique({
        where: { id: session.userId },
        select: { email: true },
      })
      if (user && isAdminEmail(user.email)) {
        c.set('userId', session.userId)
        await next()
        return
      }
    }
  }

  throw new HTTPException(401, { message: 'Admin access required' })
})

// ============================================
// ADMIN STATUS CHECK
// ============================================

/**
 * GET /admin/me
 * Check if current user is an admin
 * Used by frontend to verify admin access without duplicating whitelist
 */
admin.get('/me', async (c) => {
  try {
    // Get session token and validate
    const sessionToken = getSessionToken(c)
    if (!sessionToken) {
      return c.json({ isAdmin: false, email: null })
    }

    const session = await validateSession(sessionToken)
    if (!session) {
      return c.json({ isAdmin: false, email: null })
    }

    // Check if user email is in admin whitelist
    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { email: true },
    })

    if (user && isAdminEmail(user.email)) {
      return c.json({ isAdmin: true, email: user.email })
    }

    return c.json({ isAdmin: false, email: user?.email || null })
  } catch (err) {
    console.error('[admin/me] Error:', err)
    return c.json({ isAdmin: false, email: null })
  }
})

// ============================================
// WEBHOOK MONITORING
// ============================================

/**
 * GET /admin/webhooks/stats
 * Get overview of webhook processing status
 */
admin.get('/webhooks/stats', async (c) => {
  const [failedCounts, deadLetterCount, recentProcessed] = await Promise.all([
    dlq.getFailedWebhookCounts(),
    db.webhookEvent.count({ where: { status: 'dead_letter' } }),
    db.webhookEvent.count({
      where: {
        status: 'processed',
        processedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
  ])

  return c.json({
    failed: failedCounts,
    deadLetter: deadLetterCount,
    processedLast24h: recentProcessed,
  })
})

/**
 * GET /admin/webhooks/failed
 * List failed webhooks ready for retry
 */
admin.get('/webhooks/failed', async (c) => {
  const rawEvents = await dlq.getFailedWebhooksForRetry()
  // Transform eventType → type to match frontend contract
  const events = rawEvents.map(event => ({
    id: event.id,
    provider: event.provider,
    type: event.eventType,  // Frontend expects 'type', DLQ returns 'eventType'
    status: 'failed',
    retryCount: event.retryCount,
    createdAt: event.createdAt.toISOString(),
    error: event.error,
  }))
  return c.json({ events })
})

/**
 * GET /admin/webhooks/dead-letter
 * List webhooks that exceeded max retries
 */
admin.get('/webhooks/dead-letter', async (c) => {
  const events = await dlq.getDeadLetterWebhooks()
  return c.json({ events })
})

/**
 * POST /admin/webhooks/:id/retry
 * Manually retry a specific webhook
 */
admin.post('/webhooks/:id/retry', async (c) => {
  const { id } = c.req.param()
  const result = await dlq.retryWebhook(id)

  if (!result.success) {
    return c.json({ error: result.error }, 400)
  }

  return c.json({ success: true, message: 'Webhook queued for retry' })
})

// ============================================
// HEALTH & DIAGNOSTICS
// ============================================

/**
 * GET /admin/health
 * System health check (includes email)
 */
admin.get('/health', async (c) => {
  try {
    // Check database connection
    await db.$queryRaw`SELECT 1`

    // Check email service
    const emailHealth = await checkEmailHealth()

    return c.json({
      status: emailHealth.healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      database: 'connected',
      email: emailHealth.healthy ? 'connected' : 'error',
      emailError: emailHealth.error || undefined,
    })
  } catch (error) {
    return c.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 503)
  }
})

/**
 * GET /admin/email/health
 * Email service health check
 */
admin.get('/email/health', async (c) => {
  const health = await checkEmailHealth()
  return c.json({
    healthy: health.healthy,
    error: health.error,
    timestamp: new Date().toISOString(),
  }, health.healthy ? 200 : 503)
})

/**
 * POST /admin/email/test
 * Send a test email to verify delivery
 */
admin.post('/email/test', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const to = body.to

  if (!to || typeof to !== 'string' || !to.includes('@')) {
    return c.json({ error: 'Valid email address required in "to" field' }, 400)
  }

  const result = await sendTestEmail(to)

  return c.json({
    success: result.success,
    messageId: result.messageId,
    attempts: result.attempts,
    error: result.error,
  }, result.success ? 200 : 500)
})

/**
 * GET /admin/metrics
 * Basic platform metrics
 */
admin.get('/metrics', async (c) => {
  const [
    totalUsers,
    totalProfiles,
    activeSubscriptions,
    totalRevenue,
  ] = await Promise.all([
    db.user.count(),
    db.profile.count(),
    db.subscription.count({ where: { status: 'active' } }),
    db.subscription.aggregate({
      where: { status: 'active' },
      _sum: { amount: true },
    }),
  ])

  return c.json({
    users: totalUsers,
    profiles: totalProfiles,
    activeSubscriptions,
    monthlyRecurringRevenue: totalRevenue._sum.amount || 0,
  })
})

// ============================================
// TRANSFER MONITORING (Paystack OTP)
// ============================================

/**
 * GET /admin/transfers/stats
 * Get transfer statistics including stuck OTP transfers
 */
admin.get('/transfers/stats', async (c) => {
  const stats = await getTransferStats()
  return c.json(stats)
})

/**
 * GET /admin/transfers/stuck
 * List all transfers stuck in otp_pending status
 */
admin.get('/transfers/stuck', async (c) => {
  const minAgeHours = c.req.query('minAge') ? parseInt(c.req.query('minAge')!) : undefined
  const transfers = await getStuckTransfers(minAgeHours)

  return c.json({
    count: transfers.length,
    transfers,
    warning: transfers.length > 0
      ? 'These transfers require OTP finalization. Either disable OTP in Paystack dashboard or manually approve.'
      : null,
  })
})

/**
 * GET /admin/transfers/all-pending
 * List all pending transfers (both pending and otp_pending)
 */
admin.get('/transfers/all-pending', async (c) => {
  const transfers = await db.payment.findMany({
    where: {
      type: 'payout',
      status: { in: ['pending', 'otp_pending'] },
    },
    include: {
      subscription: {
        include: {
          creator: {
            select: {
              email: true,
              profile: {
                select: {
                  displayName: true,
                  username: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    take: 100,
  })

  return c.json({
    count: transfers.length,
    transfers: transfers.map(t => ({
      id: t.id,
      creatorId: t.creatorId,
      creatorName: t.subscription?.creator?.profile?.displayName
        || t.subscription?.creator?.profile?.username
        || 'Unknown',
      amountCents: t.amountCents,
      netCents: t.netCents,
      currency: t.currency,
      status: t.status,
      transferCode: t.paystackTransferCode,
      createdAt: t.createdAt,
    })),
  })
})

// ============================================
// RECONCILIATION
// ============================================

/**
 * GET /admin/reconciliation/missing
 * List Paystack transactions that are missing from DB
 */
admin.get('/reconciliation/missing', async (c) => {
  const periodHours = c.req.query('hours') ? parseInt(c.req.query('hours')!) : 48

  const result = await getMissingTransactions(periodHours)

  return c.json({
    periodHours,
    ...result,
    warning: result.count > 0
      ? 'These transactions succeeded in Paystack but have no record in your database. Possible webhook failure - creators may not have been paid.'
      : null,
  })
})

/**
 * POST /admin/reconciliation/run
 * Manually trigger reconciliation
 */
admin.post('/reconciliation/run', adminSensitiveRateLimit, async (c) => {
  // Prevent concurrent reconciliation runs
  if (reconciliationRunning) {
    return c.json({ error: 'Reconciliation already in progress' }, 409)
  }

  reconciliationRunning = true
  try {
    const body = await c.req.json().catch(() => ({}))
    const periodHours = body.periodHours || 48
    const autoFix = body.autoFix === true

    const result = await reconcilePaystackTransactions({
      periodHours,
      autoFix,
      alertOnDiscrepancy: true,
    })

    return c.json({
      success: true,
      ...result,
    })
  } finally {
    reconciliationRunning = false
  }
})

/**
 * POST /admin/reconciliation/stripe
 * Manually trigger Stripe reconciliation (sync missing payments)
 */
admin.post('/reconciliation/stripe', adminSensitiveRateLimit, async (c) => {
  // Prevent concurrent reconciliation runs
  if (reconciliationRunning) {
    return c.json({ error: 'Reconciliation already in progress' }, 409)
  }

  reconciliationRunning = true
  const limit = parseInt(c.req.query('limit') || '100')
  console.log(`[reconciliation] Starting Stripe sync (limit: ${limit})`)

  try {
    // Fetch recent invoice.paid events
    const events = await stripe.events.list({
      type: 'invoice.paid',
      limit,
    })

    let processed = 0

    for (const event of events.data) {
      // Re-run the webhook handler logic
      // It has built-in idempotency (checks db.payment), so it's safe to replay
      await handleInvoicePaid(event)
      processed++
    }

    return c.json({
      success: true,
      scanned: events.data.length,
      processed,
      message: 'Stripe events replayed successfully. Check logs for details.'
    })
  } catch (err: any) {
    console.error('[reconciliation] Stripe sync failed:', err)
    return c.json({ error: 'Reconciliation failed' }, 500)
  } finally {
    reconciliationRunning = false
  }
})

// ============================================
// DASHBOARD STATS (for Retool)
// ============================================

admin.get('/dashboard', async (c) => {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const [
    totalUsers,
    newUsersToday,
    newUsersThisMonth,
    activeSubscriptions,
    totalRevenueCents,
    revenueThisMonthCents,
    disputedPayments,
    failedPaymentsToday
  ] = await Promise.all([
    db.user.count({ where: { deletedAt: null } }),
    db.user.count({ where: { createdAt: { gte: startOfDay }, deletedAt: null } }),
    db.user.count({ where: { createdAt: { gte: startOfMonth }, deletedAt: null } }),
    db.subscription.count({ where: { status: 'active' } }),
    db.payment.aggregate({
      where: { status: 'succeeded', type: 'recurring' },
      _sum: { feeCents: true }
    }),
    db.payment.aggregate({
      where: { status: 'succeeded', type: 'recurring', createdAt: { gte: startOfMonth } },
      _sum: { feeCents: true }
    }),
    db.payment.count({ where: { status: 'disputed' } }),
    db.payment.count({ where: { status: 'failed', createdAt: { gte: startOfDay } } })
  ])

  return c.json({
    users: { total: totalUsers, newToday: newUsersToday, newThisMonth: newUsersThisMonth },
    subscriptions: { active: activeSubscriptions },
    revenue: {
      totalCents: totalRevenueCents._sum.feeCents || 0,
      thisMonthCents: revenueThisMonthCents._sum.feeCents || 0
    },
    flags: { disputedPayments, failedPaymentsToday }
  })
})

// ============================================
// USERS (for Retool)
// ============================================

admin.get('/users', async (c) => {
  const query = z.object({
    search: z.string().optional(),
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(50),
    status: z.enum(['all', 'active', 'blocked', 'deleted']).default('all')
  }).parse(c.req.query())

  const skip = (query.page - 1) * query.limit
  const where: any = {}

  if (query.search) {
    where.OR = [
      { email: { contains: query.search, mode: 'insensitive' } },
      { profile: { username: { contains: query.search, mode: 'insensitive' } } },
      { profile: { displayName: { contains: query.search, mode: 'insensitive' } } }
    ]
  }

  // Status filtering at DB level - push all filtering to the database
  if (query.status === 'active') {
    where.deletedAt = null
  } else if (query.status === 'blocked') {
    // Blocked: deletedAt is set AND profile exists (user was soft-deleted but profile retained)
    where.deletedAt = { not: null }
    where.profile = { isNot: null }
  } else if (query.status === 'deleted') {
    // Deleted: deletedAt is set AND profile is null (fully deleted)
    where.deletedAt = { not: null }
    where.profile = null
  }
  // 'all' status: no additional filters

  // Fetch users with proper DB-level pagination
  const [users, total] = await Promise.all([
    db.user.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        profile: {
          select: {
            username: true, displayName: true, avatarUrl: true,
            currency: true, country: true, payoutStatus: true, paymentProvider: true
          }
        },
        _count: { select: { subscriptions: true, subscribedTo: true } }
      }
    }),
    db.user.count({ where })
  ])

  const userIds = users.map(u => u.id)
  const revenues = await db.payment.groupBy({
    by: ['creatorId'],
    where: { creatorId: { in: userIds }, status: 'succeeded' },
    _sum: { netCents: true }
  })
  const revenueMap = new Map(revenues.map(r => [r.creatorId, r._sum.netCents || 0]))

  // Helper to determine user status
  const getUserStatus = (user: { deletedAt: Date | null; profile: any }) => {
    if (!user.deletedAt) return 'active'
    // If deletedAt is set but profile exists, user is blocked
    // If deletedAt is set and no profile, user is fully deleted
    return user.profile ? 'blocked' : 'deleted'
  }

  return c.json({
    users: users.map(u => ({
      id: u.id,
      email: u.email,
      profile: u.profile ? {
        username: u.profile.username,
        displayName: u.profile.displayName,
        avatarUrl: u.profile.avatarUrl,
        country: u.profile.country,
        currency: u.profile.currency,
        payoutStatus: u.profile.payoutStatus,
        paymentProvider: u.profile.paymentProvider,
      } : null,
      status: getUserStatus(u),
      subscriberCount: u._count.subscriptions,
      subscribedToCount: u._count.subscribedTo,
      revenueTotal: revenueMap.get(u.id) || 0,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt
    })),
    total,
    page: query.page,
    totalPages: Math.ceil(total / query.limit)
  })
})

admin.get('/users/:id', async (c) => {
  const { id } = c.req.param()

  const user = await db.user.findUnique({
    where: { id },
    include: {
      profile: true,
      subscriptions: {
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { subscriber: { select: { email: true } } }
      },
      subscribedTo: {
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { creator: { select: { email: true, profile: { select: { username: true } } } } }
      }
    }
  })

  if (!user) return c.json({ error: 'User not found' }, 404)

  const paymentStats = await db.payment.aggregate({
    where: { creatorId: id, status: 'succeeded' },
    _sum: { netCents: true, feeCents: true },
    _count: true
  })

  return c.json({
    user: {
      ...user,
      stats: {
        totalPayments: paymentStats._count,
        totalRevenueCents: paymentStats._sum.netCents || 0,
        totalFeesCents: paymentStats._sum.feeCents || 0
      }
    }
  })
})

admin.post('/users/:id/block', async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json().catch(() => ({}))
  const reason = body.reason || 'Blocked by admin'

  await db.user.update({ where: { id }, data: { deletedAt: new Date() } })
  await db.activity.create({
    data: { userId: id, type: 'admin_block', payload: { reason, blockedAt: new Date().toISOString() } }
  })

  return c.json({ success: true })
})

admin.post('/users/:id/unblock', async (c) => {
  const { id } = c.req.param()

  await db.user.update({ where: { id }, data: { deletedAt: null } })
  await db.activity.create({
    data: { userId: id, type: 'admin_unblock', payload: { unblockedAt: new Date().toISOString() } }
  })

  return c.json({ success: true })
})

/**
 * DELETE /admin/users/:id
 * Full account deletion with cleanup (matches self-delete flow)
 * - Cancels all Stripe subscriptions (platform, creator, subscriber)
 * - Neutralizes all Paystack subscriptions (marks canceled, clears auth)
 * - Anonymizes email for GDPR
 * - Clears sessions
 * - Deletes profile
 * - Logs admin activity
 */
admin.delete('/users/:id', adminSensitiveRateLimit, async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json().catch(() => ({}))
  const adminUserId = c.get('userId') as string | undefined

  if (body.confirm !== 'DELETE') {
    return c.json({ error: 'Must confirm with { confirm: "DELETE" }' }, 400)
  }

  const reason = body.reason || 'Deleted by admin'

  // Verify user exists
  const user = await db.user.findUnique({
    where: { id },
    include: { profile: { select: { platformSubscriptionId: true } } },
  })

  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }

  // Track canceled subscriptions for response
  const canceledCounts = {
    platform: 0,
    stripeCreator: 0,
    stripeSubscriber: 0,
    paystackCreator: 0,
    paystackSubscriber: 0,
  }

  // 1. Cancel platform subscription if exists (service users)
  if (user.profile?.platformSubscriptionId) {
    try {
      await stripe.subscriptions.cancel(user.profile.platformSubscriptionId)
      canceledCounts.platform = 1
      console.log(`[admin] Canceled platform subscription ${user.profile.platformSubscriptionId}`)
    } catch (err: any) {
      if (err.code !== 'resource_missing') {
        console.error(`[admin] Failed to cancel platform subscription:`, err.message)
      }
    }
  }

  // 2. Cancel all STRIPE subscriptions where user is the creator
  const stripeCreatorSubs = await db.subscription.findMany({
    where: {
      creatorId: id,
      stripeSubscriptionId: { not: null },
      status: { in: ['active', 'past_due', 'pending'] },
    },
    select: { id: true, stripeSubscriptionId: true },
  })

  for (const sub of stripeCreatorSubs) {
    if (sub.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.cancel(sub.stripeSubscriptionId)
        // Update local DB status
        await db.subscription.update({
          where: { id: sub.id },
          data: { status: 'canceled', canceledAt: new Date() },
        })
        canceledCounts.stripeCreator++
        console.log(`[admin] Canceled creator Stripe subscription ${sub.stripeSubscriptionId}`)
      } catch (err: any) {
        if (err.code !== 'resource_missing') {
          console.error(`[admin] Failed to cancel creator subscription:`, err.message)
        }
      }
    }
  }

  // 3. Cancel all STRIPE subscriptions where user is the subscriber
  const stripeSubscriberSubs = await db.subscription.findMany({
    where: {
      subscriberId: id,
      stripeSubscriptionId: { not: null },
      status: { in: ['active', 'past_due', 'pending'] },
    },
    select: { id: true, stripeSubscriptionId: true },
  })

  for (const sub of stripeSubscriberSubs) {
    if (sub.stripeSubscriptionId) {
      try {
        await stripe.subscriptions.cancel(sub.stripeSubscriptionId)
        // Update local DB status
        await db.subscription.update({
          where: { id: sub.id },
          data: { status: 'canceled', canceledAt: new Date() },
        })
        canceledCounts.stripeSubscriber++
        console.log(`[admin] Canceled subscriber Stripe subscription ${sub.stripeSubscriptionId}`)
      } catch (err: any) {
        if (err.code !== 'resource_missing') {
          console.error(`[admin] Failed to cancel subscriber subscription:`, err.message)
        }
      }
    }
  }

  // 4. Neutralize all PAYSTACK subscriptions where user is the creator
  // (Mark as canceled, set cancelAtPeriodEnd, clear authorization to prevent billing job from charging)
  const paystackCreatorSubs = await db.subscription.updateMany({
    where: {
      creatorId: id,
      paystackAuthorizationCode: { not: null },
      status: { in: ['active', 'past_due', 'pending'] },
    },
    data: {
      status: 'canceled',
      cancelAtPeriodEnd: true,
      canceledAt: new Date(),
      paystackAuthorizationCode: null, // Clear auth to prevent future charges
    },
  })
  canceledCounts.paystackCreator = paystackCreatorSubs.count
  if (paystackCreatorSubs.count > 0) {
    console.log(`[admin] Neutralized ${paystackCreatorSubs.count} Paystack creator subscriptions`)
  }

  // 5. Neutralize all PAYSTACK subscriptions where user is the subscriber
  const paystackSubscriberSubs = await db.subscription.updateMany({
    where: {
      subscriberId: id,
      paystackAuthorizationCode: { not: null },
      status: { in: ['active', 'past_due', 'pending'] },
    },
    data: {
      status: 'canceled',
      cancelAtPeriodEnd: true,
      canceledAt: new Date(),
      paystackAuthorizationCode: null, // Clear auth to prevent future charges
    },
  })
  canceledCounts.paystackSubscriber = paystackSubscriberSubs.count
  if (paystackSubscriberSubs.count > 0) {
    console.log(`[admin] Neutralized ${paystackSubscriberSubs.count} Paystack subscriber subscriptions`)
  }

  // 6. Log admin activity before deletion (so we have the real email)
  await db.activity.create({
    data: {
      userId: id,
      type: 'admin_delete',
      payload: {
        reason,
        deletedBy: adminUserId,
        originalEmail: user.email,
        deletedAt: new Date().toISOString(),
        canceledSubscriptions: canceledCounts,
      },
    },
  })

  // 7. Anonymize email for GDPR compliance
  const anonymizedEmail = `deleted_${id}@deleted.natepay.co`

  // Update user with soft delete and anonymize email
  await db.user.update({
    where: { id },
    data: {
      deletedAt: new Date(),
      email: anonymizedEmail,
    },
  })

  // 8. Delete all sessions for this user
  try {
    await db.session.deleteMany({
      where: { userId: id },
    })
  } catch {
    // Session cleanup is not critical in test environments
  }

  // 9. Delete profile (contains PII)
  await db.profile.deleteMany({
    where: { userId: id },
  })

  return c.json({
    success: true,
    message: 'User deleted with full cleanup',
    details: {
      canceledSubscriptions: canceledCounts,
    },
  })
})

// ============================================
// TEST USER CLEANUP
// ============================================

/**
 * GET /admin/users/test-cleanup/preview
 * Preview test users that would be cleaned up
 * Matches: *@test.com, test@*, *+test*, demo@*, *@example.com
 */
admin.get('/users/test-cleanup/preview', async (c) => {
  const testUsers = await db.user.findMany({
    where: {
      OR: [
        { email: { endsWith: '@test.com' } },
        { email: { endsWith: '@example.com' } },
        { email: { startsWith: 'test@' } },
        { email: { startsWith: 'demo@' } },
        { email: { contains: '+test' } },
        { email: { contains: 'testuser' } },
      ],
      // Exclude already deleted
      deletedAt: null,
    },
    select: {
      id: true,
      email: true,
      createdAt: true,
      profile: {
        select: {
          username: true,
          displayName: true,
        },
      },
      _count: {
        select: {
          subscriptions: true,
          subscribedTo: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return c.json({
    count: testUsers.length,
    users: testUsers,
    patterns: [
      '*@test.com',
      '*@example.com',
      'test@*',
      'demo@*',
      '*+test*',
      '*testuser*',
    ],
  })
})

/**
 * POST /admin/users/test-cleanup/delete
 * Bulk delete test users (soft delete, GDPR compliant)
 * Requires confirmation in body: { confirm: true }
 */
admin.post('/users/test-cleanup/delete', adminSensitiveRateLimit, async (c) => {
  const body = z.object({
    confirm: z.boolean(),
    dryRun: z.boolean().default(false),
  }).parse(await c.req.json())

  if (!body.confirm) {
    return c.json({ error: 'Must confirm deletion with { confirm: true }' }, 400)
  }

  // Find test users
  const testUsers = await db.user.findMany({
    where: {
      OR: [
        { email: { endsWith: '@test.com' } },
        { email: { endsWith: '@example.com' } },
        { email: { startsWith: 'test@' } },
        { email: { startsWith: 'demo@' } },
        { email: { contains: '+test' } },
        { email: { contains: 'testuser' } },
      ],
      deletedAt: null,
    },
    select: { id: true, email: true },
  })

  if (body.dryRun) {
    return c.json({
      dryRun: true,
      wouldDelete: testUsers.length,
      users: testUsers.map(u => u.email),
    })
  }

  // Bulk cleanup - for each user:
  // 1. Cancel subscriptions (simplified - just marks as canceled)
  // 2. Soft delete user
  // 3. Anonymize email
  // 4. Delete profile
  let deleted = 0
  const errors: string[] = []

  for (const user of testUsers) {
    try {
      // Cancel all subscriptions as creator and subscriber
      await db.subscription.updateMany({
        where: { OR: [{ creatorId: user.id }, { subscriberId: user.id }] },
        data: { status: 'canceled', canceledAt: new Date() },
      })

      // Delete sessions
      await db.session.deleteMany({ where: { userId: user.id } })

      // Delete profile
      await db.profile.deleteMany({ where: { userId: user.id } })

      // Soft delete and anonymize
      await db.user.update({
        where: { id: user.id },
        data: {
          deletedAt: new Date(),
          email: `deleted_${user.id}@deleted.natepay.co`,
        },
      })

      deleted++
    } catch (err) {
      errors.push(`${user.email}: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  // Log admin action
  await db.activity.create({
    data: {
      userId: testUsers[0]?.id || 'system',
      type: 'admin_bulk_cleanup',
      payload: {
        deletedCount: deleted,
        errors: errors.length,
        performedAt: new Date().toISOString(),
      },
    },
  })

  return c.json({
    success: true,
    deleted,
    errors: errors.length > 0 ? errors : undefined,
  })
})

// ============================================
// PAYMENTS (for Retool)
// ============================================

admin.get('/payments', async (c) => {
  const query = z.object({
    search: z.string().optional(),
    status: z.enum(['all', 'succeeded', 'failed', 'refunded', 'disputed']).default('all'),
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(50)
  }).parse(c.req.query())

  const skip = (query.page - 1) * query.limit
  const where: any = {}

  if (query.status !== 'all') where.status = query.status

  const [payments, total] = await Promise.all([
    db.payment.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        subscription: {
          include: {
            creator: { select: { email: true, profile: { select: { username: true } } } },
            subscriber: { select: { email: true } }
          }
        }
      }
    }),
    db.payment.count({ where })
  ])

  return c.json({
    payments: payments.map(p => ({
      id: p.id,
      creator: {
        id: p.creatorId,
        email: p.subscription?.creator?.email || '',
        username: p.subscription?.creator?.profile?.username || null,
      },
      subscriber: {
        id: p.subscriberId,
        email: p.subscription?.subscriber?.email || '',
      },
      grossCents: p.grossCents,
      amountCents: p.amountCents,
      feeCents: p.feeCents,
      netCents: p.netCents,
      currency: p.currency,
      status: p.status,
      type: p.type,
      provider: p.stripePaymentIntentId ? 'stripe' : p.paystackTransactionRef ? 'paystack' : 'unknown',
      stripePaymentIntentId: p.stripePaymentIntentId,
      paystackTransactionRef: p.paystackTransactionRef,
      createdAt: p.createdAt
    })),
    total,
    page: query.page,
    totalPages: Math.ceil(total / query.limit)
  })
})

admin.get('/payments/:id', async (c) => {
  const { id } = c.req.param()

  const payment = await db.payment.findUnique({
    where: { id },
    include: {
      subscription: {
        include: {
          creator: { select: { id: true, email: true, profile: { select: { username: true, displayName: true } } } },
          subscriber: { select: { id: true, email: true } }
        }
      }
    }
  })

  if (!payment) return c.json({ error: 'Payment not found' }, 404)
  return c.json({ payment })
})

// ============================================
// REFUNDS (for Retool)
// ============================================

admin.post('/payments/:id/refund', adminSensitiveRateLimit, async (c) => {
  const { id } = c.req.param()
  const body = z.object({
    reason: z.string().optional(),
    amount: z.number().optional()
  }).parse(await c.req.json().catch(() => ({})))

  // Get admin info for audit trail
  const session = c.get('session')
  const adminId = session?.userId
  const adminEmail = session?.user?.email

  const payment = await db.payment.findUnique({
    where: { id },
    include: { subscription: { include: { creator: { select: { profile: { select: { paymentProvider: true } } } } } } }
  })

  if (!payment) return c.json({ error: 'Payment not found' }, 404)
  if (payment.status === 'refunded') return c.json({ error: 'Already refunded' }, 400)
  if (payment.status !== 'succeeded') return c.json({ error: 'Can only refund succeeded payments' }, 400)

  // Validate refund amount
  if (body.amount !== undefined) {
    if (body.amount <= 0) {
      return c.json({ error: 'Refund amount must be positive' }, 400)
    }
    if (body.amount > payment.grossCents) {
      return c.json({ error: 'Refund amount exceeds payment amount' }, 400)
    }
  }

  // Idempotency check - prevent duplicate refunds
  const existingRefund = await db.activity.findFirst({
    where: {
      type: 'admin_refund',
      payload: { path: ['paymentId'], equals: id }
    }
  })
  if (existingRefund) {
    return c.json({ error: 'Refund already processed for this payment' }, 400)
  }

  // Generate idempotency key for Stripe
  const idempotencyKey = `refund_${id}_${body.amount || 'full'}_${Date.now()}`

  try {
    if (payment.stripePaymentIntentId) {
      const refund = await stripe.refunds.create({
        payment_intent: payment.stripePaymentIntentId,
        amount: body.amount,
        reason: 'requested_by_customer'
      }, { idempotencyKey })

      await db.payment.update({ where: { id }, data: { status: 'refunded' } })
      await db.activity.create({
        data: {
          userId: payment.creatorId,
          type: 'admin_refund',
          payload: {
            paymentId: id,
            refundId: refund.id,
            amountCents: refund.amount,
            reason: body.reason,
            adminId,
            adminEmail
          }
        }
      })

      return c.json({ success: true, refund: { id: refund.id, amountCents: refund.amount, status: refund.status } })

    } else if (payment.paystackTransactionRef) {
      const response = await fetch('https://api.paystack.co/refund', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction: payment.paystackTransactionRef,
          amount: body.amount,
          merchant_note: body.reason || 'Admin refund'
        })
      })

      const result = await response.json() as { status: boolean; message?: string; data?: any }
      if (!result.status) return c.json({ error: result.message || 'Paystack refund failed' }, 400)

      await db.payment.update({ where: { id }, data: { status: 'refunded' } })
      await db.activity.create({
        data: {
          userId: payment.creatorId,
          type: 'admin_refund',
          payload: {
            paymentId: id,
            refundData: result.data,
            reason: body.reason,
            adminId,
            adminEmail
          }
        }
      })

      return c.json({ success: true, refund: result.data })

    } else {
      return c.json({ error: 'No payment provider reference found' }, 400)
    }
  } catch (error: any) {
    console.error('Refund error:', error)
    // Sanitize error message - don't expose raw Stripe/Paystack errors
    const safeMessage = error.type === 'StripeCardError' ? error.message : 'Refund failed'
    return c.json({ error: safeMessage }, 500)
  }
})

// ============================================
// SUBSCRIPTIONS (for Retool)
// ============================================

admin.get('/subscriptions', async (c) => {
  const query = z.object({
    status: z.enum(['all', 'active', 'canceled', 'past_due']).default('all'),
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(50)
  }).parse(c.req.query())

  const skip = (query.page - 1) * query.limit
  const where: any = query.status !== 'all' ? { status: query.status } : {}

  const [subscriptions, total] = await Promise.all([
    db.subscription.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { email: true, profile: { select: { username: true } } } },
        subscriber: { select: { email: true } }
      }
    }),
    db.subscription.count({ where })
  ])

  return c.json({
    subscriptions: subscriptions.map(s => ({
      id: s.id,
      creator: {
        id: s.creatorId,
        email: s.creator.email,
        username: s.creator.profile?.username || null,
      },
      subscriber: {
        id: s.subscriberId,
        email: s.subscriber.email,
      },
      amount: s.amount,
      currency: s.currency,
      interval: s.interval,
      status: s.status,
      ltvCents: s.ltvCents,
      createdAt: s.createdAt,
      currentPeriodEnd: s.currentPeriodEnd
    })),
    total,
    page: query.page,
    totalPages: Math.ceil(total / query.limit)
  })
})

admin.post('/subscriptions/:id/cancel', adminSensitiveRateLimit, async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json().catch(() => ({}))
  const immediate = body.immediate ?? false

  const subscription = await db.subscription.findUnique({ where: { id } })
  if (!subscription) return c.json({ error: 'Subscription not found' }, 404)

  if (subscription.stripeSubscriptionId) {
    if (immediate) {
      await stripe.subscriptions.cancel(subscription.stripeSubscriptionId)
    } else {
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, { cancel_at_period_end: true })
    }
  }

  await db.subscription.update({
    where: { id },
    data: immediate ? { status: 'canceled', canceledAt: new Date() } : { cancelAtPeriodEnd: true }
  })

  return c.json({ success: true })
})

// ============================================
// ACTIVITY FEED (for Retool)
// ============================================

admin.get('/activity', async (c) => {
  const query = z.object({
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(100),
    type: z.string().optional()
  }).parse(c.req.query())

  const skip = (query.page - 1) * query.limit
  const where: any = query.type ? { type: query.type } : {}

  const [activities, totalCount] = await Promise.all([
    db.activity.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { email: true, profile: { select: { username: true } } } } }
    }),
    db.activity.count({ where })
  ])

  // Helper to generate human-readable message from activity type
  function getActivityMessage(type: string, payload: any): string {
    switch (type) {
      case 'admin_block': return `Blocked user: ${payload?.reason || 'No reason provided'}`
      case 'admin_unblock': return `Unblocked user`
      case 'admin_refund': return `Issued refund: ${payload?.reason || 'No reason provided'}`
      case 'admin_subscription_paused': return `Paused subscription`
      case 'admin_subscription_resumed': return `Resumed subscription`
      case 'admin_payout_triggered': return `Triggered manual payout`
      case 'admin_payouts_disabled': return `Disabled payouts: ${payload?.reason || ''}`
      case 'admin_payouts_enabled': return `Enabled payouts`
      case 'admin_unblock_subscriber': return `Unblocked subscriber: ${payload?.unblockReason || ''}`
      default: return type.replace(/_/g, ' ').replace(/^admin /, '')
    }
  }

  return c.json({
    activities: activities.map(a => ({
      id: a.id,
      type: a.type,
      message: getActivityMessage(a.type, a.payload),
      adminEmail: a.user.email,
      targetUserId: a.userId,
      metadata: a.payload,
      createdAt: a.createdAt
    })),
    total: totalCount,
    page: query.page,
    totalPages: Math.ceil(totalCount / query.limit)
  })
})

// ============================================
// SYSTEM LOGS (for Retool)
// ============================================

admin.get('/logs', async (c) => {
  const query = z.object({
    type: z.string().optional(),
    level: z.enum(['info', 'warning', 'error']).optional(),
    userId: z.string().optional(),
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(100)
  }).parse(c.req.query())

  const skip = (query.page - 1) * query.limit
  const where: any = {}

  if (query.type) where.type = query.type
  if (query.level) where.level = query.level
  if (query.userId) where.userId = query.userId

  const [logs, total] = await Promise.all([
    db.systemLog.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { createdAt: 'desc' }
    }),
    db.systemLog.count({ where })
  ])

  return c.json({
    logs: logs.map(l => ({
      id: l.id,
      type: l.type,
      level: l.level,
      userId: l.userId,
      entityType: l.entityType,
      entityId: l.entityId,
      message: l.message,
      metadata: l.metadata,
      errorCode: l.errorCode,
      errorMessage: l.errorMessage,
      createdAt: l.createdAt
    })),
    total,
    page: query.page,
    totalPages: Math.ceil(total / query.limit)
  })
})

admin.get('/logs/stats', async (c) => {
  const now = new Date()
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const [emailsSent24h, emailsFailed24h, remindersSent24h, errors24h, errorsByType] = await Promise.all([
    db.systemLog.count({ where: { type: 'email_sent', createdAt: { gte: last24h } } }),
    db.systemLog.count({ where: { type: 'email_failed', createdAt: { gte: last24h } } }),
    db.systemLog.count({ where: { type: 'reminder_sent', createdAt: { gte: last24h } } }),
    db.systemLog.count({ where: { level: 'error', createdAt: { gte: last24h } } }),
    db.systemLog.groupBy({
      by: ['type'],
      where: { level: 'error', createdAt: { gte: last7d } },
      _count: true
    })
  ])

  return c.json({
    last24h: {
      emailsSent: emailsSent24h,
      emailsFailed: emailsFailed24h,
      remindersSent: remindersSent24h,
      totalErrors: errors24h
    },
    errorsByType: errorsByType.map(e => ({ type: e.type, count: e._count }))
  })
})

// ============================================
// REMINDERS (for Retool)
// ============================================

admin.get('/reminders', async (c) => {
  const query = z.object({
    status: z.enum(['scheduled', 'sent', 'failed', 'canceled', 'all']).default('all'),
    type: z.string().optional(),
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(50)
  }).parse(c.req.query())

  const skip = (query.page - 1) * query.limit
  const where: any = {}

  if (query.status !== 'all') where.status = query.status
  if (query.type) where.type = query.type

  const [reminders, total] = await Promise.all([
    db.reminder.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { scheduledFor: 'desc' }
    }),
    db.reminder.count({ where })
  ])

  return c.json({
    reminders: reminders.map(r => ({
      id: r.id,
      userId: r.userId,
      entityType: r.entityType,
      entityId: r.entityId,
      type: r.type,
      channel: r.channel,
      status: r.status,
      scheduledFor: r.scheduledFor,
      sentAt: r.sentAt,
      errorMessage: r.errorMessage,
      retryCount: r.retryCount,
      createdAt: r.createdAt
    })),
    total,
    page: query.page,
    totalPages: Math.ceil(total / query.limit)
  })
})

admin.get('/reminders/stats', async (c) => {
  const now = new Date()
  const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  const [scheduled, sentToday, failedToday, upcoming] = await Promise.all([
    db.reminder.count({ where: { status: 'scheduled' } }),
    db.reminder.count({ where: { status: 'sent', sentAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } } }),
    db.reminder.count({ where: { status: 'failed' } }),
    db.reminder.count({ where: { status: 'scheduled', scheduledFor: { lte: next24h } } })
  ])

  return c.json({
    scheduled,
    sentToday,
    failed: failedToday,
    upcomingNext24h: upcoming
  })
})

// ============================================
// EMAILS (for Retool)
// ============================================

admin.get('/emails', async (c) => {
  const query = z.object({
    status: z.enum(['sent', 'failed', 'all']).default('all'),
    template: z.string().optional(),
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(100)
  }).parse(c.req.query())

  const skip = (query.page - 1) * query.limit
  const where: any = {}

  if (query.status === 'sent') where.type = 'email_sent'
  else if (query.status === 'failed') where.type = 'email_failed'
  else where.type = { in: ['email_sent', 'email_failed'] }

  if (query.template) {
    where.metadata = { path: ['template'], equals: query.template }
  }

  const [logs, total] = await Promise.all([
    db.systemLog.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { createdAt: 'desc' }
    }),
    db.systemLog.count({ where })
  ])

  return c.json({
    emails: logs.map(l => {
      const meta = l.metadata as any || {}
      return {
        id: l.id,
        status: l.type === 'email_sent' ? 'sent' : 'failed',
        to: meta.to,
        subject: meta.subject,
        template: meta.template,
        messageId: meta.messageId,
        error: l.errorMessage,
        userId: l.userId,
        createdAt: l.createdAt
      }
    }),
    total,
    page: query.page,
    totalPages: Math.ceil(total / query.limit)
  })
})

// ============================================
// INVOICES (for Retool)
// ============================================

admin.get('/invoices', async (c) => {
  const query = z.object({
    status: z.enum(['sent', 'paid', 'expired', 'all']).default('all'),
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(50)
  }).parse(c.req.query())

  const skip = (query.page - 1) * query.limit
  const where: any = { dueDate: { not: null } } // Only invoices (requests with due dates)

  if (query.status !== 'all') where.status = query.status

  const [requests, total] = await Promise.all([
    db.request.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { email: true, profile: { select: { username: true, displayName: true } } } }
      }
    }),
    db.request.count({ where })
  ])

  return c.json({
    invoices: requests.map(r => ({
      id: r.id,
      creator: {
        id: r.creatorId,
        email: r.creator.email,
        username: r.creator.profile?.username || null,
        displayName: r.creator.profile?.displayName || null,
      },
      recipientName: r.recipientName,
      recipientEmail: r.recipientEmail,
      recipientPhone: r.recipientPhone,
      amountCents: r.amountCents,
      currency: r.currency,
      status: r.status,
      dueDate: r.dueDate,
      sentAt: r.sentAt,
      respondedAt: r.respondedAt,
      createdAt: r.createdAt
    })),
    total,
    page: query.page,
    totalPages: Math.ceil(total / query.limit)
  })
})

// ============================================
// DISPUTES & CHARGEBACKS (for Retool)
// ============================================

/**
 * GET /admin/disputes/stats
 * Dispute statistics overview
 */
admin.get('/disputes/stats', async (c) => {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  const [
    // Current open disputes
    openDisputes,
    // Resolved this month
    wonThisMonth,
    lostThisMonth,
    // All-time stats
    allTimeStats,
    // Blocked subscribers
    blockedCount
  ] = await Promise.all([
    db.payment.count({ where: { status: 'disputed' } }),
    db.payment.count({ where: { status: 'dispute_won', createdAt: { gte: startOfMonth } } }),
    db.payment.count({ where: { status: 'dispute_lost', createdAt: { gte: startOfMonth } } }),
    db.payment.groupBy({
      by: ['status'],
      where: { status: { in: ['disputed', 'dispute_won', 'dispute_lost'] } },
      _count: true,
      _sum: { amountCents: true }
    }),
    db.user.count({ where: { blockedReason: { not: null } } })
  ])

  const statsMap = Object.fromEntries(
    allTimeStats.map(s => [s.status, { count: s._count, amountCents: Math.abs(s._sum.amountCents || 0) }])
  )

  const totalDisputes = (statsMap['disputed']?.count || 0) + (statsMap['dispute_won']?.count || 0) + (statsMap['dispute_lost']?.count || 0)
  const totalResolved = (statsMap['dispute_won']?.count || 0) + (statsMap['dispute_lost']?.count || 0)
  const winRate = totalResolved > 0 ? ((statsMap['dispute_won']?.count || 0) / totalResolved * 100).toFixed(1) : '0'

  return c.json({
    current: {
      open: openDisputes,
      blockedSubscribers: blockedCount
    },
    thisMonth: {
      won: wonThisMonth,
      lost: lostThisMonth
    },
    allTime: {
      total: totalDisputes,
      open: statsMap['disputed']?.count || 0,
      won: statsMap['dispute_won']?.count || 0,
      lost: statsMap['dispute_lost']?.count || 0,
      winRate: `${winRate}%`,
      totalAmountCents: (statsMap['disputed']?.amountCents || 0) + (statsMap['dispute_won']?.amountCents || 0) + (statsMap['dispute_lost']?.amountCents || 0)
    }
  })
})

/**
 * GET /admin/disputes
 * List all disputes with full details
 */
admin.get('/disputes', async (c) => {
  const query = z.object({
    status: z.enum(['all', 'disputed', 'dispute_won', 'dispute_lost']).default('all'),
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(50)
  }).parse(c.req.query())

  const skip = (query.page - 1) * query.limit
  const where: any = {
    status: query.status === 'all'
      ? { in: ['disputed', 'dispute_won', 'dispute_lost'] }
      : query.status
  }

  const [disputes, total] = await Promise.all([
    db.payment.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        subscription: {
          include: {
            creator: { select: { id: true, email: true, profile: { select: { username: true, displayName: true } } } },
            subscriber: { select: { id: true, email: true, disputeCount: true, blockedReason: true } }
          }
        }
      }
    }),
    db.payment.count({ where })
  ])

  return c.json({
    disputes: disputes.map(d => ({
      id: d.id,
      status: d.status,
      amountCents: Math.abs(d.amountCents),
      currency: d.currency,
      provider: d.stripeDisputeId ? 'stripe' : d.paystackDisputeId ? 'paystack' : 'unknown',
      stripeDisputeId: d.stripeDisputeId,
      paystackDisputeId: d.paystackDisputeId,
      creator: d.subscription?.creator ? {
        id: d.subscription.creator.id,
        email: d.subscription.creator.email,
        username: d.subscription.creator.profile?.username,
        displayName: d.subscription.creator.profile?.displayName
      } : null,
      subscriber: d.subscription?.subscriber ? {
        id: d.subscription.subscriber.id,
        email: d.subscription.subscriber.email,
        disputeCount: d.subscription.subscriber.disputeCount,
        isBlocked: !!d.subscription.subscriber.blockedReason
      } : null,
      subscriptionId: d.subscriptionId,
      createdAt: d.createdAt
    })),
    total,
    page: query.page,
    totalPages: Math.ceil(total / query.limit)
  })
})

/**
 * GET /admin/blocked-subscribers
 * List subscribers blocked due to disputes
 */
admin.get('/blocked-subscribers', async (c) => {
  const query = z.object({
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(50)
  }).parse(c.req.query())

  const skip = (query.page - 1) * query.limit

  const [users, total] = await Promise.all([
    db.user.findMany({
      where: { blockedReason: { not: null } },
      skip,
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        disputeCount: true,
        blockedReason: true,
        createdAt: true,
        subscribedTo: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            creator: { select: { email: true, profile: { select: { username: true } } } }
          }
        }
      }
    }),
    db.user.count({ where: { blockedReason: { not: null } } })
  ])

  return c.json({
    blockedSubscribers: users.map(u => ({
      id: u.id,
      email: u.email,
      disputeCount: u.disputeCount,
      blockedReason: u.blockedReason,
      createdAt: u.createdAt,
      recentSubscriptions: u.subscribedTo.map((s: { id: string; status: string; creator: { email: string; profile: { username: string } | null } }) => ({
        id: s.id,
        status: s.status,
        creatorEmail: s.creator.email,
        creatorUsername: s.creator.profile?.username
      }))
    })),
    total,
    page: query.page,
    totalPages: Math.ceil(total / query.limit)
  })
})

/**
 * POST /admin/blocked-subscribers/:id/unblock
 * Unblock a subscriber (use with caution)
 */
admin.post('/blocked-subscribers/:id/unblock', async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json().catch(() => ({}))
  const reason = body.reason || 'Unblocked by admin'

  const user = await db.user.findUnique({
    where: { id },
    select: { blockedReason: true, disputeCount: true }
  })

  if (!user) return c.json({ error: 'User not found' }, 404)
  if (!user.blockedReason) return c.json({ error: 'User is not blocked' }, 400)

  await db.user.update({
    where: { id },
    data: {
      blockedReason: null,
      // Note: We keep disputeCount for history - they can be re-blocked if they dispute again
    }
  })

  await db.activity.create({
    data: {
      userId: id,
      type: 'admin_unblock_subscriber',
      payload: {
        previousBlockReason: user.blockedReason,
        disputeCount: user.disputeCount,
        unblockReason: reason,
        unblockedAt: new Date().toISOString()
      }
    }
  })

  return c.json({
    success: true,
    message: 'Subscriber unblocked',
    warning: user.disputeCount >= 2
      ? 'This user has multiple disputes on record. They will be re-blocked if they file another dispute.'
      : null
  })
})

// ============================================
// STRIPE CONNECT VISIBILITY
// ============================================

/**
 * GET /admin/stripe/accounts
 * List all Stripe Connect accounts with their status
 */
admin.get('/stripe/accounts', async (c) => {
  const query = z.object({
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(50),
    status: z.enum(['all', 'active', 'pending', 'restricted', 'disabled']).default('all')
  }).parse(c.req.query())

  const skip = (query.page - 1) * query.limit

  // Get all profiles with Stripe accounts
  const profiles = await db.profile.findMany({
    where: {
      stripeAccountId: { not: null },
      ...(query.status !== 'all' && { payoutStatus: query.status })
    },
    skip,
    take: query.limit,
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { email: true, createdAt: true } }
    }
  })

  // Fetch live Stripe data for each account
  const accountsWithStripeData = await Promise.all(
    profiles.map(async (p) => {
      try {
        const account = await stripe.accounts.retrieve(p.stripeAccountId!)
        return {
          // Local data
          userId: p.userId,
          email: p.user.email,
          username: p.username,
          displayName: p.displayName,
          country: p.country,
          currency: p.currency,
          localPayoutStatus: p.payoutStatus,
          createdAt: p.createdAt,
          // Stripe data
          stripeAccountId: p.stripeAccountId,
          stripeStatus: {
            chargesEnabled: account.charges_enabled,
            payoutsEnabled: account.payouts_enabled,
            detailsSubmitted: account.details_submitted,
            type: account.type,
            country: account.country,
            defaultCurrency: account.default_currency,
            capabilities: account.capabilities,
            requirements: {
              currentlyDue: account.requirements?.currently_due || [],
              eventuallyDue: account.requirements?.eventually_due || [],
              pastDue: account.requirements?.past_due || [],
              pendingVerification: account.requirements?.pending_verification || [],
              disabledReason: account.requirements?.disabled_reason
            }
          }
        }
      } catch (err: any) {
        return {
          userId: p.userId,
          email: p.user.email,
          username: p.username,
          displayName: p.displayName,
          country: p.country,
          currency: p.currency,
          localPayoutStatus: p.payoutStatus,
          createdAt: p.createdAt,
          stripeAccountId: p.stripeAccountId,
          stripeStatus: null,
          stripeError: err.message
        }
      }
    })
  )

  const total = await db.profile.count({
    where: {
      stripeAccountId: { not: null },
      ...(query.status !== 'all' && { payoutStatus: query.status })
    }
  })

  return c.json({
    accounts: accountsWithStripeData,
    total,
    page: query.page,
    totalPages: Math.ceil(total / query.limit)
  })
})

/**
 * GET /admin/stripe/accounts/:accountId
 * Get detailed Stripe account info
 */
admin.get('/stripe/accounts/:accountId', async (c) => {
  const { accountId } = c.req.param()

  try {
    const account = await stripe.accounts.retrieve(accountId)

    // Get local profile data
    const profile = await db.profile.findFirst({
      where: { stripeAccountId: accountId },
      include: { user: { select: { email: true } } }
    })

    // Get balance for this connected account
    const balance = await stripe.balance.retrieve({ stripeAccount: accountId })

    // Get recent payouts
    const payouts = await stripe.payouts.list({ limit: 10 }, { stripeAccount: accountId })

    return c.json({
      local: profile ? {
        userId: profile.userId,
        email: profile.user.email,
        username: profile.username,
        displayName: profile.displayName,
        country: profile.country,
        currency: profile.currency,
        payoutStatus: profile.payoutStatus
      } : null,
      stripe: {
        id: account.id,
        type: account.type,
        country: account.country,
        defaultCurrency: account.default_currency,
        email: account.email,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
        created: account.created ? new Date(account.created * 1000).toISOString() : null,
        capabilities: account.capabilities,
        requirements: account.requirements,
        settings: {
          payoutSchedule: account.settings?.payouts?.schedule,
          statementDescriptor: account.settings?.payments?.statement_descriptor
        }
      },
      balance: {
        available: balance.available.map(b => ({ amount: b.amount, currency: b.currency })),
        pending: balance.pending.map(b => ({ amount: b.amount, currency: b.currency })),
        instantAvailable: balance.instant_available?.map(b => ({ amount: b.amount, currency: b.currency }))
      },
      recentPayouts: payouts.data.map(p => ({
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        arrivalDate: new Date(p.arrival_date * 1000).toISOString(),
        created: new Date(p.created * 1000).toISOString(),
        method: p.method,
        type: p.type,
        failureCode: p.failure_code,
        failureMessage: p.failure_message
      }))
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

/**
 * GET /admin/stripe/transfers
 * List recent transfers to connected accounts
 */
admin.get('/stripe/transfers', async (c) => {
  const query = z.object({
    limit: z.coerce.number().default(50),
    startingAfter: z.string().optional()
  }).parse(c.req.query())

  try {
    const transfers = await stripe.transfers.list({
      limit: query.limit,
      ...(query.startingAfter && { starting_after: query.startingAfter })
    })

    // Get local profile data for each destination
    const destinationIds = [...new Set(transfers.data.map(t => t.destination as string))]
    const profiles = await db.profile.findMany({
      where: { stripeAccountId: { in: destinationIds } },
      select: { stripeAccountId: true, username: true, displayName: true, user: { select: { email: true } } }
    })
    const profileMap = new Map(profiles.map(p => [p.stripeAccountId, p]))

    return c.json({
      transfers: transfers.data.map(t => {
        const profile = profileMap.get(t.destination as string)
        return {
          id: t.id,
          amount: t.amount,
          currency: t.currency,
          created: new Date(t.created * 1000).toISOString(),
          destination: t.destination,
          destinationPayment: t.destination_payment,
          reversed: t.reversed,
          sourceTransaction: t.source_transaction,
          // Local data
          creator: profile ? {
            username: profile.username,
            displayName: profile.displayName,
            email: profile.user.email
          } : null
        }
      }),
      hasMore: transfers.has_more,
      nextCursor: transfers.data.length > 0 ? transfers.data[transfers.data.length - 1].id : null
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

/**
 * GET /admin/stripe/balance
 * Get platform Stripe balance
 */
admin.get('/stripe/balance', async (c) => {
  try {
    const balance = await stripe.balance.retrieve()

    return c.json({
      available: balance.available.map(b => ({ amount: b.amount, currency: b.currency })),
      pending: balance.pending.map(b => ({ amount: b.amount, currency: b.currency })),
      connectReserved: balance.connect_reserved?.map(b => ({ amount: b.amount, currency: b.currency })),
      instantAvailable: balance.instant_available?.map(b => ({ amount: b.amount, currency: b.currency }))
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

/**
 * GET /admin/stripe/events
 * List recent Stripe webhook events
 */
admin.get('/stripe/events', async (c) => {
  const query = z.object({
    limit: z.coerce.number().default(50),
    type: z.string().optional(),
    startingAfter: z.string().optional()
  }).parse(c.req.query())

  try {
    const events = await stripe.events.list({
      limit: query.limit,
      ...(query.type && { type: query.type }),
      ...(query.startingAfter && { starting_after: query.startingAfter })
    })

    return c.json({
      events: events.data.map(e => ({
        id: e.id,
        type: e.type,
        created: new Date(e.created * 1000).toISOString(),
        livemode: e.livemode,
        pendingWebhooks: e.pending_webhooks,
        request: e.request,
        // Include key data fields based on event type
        data: {
          objectType: (e.data.object as any)?.object,
          objectId: (e.data.object as any)?.id,
          amount: (e.data.object as any)?.amount,
          currency: (e.data.object as any)?.currency,
          status: (e.data.object as any)?.status,
          customer: (e.data.object as any)?.customer
        }
      })),
      hasMore: events.has_more,
      nextCursor: events.data.length > 0 ? events.data[events.data.length - 1].id : null
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

/**
 * GET /admin/stripe/customers/:customerId
 * Get Stripe customer details
 */
admin.get('/stripe/customers/:customerId', async (c) => {
  const { customerId } = c.req.param()

  try {
    const customer = await stripe.customers.retrieve(customerId, {
      expand: ['subscriptions', 'sources', 'invoice_settings.default_payment_method']
    }) as any

    // Find local subscription
    const subscription = await db.subscription.findFirst({
      where: { stripeCustomerId: customerId },
      include: {
        subscriber: { select: { email: true } },
        creator: { select: { email: true, profile: { select: { username: true } } } }
      }
    })

    return c.json({
      local: subscription ? {
        subscriptionId: subscription.id,
        subscriberEmail: subscription.subscriber?.email,
        creatorEmail: subscription.creator.email,
        creatorUsername: subscription.creator.profile?.username,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd
      } : null,
      stripe: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        created: new Date(customer.created * 1000).toISOString(),
        currency: customer.currency,
        defaultPaymentMethod: customer.invoice_settings?.default_payment_method ? {
          id: customer.invoice_settings.default_payment_method.id,
          type: customer.invoice_settings.default_payment_method.type,
          card: customer.invoice_settings.default_payment_method.card ? {
            brand: customer.invoice_settings.default_payment_method.card.brand,
            last4: customer.invoice_settings.default_payment_method.card.last4,
            expMonth: customer.invoice_settings.default_payment_method.card.exp_month,
            expYear: customer.invoice_settings.default_payment_method.card.exp_year
          } : null
        } : null,
        subscriptions: customer.subscriptions?.data?.map((s: any) => ({
          id: s.id,
          status: s.status,
          currentPeriodEnd: new Date(s.current_period_end * 1000).toISOString(),
          cancelAtPeriodEnd: s.cancel_at_period_end,
          plan: s.items?.data?.[0]?.price ? {
            amount: s.items.data[0].price.unit_amount,
            currency: s.items.data[0].price.currency,
            interval: s.items.data[0].price.recurring?.interval
          } : null
        })) || []
      }
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// ============================================
// SUBSCRIPTION ACTIONS
// ============================================

/**
 * POST /admin/subscriptions/:id/pause
 * Pause a subscription (stop billing but keep active)
 */
admin.post('/subscriptions/:id/pause', async (c) => {
  const { id } = c.req.param()

  const subscription = await db.subscription.findUnique({
    where: { id },
    select: { id: true, status: true, stripeSubscriptionId: true, creatorId: true }
  })

  if (!subscription) return c.json({ error: 'Subscription not found' }, 404)
  if (subscription.status !== 'active') return c.json({ error: 'Can only pause active subscriptions' }, 400)

  try {
    if (subscription.stripeSubscriptionId) {
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        pause_collection: { behavior: 'void' }
      })
    }

    await db.subscription.update({
      where: { id },
      data: { status: 'paused' }
    })

    await db.activity.create({
      data: {
        userId: subscription.creatorId,
        type: 'admin_subscription_paused',
        payload: { subscriptionId: id }
      }
    })

    return c.json({ success: true, message: 'Subscription paused' })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

/**
 * POST /admin/subscriptions/:id/resume
 * Resume a paused subscription
 */
admin.post('/subscriptions/:id/resume', async (c) => {
  const { id } = c.req.param()

  const subscription = await db.subscription.findUnique({
    where: { id },
    select: { id: true, status: true, stripeSubscriptionId: true, creatorId: true }
  })

  if (!subscription) return c.json({ error: 'Subscription not found' }, 404)
  if (subscription.status !== 'paused') return c.json({ error: 'Subscription is not paused' }, 400)

  try {
    if (subscription.stripeSubscriptionId) {
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        pause_collection: '' as any // Empty string clears the pause
      })
    }

    await db.subscription.update({
      where: { id },
      data: { status: 'active' }
    })

    await db.activity.create({
      data: {
        userId: subscription.creatorId,
        type: 'admin_subscription_resumed',
        payload: { subscriptionId: id }
      }
    })

    return c.json({ success: true, message: 'Subscription resumed' })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

/**
 * POST /admin/stripe/accounts/:accountId/payout
 * Trigger immediate payout to a connected account
 */
admin.post('/stripe/accounts/:accountId/payout', adminSensitiveRateLimit, async (c) => {
  const { accountId } = c.req.param()
  const body = z.object({
    amount: z.number().optional(), // If not specified, payout all available
    currency: z.string().default('usd')
  }).parse(await c.req.json().catch(() => ({})))

  try {
    // Get balance for this connected account
    const balance = await stripe.balance.retrieve({ stripeAccount: accountId })
    const available = balance.available.find(b => b.currency === body.currency)

    if (!available || available.amount <= 0) {
      return c.json({ error: 'No available balance to payout' }, 400)
    }

    const amount = body.amount || available.amount

    const payout = await stripe.payouts.create({
      amount,
      currency: body.currency,
      method: 'standard'
    }, { stripeAccount: accountId })

    // Log the action
    const profile = await db.profile.findFirst({
      where: { stripeAccountId: accountId }
    })
    if (profile) {
      await db.activity.create({
        data: {
          userId: profile.userId,
          type: 'admin_payout_triggered',
          payload: { payoutId: payout.id, amount: payout.amount, currency: payout.currency }
        }
      })
    }

    return c.json({
      success: true,
      payout: {
        id: payout.id,
        amount: payout.amount,
        currency: payout.currency,
        status: payout.status,
        arrivalDate: new Date(payout.arrival_date * 1000).toISOString()
      }
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

/**
 * POST /admin/stripe/accounts/:accountId/disable-payouts
 * Disable payouts for a connected account (fraud prevention)
 */
admin.post('/stripe/accounts/:accountId/disable-payouts', async (c) => {
  const { accountId } = c.req.param()
  const body = z.object({
    reason: z.string()
  }).parse(await c.req.json())

  try {
    // Update the account to disable payouts
    await stripe.accounts.update(accountId, {
      settings: {
        payouts: { schedule: { interval: 'manual' as const } }
      }
    })

    // Update local status
    await db.profile.updateMany({
      where: { stripeAccountId: accountId },
      data: { payoutStatus: 'disabled' }
    })

    // Log the action
    const profile = await db.profile.findFirst({
      where: { stripeAccountId: accountId }
    })
    if (profile) {
      await db.activity.create({
        data: {
          userId: profile.userId,
          type: 'admin_payouts_disabled',
          payload: { reason: body.reason }
        }
      })
    }

    return c.json({ success: true, message: 'Payouts disabled for account' })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

/**
 * POST /admin/stripe/accounts/:accountId/enable-payouts
 * Re-enable payouts for a connected account
 */
admin.post('/stripe/accounts/:accountId/enable-payouts', async (c) => {
  const { accountId } = c.req.param()

  try {
    // Update the account to enable automatic payouts
    await stripe.accounts.update(accountId, {
      settings: {
        payouts: { schedule: { interval: 'daily' as const } }
      }
    })

    // Update local status
    await db.profile.updateMany({
      where: { stripeAccountId: accountId },
      data: { payoutStatus: 'active' }
    })

    // Log the action
    const profile = await db.profile.findFirst({
      where: { stripeAccountId: accountId }
    })
    if (profile) {
      await db.activity.create({
        data: {
          userId: profile.userId,
          type: 'admin_payouts_enabled',
          payload: {}
        }
      })
    }

    return c.json({ success: true, message: 'Payouts enabled for account' })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// ============================================
// SUPPORT TICKETS (Admin)
// ============================================

/**
 * GET /admin/support/tickets/stats
 * Support ticket statistics
 */
admin.get('/support/tickets/stats', async (c) => {
  const now = new Date()
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const [open, inProgress, newLast24h, resolvedLast7d, byCategory, byPriority] = await Promise.all([
    db.supportTicket.count({ where: { status: 'open' } }),
    db.supportTicket.count({ where: { status: 'in_progress' } }),
    db.supportTicket.count({ where: { createdAt: { gte: last24h } } }),
    db.supportTicket.count({ where: { status: 'resolved', resolvedAt: { gte: last7d } } }),
    db.supportTicket.groupBy({
      by: ['category'],
      where: { status: { in: ['open', 'in_progress'] } },
      _count: true
    }),
    db.supportTicket.groupBy({
      by: ['priority'],
      where: { status: { in: ['open', 'in_progress'] } },
      _count: true
    })
  ])

  return c.json({
    current: {
      open,
      inProgress,
      total: open + inProgress
    },
    newLast24h,
    resolvedLast7d,
    byCategory: byCategory.map(c => ({ category: c.category, count: c._count })),
    byPriority: byPriority.map(p => ({ priority: p.priority, count: p._count }))
  })
})

/**
 * GET /admin/support/tickets
 * List all support tickets
 */
admin.get('/support/tickets', async (c) => {
  const query = z.object({
    status: z.enum(['open', 'in_progress', 'resolved', 'closed', 'all']).default('all'),
    priority: z.enum(['low', 'normal', 'high', 'urgent', 'all']).default('all'),
    category: z.enum(['general', 'billing', 'technical', 'account', 'payout', 'dispute', 'all']).default('all'),
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(50)
  }).parse(c.req.query())

  const skip = (query.page - 1) * query.limit
  const where: any = {}

  if (query.status !== 'all') where.status = query.status
  if (query.priority !== 'all') where.priority = query.priority
  if (query.category !== 'all') where.category = query.category

  const [tickets, total] = await Promise.all([
    db.supportTicket.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: [
        { priority: 'desc' }, // Urgent first
        { createdAt: 'desc' }
      ],
      include: {
        _count: { select: { messages: true } }
      }
    }),
    db.supportTicket.count({ where })
  ])

  return c.json({
    tickets: tickets.map(t => ({
      id: t.id,
      email: t.email,
      name: t.name,
      userId: t.userId,
      category: t.category,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      assignedTo: t.assignedTo,
      messageCount: t._count.messages,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      resolvedAt: t.resolvedAt
    })),
    total,
    page: query.page,
    totalPages: Math.ceil(total / query.limit)
  })
})

/**
 * GET /admin/support/tickets/:id
 * Get ticket details with full message thread
 */
admin.get('/support/tickets/:id', async (c) => {
  const { id } = c.req.param()

  const ticket = await db.supportTicket.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: 'asc' } }
    }
  })

  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  return c.json({ ticket })
})

/**
 * PATCH /admin/support/tickets/:id
 * Update ticket status, priority, assignment, or notes
 */
admin.patch('/support/tickets/:id', async (c) => {
  const { id } = c.req.param()
  const body = z.object({
    status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
    priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    assignedTo: z.string().nullable().optional(),
    adminNotes: z.string().nullable().optional()
  }).parse(await c.req.json())

  const ticket = await db.supportTicket.findUnique({ where: { id } })
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  const updateData: any = { ...body }

  // Set resolvedAt when resolving
  if (body.status === 'resolved' && ticket.status !== 'resolved') {
    updateData.resolvedAt = new Date()
  }

  const updated = await db.supportTicket.update({
    where: { id },
    data: updateData
  })

  return c.json({ success: true, ticket: updated })
})

/**
 * POST /admin/support/tickets/:id/reply
 * Add an admin reply to a ticket
 */
admin.post('/support/tickets/:id/reply', async (c) => {
  const { id } = c.req.param()
  const body = z.object({
    message: z.string().min(1).max(5000)
  }).parse(await c.req.json())

  const ticket = await db.supportTicket.findUnique({ where: { id } })
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  // Get admin email for sender name
  const userId = c.get('userId') as string | undefined
  let senderName = 'NatePay Support'
  if (userId) {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { email: true }
    })
    if (user) senderName = user.email
  }

  // Add the message
  const message = await db.supportMessage.create({
    data: {
      ticketId: id,
      isAdmin: true,
      senderName,
      message: body.message
    }
  })

  // Mark ticket as in_progress if it was open
  if (ticket.status === 'open') {
    await db.supportTicket.update({
      where: { id },
      data: { status: 'in_progress' }
    })
  }

  // Send email notification to user (fire and forget)
  sendSupportTicketReplyEmail(ticket.email, ticket.subject, body.message).catch((err) => {
    console.error('[admin] Failed to send support reply email:', err)
  })

  return c.json({ success: true, message })
})

/**
 * POST /admin/support/tickets/:id/resolve
 * Resolve a ticket with a resolution note
 */
admin.post('/support/tickets/:id/resolve', async (c) => {
  const { id } = c.req.param()
  const body = z.object({
    resolution: z.string().min(1).max(1000),
    sendReply: z.boolean().default(true), // Optionally send resolution as final reply
    replyMessage: z.string().optional()
  }).parse(await c.req.json())

  const ticket = await db.supportTicket.findUnique({ where: { id } })
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404)

  // Add resolution reply if requested
  if (body.sendReply && body.replyMessage) {
    await db.supportMessage.create({
      data: {
        ticketId: id,
        isAdmin: true,
        senderName: 'NatePay Support',
        message: body.replyMessage
      }
    })
  }

  // Resolve the ticket
  const updated = await db.supportTicket.update({
    where: { id },
    data: {
      status: 'resolved',
      resolution: body.resolution,
      resolvedAt: new Date()
    }
  })

  return c.json({ success: true, ticket: updated })
})

// ============================================
// CONCIERGE CREATOR CREATION (Admin-Created Accounts)
// ============================================

// Country to currency mapping
const COUNTRY_CURRENCY_MAP: Record<PaystackCountry, { currency: string; countryName: string }> = {
  NG: { currency: 'NGN', countryName: 'Nigeria' },
  KE: { currency: 'KES', countryName: 'Kenya' },
  ZA: { currency: 'ZAR', countryName: 'South Africa' },
}

/**
 * GET /admin/paystack/banks/:country
 * List banks for a Paystack-supported country
 */
admin.get('/paystack/banks/:country', async (c) => {
  const country = c.req.param('country').toUpperCase()

  if (!isPaystackSupported(country)) {
    return c.json({ error: 'Country not supported. Use NG, KE, or ZA.' }, 400)
  }

  try {
    const banks = await listBanks(country as PaystackCountry)
    return c.json({
      banks: banks.map(b => ({
        code: b.code,
        name: b.name,
        type: b.type,
      }))
    })
  } catch (err: any) {
    return c.json({ error: err.message || 'Failed to fetch banks' }, 500)
  }
})

/**
 * POST /admin/paystack/resolve-account
 * Resolve/validate a bank account (NG/ZA only - Kenya doesn't support this)
 */
admin.post('/paystack/resolve-account', async (c) => {
  const body = z.object({
    country: z.enum(['NG', 'KE', 'ZA']),
    bankCode: z.string().min(1),
    accountNumber: z.string().min(9).max(20),
  }).parse(await c.req.json())

  // Kenya doesn't support account resolution
  if (body.country === 'KE') {
    return c.json({
      supported: false,
      message: 'Kenya does not support account resolution. Account will be validated on first payout.',
    })
  }

  try {
    const resolved = await resolveAccount(body.accountNumber, body.bankCode)
    return c.json({
      supported: true,
      accountName: resolved.account_name,
      accountNumber: resolved.account_number,
    })
  } catch (err: any) {
    return c.json({ error: err.message || 'Could not resolve account' }, 400)
  }
})

/**
 * POST /admin/users/create-creator
 * Create a fully-functional creator account (Paystack countries only)
 * Admin enters all details, creator receives ready-to-use payment link
 */
admin.post('/users/create-creator', async (c) => {
  const body = z.object({
    email: z.string().email(),
    displayName: z.string().min(2).max(50),
    username: z.string().min(3).max(20).regex(/^[a-z0-9_]+$/i, 'Username can only contain letters, numbers, and underscores'),
    country: z.enum(['NG', 'KE', 'ZA']),
    bankCode: z.string().min(1),
    accountNumber: z.string().min(9).max(20),
    accountName: z.string().min(1).max(100).optional(), // Pre-resolved name for NG/ZA
    amount: z.number().positive(), // In major units (e.g., 500 for ₦500)
  }).parse(await c.req.json())

  const username = body.username.toLowerCase()
  const countryInfo = COUNTRY_CURRENCY_MAP[body.country]

  // Check reserved usernames
  if (RESERVED_USERNAMES.includes(username)) {
    return c.json({ error: 'This username is reserved' }, 400)
  }

  // Check username availability
  const existingUsername = await db.profile.findUnique({ where: { username } })
  if (existingUsername) {
    return c.json({ error: 'Username is already taken' }, 400)
  }

  // Check email availability
  const existingEmail = await db.user.findUnique({ where: { email: body.email.toLowerCase() } })
  if (existingEmail) {
    return c.json({ error: 'An account with this email already exists' }, 400)
  }

  // Convert amount to cents
  const amountCents = displayAmountToCents(body.amount, countryInfo.currency)

  try {
    // Create user and profile in transaction
    const result = await db.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: {
          email: body.email.toLowerCase(),
          onboardingStep: 7, // Completed onboarding
        },
      })

      // Create profile with minimum required fields
      const profile = await tx.profile.create({
        data: {
          userId: user.id,
          username,
          displayName: body.displayName,
          country: countryInfo.countryName,
          countryCode: body.country,
          currency: countryInfo.currency,
          purpose: 'support', // Default purpose
          pricingModel: 'single',
          singleAmount: amountCents,
          feeMode: 'split', // 4%/4% split fee model
          paymentProvider: 'paystack',
          payoutStatus: 'pending', // Will be set to 'active' after subaccount creation
        },
      })

      return { user, profile }
    })

    // Create Paystack subaccount
    try {
      await createSubaccount({
        userId: result.user.id,
        businessName: body.displayName,
        bankCode: body.bankCode,
        accountNumber: body.accountNumber,
        email: body.email.toLowerCase(),
        purpose: 'personal', // Maps to 8% fee
      })
    } catch (err: any) {
      // Rollback: delete user and profile if subaccount creation fails
      await db.user.delete({ where: { id: result.user.id } })
      throw new Error(`Paystack error: ${err.message}`)
    }

    // Generate payment link
    const paymentLink = `${env.PUBLIC_PAGE_URL}/${username}`

    // Send welcome email (fire and forget)
    sendCreatorAccountCreatedEmail(
      body.email.toLowerCase(),
      body.displayName,
      username,
      paymentLink,
      body.amount,
      countryInfo.currency
    ).catch((err) => {
      console.error('[admin] Failed to send creator account email:', err)
    })

    // Log the admin action
    const adminUserId = c.get('userId') as string | undefined
    if (adminUserId) {
      await db.activity.create({
        data: {
          userId: result.user.id,
          type: 'admin_create_creator',
          payload: {
            createdBy: adminUserId,
            username,
            country: body.country,
          },
        },
      })
    }

    return c.json({
      success: true,
      user: {
        id: result.user.id,
        email: result.user.email,
        username,
        displayName: body.displayName,
        paymentLink,
      },
      message: `Creator account created successfully. Payment link: ${paymentLink}`,
    })
  } catch (err: any) {
    console.error('[admin] Failed to create creator:', err)
    return c.json({ error: err.message || 'Failed to create creator account' }, 500)
  }
})

export default admin
