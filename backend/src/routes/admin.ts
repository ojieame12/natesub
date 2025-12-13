/**
 * Admin Routes
 *
 * Protected routes for operational monitoring and management.
 * Only accessible with ADMIN_API_KEY header.
 */

import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import dlq from '../services/dlq.js'
import { db } from '../db/client.js'

const admin = new Hono()

// Admin auth middleware - requires ADMIN_API_KEY
admin.use('*', async (c, next) => {
  const apiKey = c.req.header('x-admin-api-key')
  const expectedKey = process.env.ADMIN_API_KEY

  if (!expectedKey) {
    throw new HTTPException(500, { message: 'Admin API key not configured' })
  }

  if (apiKey !== expectedKey) {
    throw new HTTPException(401, { message: 'Invalid admin API key' })
  }

  await next()
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
  const events = await dlq.getFailedWebhooksForRetry()
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
 * System health check
 */
admin.get('/health', async (c) => {
  try {
    // Check database connection
    await db.$queryRaw`SELECT 1`

    return c.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
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

export default admin
