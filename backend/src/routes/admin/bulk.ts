/**
 * Admin Bulk Operations Controller
 *
 * Batch operations for managing users and subscriptions at scale:
 * - Bulk cancel subscriptions with filters
 * - Bulk block users
 * - Bulk operations are rate-limited and logged
 *
 * All bulk operations require super_admin role and fresh session.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { HTTPException } from 'hono/http-exception'
import { requireRole, logAdminAction, requireFreshSession } from '../../middleware/adminAuth.js'
import { adminSensitiveRateLimit } from '../../middleware/rateLimit.js'

const bulk = new Hono()

// All bulk operations require super_admin
bulk.use('*', requireRole('super_admin'))

/**
 * POST /admin/bulk/cancel-subscriptions/preview
 * Preview which subscriptions would be cancelled
 */
bulk.post('/cancel-subscriptions/preview', async (c) => {
  const body = z.object({
    creatorId: z.string().optional(),
    status: z.enum(['active', 'past_due', 'paused']).optional(),
    createdBefore: z.string().datetime().optional(),
    createdAfter: z.string().datetime().optional(),
    reason: z.string().min(1).max(500),
  }).parse(await c.req.json())

  const where: any = {
    canceledAt: null,
  }

  if (body.creatorId) {
    where.creatorId = body.creatorId
  }

  if (body.status) {
    where.status = body.status
  }

  if (body.createdBefore) {
    where.createdAt = { ...where.createdAt, lte: new Date(body.createdBefore) }
  }

  if (body.createdAfter) {
    where.createdAt = { ...where.createdAt, gte: new Date(body.createdAfter) }
  }

  const subscriptions = await db.subscription.findMany({
    where,
    select: {
      id: true,
      status: true,
      amount: true,
      currency: true,
      createdAt: true,
      creatorId: true,
      subscriberId: true,
    },
    take: 1000, // Safety limit
  })

  const totalMrr = subscriptions.reduce((sum, s) => sum + s.amount, 0)

  return c.json({
    preview: true,
    filters: body,
    count: subscriptions.length,
    totalMrrImpact: totalMrr,
    subscriptions: subscriptions.slice(0, 100).map(s => ({
      id: s.id,
      status: s.status,
      amount: s.amount,
      currency: s.currency,
      creatorId: s.creatorId,
      subscriberId: s.subscriberId,
      createdAt: s.createdAt,
    })),
    note: subscriptions.length > 100 ? `Showing first 100 of ${subscriptions.length} subscriptions` : undefined,
  })
})

/**
 * POST /admin/bulk/cancel-subscriptions
 * Execute bulk subscription cancellation
 */
bulk.post('/cancel-subscriptions', adminSensitiveRateLimit, requireFreshSession, async (c) => {
  const body = z.object({
    creatorId: z.string().optional(),
    status: z.enum(['active', 'past_due', 'paused']).optional(),
    createdBefore: z.string().datetime().optional(),
    createdAfter: z.string().datetime().optional(),
    reason: z.string().min(1).max(500),
    confirmCount: z.number().positive(), // Must match preview count
  }).parse(await c.req.json())

  const where: any = {
    canceledAt: null,
  }

  if (body.creatorId) {
    where.creatorId = body.creatorId
  }

  if (body.status) {
    where.status = body.status
  }

  if (body.createdBefore) {
    where.createdAt = { ...where.createdAt, lte: new Date(body.createdBefore) }
  }

  if (body.createdAfter) {
    where.createdAt = { ...where.createdAt, gte: new Date(body.createdAfter) }
  }

  // Verify count matches
  const actualCount = await db.subscription.count({ where })

  if (actualCount !== body.confirmCount) {
    throw new HTTPException(400, {
      message: `Count mismatch: expected ${body.confirmCount} but found ${actualCount}. Please re-run preview.`,
    })
  }

  if (actualCount > 500) {
    throw new HTTPException(400, {
      message: `Bulk cancellation limited to 500 subscriptions at a time. Found ${actualCount}.`,
    })
  }

  // Execute cancellation
  const now = new Date()
  const result = await db.subscription.updateMany({
    where,
    data: {
      canceledAt: now,
      status: 'canceled',
    },
  })

  await logAdminAction(c, 'Bulk subscription cancellation', {
    count: result.count,
    filters: {
      creatorId: body.creatorId,
      status: body.status,
      createdBefore: body.createdBefore,
      createdAfter: body.createdAfter,
    },
    reason: body.reason,
  })

  return c.json({
    success: true,
    cancelled: result.count,
    reason: body.reason,
    timestamp: now.toISOString(),
  })
})

