/**
 * Admin System Controller
 *
 * System health, monitoring, and operational routes.
 * Includes: health, webhooks, transfers, reconciliation, dashboard stats,
 * activity feed, system logs, reminders, emails, invoices.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import dlq from '../../services/dlq.js'
import { db } from '../../db/client.js'
import { stripe } from '../../services/stripe.js'
import { getStuckTransfers, getTransferStats } from '../../jobs/transfers.js'
import { getMissingTransactions, reconcilePaystackTransactions } from '../../jobs/reconciliation.js'
import { checkEmailHealth, sendTestEmail } from '../../services/email.js'
import { isSmsEnabled, sendVerificationSms } from '../../services/sms.js'
import { env } from '../../config/env.js'
import { handleInvoicePaid } from '../webhooks/stripe/invoice.js'
import { todayStart, thisMonthStart, lastNDays } from '../../utils/timezone.js'
import { adminSensitiveRateLimit } from '../../middleware/rateLimit.js'
import { getSessionToken, isAdminRole, requireRole, logAdminAction } from '../../middleware/adminAuth.js'
import { validateSession } from '../../services/auth.js'

import { redis } from '../../db/redis.js'

const system = new Hono()

// Redis key for distributed reconciliation lock
const RECONCILIATION_LOCK_KEY = 'admin:reconciliation:lock'
const RECONCILIATION_LOCK_TTL = 300 // 5 minutes max lock duration

// Acquire distributed lock for reconciliation
async function acquireReconciliationLock(): Promise<boolean> {
  // SET NX with expiry - atomic operation
  const result = await redis.set(RECONCILIATION_LOCK_KEY, Date.now().toString(), 'EX', RECONCILIATION_LOCK_TTL, 'NX')
  return result === 'OK'
}

// Release distributed lock
async function releaseReconciliationLock(): Promise<void> {
  await redis.del(RECONCILIATION_LOCK_KEY)
}

// ============================================
// ADMIN STATUS CHECK
// ============================================

/**
 * GET /admin/me
 * Check if current user is an admin
 */
system.get('/me', async (c) => {
  try {
    const sessionToken = getSessionToken(c)
    if (!sessionToken) {
      return c.json({ isAdmin: false })
    }

    const session = await validateSession(sessionToken)
    if (!session) {
      return c.json({ isAdmin: false })
    }

    const user = await db.user.findUnique({
      where: { id: session.userId },
      select: { email: true, role: true },
    })

    if (user && isAdminRole(user.role)) {
      return c.json({ isAdmin: true, email: user.email, role: user.role })
    }

    return c.json({ isAdmin: false })
  } catch (err) {
    console.error('[admin/me] Error:', err)
    return c.json({ isAdmin: false })
  }
})

// ============================================
// HEALTH & DIAGNOSTICS
// ============================================

/**
 * GET /admin/health
 * System health check
 */
