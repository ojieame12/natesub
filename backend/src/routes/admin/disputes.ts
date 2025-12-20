/**
 * Admin Disputes Controller
 *
 * Dispute and blocked subscriber management routes.
 * Routes are at root level: /admin/disputes/*, /admin/blocked-subscribers/*, /admin/subscribers/*
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { thisMonthStart } from '../../utils/timezone.js'
import { adminSensitiveRateLimit } from '../../middleware/rateLimit.js'
import { requireRole, requireFreshSession } from '../../middleware/adminAuth.js'

const disputes = new Hono()

// ============================================
// DISPUTES
// ============================================

/**
 * GET /admin/disputes/stats
 * Dispute statistics overview
 */
disputes.get('/stats', async (c) => {
  const startOfMonth = thisMonthStart()

  const [
    openDisputes,
    wonThisMonth,
    lostThisMonth,
    allTimeStats,
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
disputes.get('/', async (c) => {
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

  const [disputesList, total] = await Promise.all([
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
    disputes: disputesList.map(d => ({
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

export default disputes

// ============================================
// BLOCKED SUBSCRIBERS
// Exported as separate router for mounting at /blocked-subscribers
// ============================================

export const blockedSubscribers = new Hono()

/**
 * GET /admin/blocked-subscribers
 * List subscribers blocked due to disputes
 */
blockedSubscribers.get('/', async (c) => {
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
 * Unblock a subscriber
 * Requires: super_admin
 */
blockedSubscribers.post('/:id/unblock', adminSensitiveRateLimit, requireRole('super_admin'), requireFreshSession, async (c) => {
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
    data: { blockedReason: null }
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
// SUBSCRIBERS (block action)
// Exported as separate router for mounting at /subscribers
// ============================================

export const subscribers = new Hono()

/**
 * POST /admin/subscribers/:id/block
 * Manually block a subscriber
 * Requires: super_admin
 */
subscribers.post('/:id/block', adminSensitiveRateLimit, requireRole('super_admin'), requireFreshSession, async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json().catch(() => ({}))
  const reason = body.reason || 'Blocked by admin'

  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, email: true, blockedReason: true }
  })

  if (!user) return c.json({ error: 'User not found' }, 404)
  if (user.blockedReason) return c.json({ error: 'User is already blocked', blockedReason: user.blockedReason }, 400)

  await db.user.update({
    where: { id },
    data: { blockedReason: reason }
  })

  const cancelledSubs = await db.subscription.updateMany({
    where: { subscriberId: id, status: 'active' },
    data: { status: 'canceled', canceledAt: new Date() }
  })

  await db.activity.create({
    data: {
      userId: id,
      type: 'admin_block_subscriber',
      payload: {
        reason,
        blockedAt: new Date().toISOString(),
        cancelledSubscriptions: cancelledSubs.count
      }
    }
  })

  return c.json({
    success: true,
    message: 'Subscriber blocked',
    cancelledSubscriptions: cancelledSubs.count
  })
})