/**
 * POST /admin/bulk/block-users/preview
 * Preview which users would be blocked
 */
bulk.post('/block-users/preview', async (c) => {
  const body = z.object({
    userIds: z.array(z.string()).min(1).max(100),
    reason: z.string().min(1).max(500),
  }).parse(await c.req.json())

  const users = await db.user.findMany({
    where: {
      id: { in: body.userIds },
      deletedAt: null,
    },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      profile: {
        select: { displayName: true, username: true },
      },
      _count: {
        select: {
          subscriptions: true,
          subscribedTo: true,
        },
      },
    },
  })

  // Check for admin users
  const adminUsers = users.filter(u => u.role === 'admin' || u.role === 'super_admin')

  return c.json({
    preview: true,
    filters: { userIds: body.userIds },
    found: users.length,
    notFound: body.userIds.filter(id => !users.find(u => u.id === id)),
    adminWarning: adminUsers.length > 0
      ? `Warning: ${adminUsers.length} admin users included. These will be skipped.`
      : undefined,
    users: users.map(u => ({
      id: u.id,
      email: u.email,
      role: u.role,
      name: u.profile?.displayName || u.profile?.username,
      subscriptionsAsCreator: u._count.subscriptions,
      subscriptionsAsSubscriber: u._count.subscribedTo,
      createdAt: u.createdAt,
    })),
  })
})

/**
 * POST /admin/bulk/block-users
 * Execute bulk user blocking (soft delete)
 */
bulk.post('/block-users', adminSensitiveRateLimit, requireFreshSession, async (c) => {
  const body = z.object({
    userIds: z.array(z.string()).min(1).max(100),
    reason: z.string().min(1).max(500),
    cancelSubscriptions: z.boolean().default(true),
  }).parse(await c.req.json())

  // Get users and filter out admins
  const users = await db.user.findMany({
    where: {
      id: { in: body.userIds },
      deletedAt: null,
      role: 'user', // Only regular users can be blocked
    },
    select: {
      id: true,
      email: true,
    },
  })

  if (users.length === 0) {
    throw new HTTPException(400, { message: 'No eligible users found (admins cannot be blocked)' })
  }

  const userIdsToBlock = users.map(u => u.id)
  const now = new Date()

  // Soft delete users
  const blockResult = await db.user.updateMany({
    where: { id: { in: userIdsToBlock } },
    data: {
      deletedAt: now,
      // Store reason in a way that's queryable if needed
    },
  })

  // Optionally cancel their subscriptions
  let cancelledSubs = 0
  if (body.cancelSubscriptions) {
    // Cancel subscriptions as creator
    const creatorCancel = await db.subscription.updateMany({
      where: {
        creatorId: { in: userIdsToBlock },
        canceledAt: null,
      },
      data: {
        canceledAt: now,
        status: 'canceled',
      },
    })

    // Cancel subscriptions as subscriber
    const subscriberCancel = await db.subscription.updateMany({
      where: {
        subscriberId: { in: userIdsToBlock },
        canceledAt: null,
      },
      data: {
        canceledAt: now,
        status: 'canceled',
      },
    })

    cancelledSubs = creatorCancel.count + subscriberCancel.count
  }

  await logAdminAction(c, 'Bulk user block', {
    blockedCount: blockResult.count,
    userIds: userIdsToBlock,
    reason: body.reason,
    cancelledSubscriptions: cancelledSubs,
  })

  return c.json({
    success: true,
    blocked: blockResult.count,
    cancelledSubscriptions: cancelledSubs,
    skipped: body.userIds.length - users.length,
    reason: body.reason,
    timestamp: now.toISOString(),
  })
})

/**
 * POST /admin/bulk/unblock-users
 * Restore soft-deleted users
 */
bulk.post('/unblock-users', adminSensitiveRateLimit, requireFreshSession, async (c) => {
  const body = z.object({
    userIds: z.array(z.string()).min(1).max(100),
    reason: z.string().min(1).max(500).optional(),
  }).parse(await c.req.json())

  const result = await db.user.updateMany({
    where: {
      id: { in: body.userIds },
      deletedAt: { not: null },
    },
    data: {
      deletedAt: null,
    },
  })

  await logAdminAction(c, 'Bulk user unblock', {
    unblockedCount: result.count,
    userIds: body.userIds,
    reason: body.reason,
  })

  return c.json({
    success: true,
    unblocked: result.count,
    timestamp: new Date().toISOString(),
  })
})

export default bulk