system.get('/health', async (c) => {
  try {
    await db.$queryRaw`SELECT 1`
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
system.get('/email/health', async (c) => {
  const health = await checkEmailHealth()
  return c.json({
    healthy: health.healthy,
    error: health.error,
    timestamp: new Date().toISOString(),
  }, health.healthy ? 200 : 503)
})

/**
 * POST /admin/email/test
 * Send a test email
 */
system.post('/email/test', async (c) => {
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

// ============================================
// SMS HEALTH & TESTING
// ============================================

/**
 * GET /admin/sms/health
 * SMS service health check
 */
system.get('/sms/health', async (c) => {
  const enabled = isSmsEnabled()
  const configured = !!(env.BIRD_ACCESS_KEY && env.BIRD_WORKSPACE_ID && env.BIRD_CHANNEL_ID)

  return c.json({
    enabled: env.ENABLE_SMS,
    configured,
    ready: enabled,
    config: {
      hasAccessKey: !!env.BIRD_ACCESS_KEY,
      hasWorkspaceId: !!env.BIRD_WORKSPACE_ID,
      hasChannelId: !!env.BIRD_CHANNEL_ID,
      senderId: env.BIRD_SENDER_ID || 'NatePay',
    },
    timestamp: new Date().toISOString(),
  })
})

/**
 * POST /admin/sms/test
 * Send a test SMS
 */
system.post('/sms/test', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const to = body.to

  if (!to || typeof to !== 'string') {
    return c.json({ error: 'Phone number required in "to" field (E.164 format, e.g., +2348012345678)' }, 400)
  }

  // Basic E.164 validation
  if (!to.startsWith('+') || to.length < 10) {
    return c.json({ error: 'Phone must be in E.164 format (e.g., +2348012345678)' }, 400)
  }

  if (!isSmsEnabled()) {
    return c.json({
      error: 'SMS is not enabled. Set ENABLE_SMS=true and configure BIRD_ACCESS_KEY, BIRD_WORKSPACE_ID, BIRD_CHANNEL_ID',
      enabled: env.ENABLE_SMS,
      configured: !!(env.BIRD_ACCESS_KEY && env.BIRD_WORKSPACE_ID && env.BIRD_CHANNEL_ID),
    }, 400)
  }

  try {
    // Send a test verification code
    const testCode = '123456'
    await sendVerificationSms(to, testCode)

    await logAdminAction(c, 'sms_test_sent', { to: to.slice(0, 6) + '****' })

    return c.json({
      success: true,
      message: `Test SMS sent to ${to.slice(0, 6)}****`,
    })
  } catch (error: any) {
    console.error('[admin/sms/test] Error:', error)
    return c.json({
      success: false,
      error: error.message || 'Failed to send SMS',
    }, 500)
  }
})

/**
 * GET /admin/metrics
 * Basic platform metrics
 */
system.get('/metrics', async (c) => {
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

/**
 * GET /admin/dashboard
 * Dashboard stats
 */
system.get('/dashboard', async (c) => {
  const startOfDay = todayStart()
  const startOfMonth = thisMonthStart()

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
      where: { status: 'succeeded', type: 'recurring', occurredAt: { gte: startOfMonth } },
      _sum: { feeCents: true }
    }),
    db.payment.count({ where: { status: 'disputed' } }),
    db.payment.count({ where: { status: 'failed', occurredAt: { gte: startOfDay } } })
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
// WEBHOOK MONITORING
// ============================================

/**
 * GET /admin/webhooks/stats
 * Webhook processing status
 */
system.get('/webhooks/stats', async (c) => {
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
system.get('/webhooks/failed', async (c) => {
  const rawEvents = await dlq.getFailedWebhooksForRetry()
  const events = rawEvents.map(event => ({
    id: event.id,
    provider: event.provider,
    type: event.eventType,
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
system.get('/webhooks/dead-letter', async (c) => {
  const events = await dlq.getDeadLetterWebhooks()
  return c.json({ events })
})

/**
 * GET /admin/webhooks/all
 * List ALL webhook events
 */
system.get('/webhooks/all', async (c) => {
  const query = z.object({
    limit: z.coerce.number().min(1).max(200).default(50),
    provider: z.enum(['stripe', 'paystack', 'all']).default('all'),
    status: z.enum(['received', 'processing', 'processed', 'failed', 'skipped', 'dead_letter', 'all']).default('all'),
  }).parse(c.req.query())

  const where: any = {}
  if (query.provider !== 'all') where.provider = query.provider
  if (query.status !== 'all') where.status = query.status

  const events = await db.webhookEvent.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: query.limit,
  })

  return c.json({
    events: events.map(e => ({
      id: e.id,
      provider: e.provider,
      eventId: e.eventId,
      type: e.eventType,
      status: e.status,
      error: e.error,
      retryCount: e.retryCount,
      processingTimeMs: e.processingTimeMs,
      createdAt: e.createdAt,
      processedAt: e.processedAt,
    })),
    total: events.length,
  })
})

/**
 * POST /admin/webhooks/:id/retry
 * Manually retry a specific webhook
 */
system.post('/webhooks/:id/retry', adminSensitiveRateLimit, async (c) => {
  const { id } = c.req.param()
  const result = await dlq.retryWebhook(id)

  if (!result.success) {
    return c.json({ error: result.error }, 400)
  }

  await logAdminAction(c, 'webhook_retry', { webhookId: id })

  return c.json({ success: true, message: 'Webhook queued for retry' })
})

// ============================================
// STRIPE SYNC
// ============================================

/**
 * POST /admin/sync/stripe-invoice
 * Manually sync a Stripe invoice to local database
 */
system.post('/sync/stripe-invoice', adminSensitiveRateLimit, async (c) => {
  const body = z.object({
    invoiceId: z.string().startsWith('in_'),
  }).parse(await c.req.json())

  try {
    const invoice = await stripe.invoices.retrieve(body.invoiceId)

    if (invoice.status !== 'paid') {
      return c.json({ error: `Invoice status is ${invoice.status}, not paid` }, 400)
    }

    const invoiceAny = invoice as any
    const existing = await db.payment.findFirst({
      where: {
        OR: [
          { stripePaymentIntentId: invoiceAny.payment_intent as string },
          { stripeChargeId: invoiceAny.charge as string },
        ]
      }
    })

    if (existing) {
      return c.json({ error: 'Payment already exists', paymentId: existing.id }, 400)
    }

    const fakeEvent = {
      id: `manual_sync_${Date.now()}`,
      type: 'invoice.paid',
      data: { object: invoice },
    }

    await handleInvoicePaid(fakeEvent as any)

    await logAdminAction(c, 'sync_stripe_invoice', {
      invoiceId: body.invoiceId,
      amount: invoice.amount_paid,
      currency: invoice.currency,
    })

    return c.json({ success: true, message: `Synced invoice ${body.invoiceId}` })
  } catch (err: any) {
    console.error('[admin] Sync invoice failed:', err)
    return c.json({ error: err.message }, 500)
  }
})

/**
 * GET /admin/sync/stripe-missing
 * Find Stripe invoices that are missing from local database
 */
system.get('/sync/stripe-missing', async (c) => {
  const query = z.object({
    limit: z.coerce.number().min(1).max(200).default(20),
  }).parse(c.req.query())

  try {
    const invoices = await stripe.invoices.list({
      status: 'paid',
      limit: query.limit,
      expand: ['data.subscription'],
    })

    const missing: any[] = []

    for (const invoice of invoices.data) {
      const inv = invoice as any
      const payment = await db.payment.findFirst({
        where: {
          OR: [
            { stripePaymentIntentId: inv.payment_intent as string },
            { stripeChargeId: inv.charge as string },
          ].filter(Boolean)
        }
      })

      if (!payment) {
        missing.push({
          invoiceId: invoice.id,
          amount: invoice.amount_paid,
          currency: invoice.currency,
          customerEmail: invoice.customer_email,
          created: new Date(invoice.created * 1000),
          subscriptionId: typeof inv.subscription === 'string'
            ? inv.subscription
            : inv.subscription?.id,
        })
      }
    }

    return c.json({
      missing,
      total: missing.length,
      checked: invoices.data.length,
    })
  } catch (err: any) {
    console.error('[admin] Check missing invoices failed:', err)
    return c.json({ error: err.message }, 500)
  }
})

// ============================================
// TRANSFER MONITORING
// ============================================

/**
 * GET /admin/transfers/stats
 * Transfer statistics
 */
system.get('/transfers/stats', async (c) => {
  const stats = await getTransferStats()
  return c.json(stats)
})

/**
 * GET /admin/transfers/stuck
 * List transfers stuck in otp_pending status
 */
system.get('/transfers/stuck', async (c) => {
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
 * List all pending transfers
 */
system.get('/transfers/all-pending', async (c) => {
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
                select: { displayName: true, username: true },
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
 * List Paystack transactions missing from DB
 */
system.get('/reconciliation/missing', async (c) => {
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
 * Requires: super_admin
 */
system.post('/reconciliation/run', adminSensitiveRateLimit, requireRole('super_admin'), async (c) => {
  const acquired = await acquireReconciliationLock()
  if (!acquired) {
    return c.json({ error: 'Reconciliation already in progress' }, 409)
  }

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
    await releaseReconciliationLock()
  }
})

/**
 * POST /admin/reconciliation/stripe
 * Manually trigger Stripe reconciliation
 * Requires: super_admin
 */
system.post('/reconciliation/stripe', adminSensitiveRateLimit, requireRole('super_admin'), async (c) => {
  const acquired = await acquireReconciliationLock()
  if (!acquired) {
    return c.json({ error: 'Reconciliation already in progress' }, 409)
  }

  const limit = parseInt(c.req.query('limit') || '100')
  console.log(`[reconciliation] Starting Stripe sync (limit: ${limit})`)

  try {
    const events = await stripe.events.list({
      type: 'invoice.paid',
      limit,
    })

    let processed = 0

    for (const event of events.data) {
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
    await releaseReconciliationLock()
  }
})

// ============================================
// ACTIVITY FEED
// ============================================

/**
 * GET /admin/activity
 * List admin activities
 */
system.get('/activity', async (c) => {
  const query = z.object({
    page: z.coerce.number().default(1),
    limit: z.coerce.number().min(1).max(200).default(100),
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
      case 'admin_block_subscriber': return `Blocked subscriber: ${payload?.reason || ''}`
      case 'admin_unblock_subscriber': return `Unblocked subscriber: ${payload?.unblockReason || ''}`
      default: return type.replace(/_/g, ' ').replace(/^admin /, '')
    }
  }

  return c.json({
    activities: activities.map(a => {
      const payload = a.payload as Record<string, any> | null
      return {
        id: a.id,
        type: a.type,
        message: getActivityMessage(a.type, payload),
        adminEmail: payload?.adminEmail || 'System', // Use admin email from payload, not target user
        targetUserId: a.userId,
        targetUserEmail: a.user.email,
        metadata: payload,
        createdAt: a.createdAt
      }
    }),
    total: totalCount,
    page: query.page,
    totalPages: Math.ceil(totalCount / query.limit)
  })
})

// ============================================
// SYSTEM LOGS
// ============================================

/**
 * GET /admin/logs
 * List system logs
 */
system.get('/logs', async (c) => {
  const query = z.object({
    type: z.string().optional(),
    level: z.enum(['info', 'warning', 'error']).optional(),
    userId: z.string().optional(),
    page: z.coerce.number().default(1),
    limit: z.coerce.number().min(1).max(200).default(100)
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

/**
 * GET /admin/logs/stats
 * Log statistics
 */
system.get('/logs/stats', async (c) => {
  const { start: last24h } = lastNDays(1)
  const { start: last7d } = lastNDays(7)

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
// REMINDERS
// ============================================

/**
 * GET /admin/reminders
 * List reminders
 */
system.get('/reminders', async (c) => {
  const query = z.object({
    status: z.enum(['scheduled', 'sent', 'failed', 'canceled', 'all']).default('all'),
    type: z.string().optional(),
    page: z.coerce.number().default(1),
    limit: z.coerce.number().min(1).max(200).default(50)
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

/**
 * GET /admin/reminders/stats
 * Reminder statistics
 */
system.get('/reminders/stats', async (c) => {
  const startOfDay = todayStart()
  const next24h = new Date(Date.now() + 24 * 60 * 60 * 1000)

  const [scheduled, sentToday, failedToday, upcoming] = await Promise.all([
    db.reminder.count({ where: { status: 'scheduled' } }),
    db.reminder.count({ where: { status: 'sent', sentAt: { gte: startOfDay } } }),
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
// EMAILS
// ============================================

/**
 * GET /admin/emails
 * List email logs
 */
system.get('/emails', async (c) => {
  const query = z.object({
    status: z.enum(['sent', 'failed', 'all']).default('all'),
    template: z.string().optional(),
    page: z.coerce.number().default(1),
    limit: z.coerce.number().min(1).max(200).default(100)
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
// INVOICES
// ============================================

/**
 * GET /admin/invoices
 * List invoices (requests with due dates)
 */
system.get('/invoices', async (c) => {
  const query = z.object({
    status: z.enum(['draft', 'sent', 'pending_payment', 'paid', 'declined', 'expired', 'all']).default('all'),
    page: z.coerce.number().default(1),
    limit: z.coerce.number().min(1).max(200).default(50)
  }).parse(c.req.query())

  const skip = (query.page - 1) * query.limit
  const where: any = { dueDate: { not: null } }

  if (query.status !== 'all') where.status = query.status === 'paid' ? 'accepted' : query.status

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
      status: r.status === 'accepted' ? 'paid' : r.status,
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

export default system
