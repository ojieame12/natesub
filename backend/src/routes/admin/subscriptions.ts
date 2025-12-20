/**
 * Admin Subscriptions Controller
 *
 * Subscription management routes for admin dashboard.
 * Includes: list, cancel, pause, resume.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { stripe } from '../../services/stripe.js'
import { adminSensitiveRateLimit } from '../../middleware/rateLimit.js'
import { requireRole, requireFreshSession } from '../../middleware/adminAuth.js'

const subscriptions = new Hono()

// ============================================
// SUBSCRIPTIONS LIST
// ============================================

/**
 * GET /admin/subscriptions
 * List subscriptions with pagination and filtering
 */
subscriptions.get('/', async (c) => {
  const query = z.object({
    search: z.string().optional(),
    status: z.enum(['all', 'active', 'canceled', 'past_due', 'paused']).default('all'),
    page: z.coerce.number().default(1),
    limit: z.coerce.number().min(1).max(200).default(50)
  }).parse(c.req.query())

  const skip = (query.page - 1) * query.limit
  const where: any = query.status !== 'all' ? { status: query.status } : {}

  // Search by subscriber email, creator email, or creator username
  if (query.search) {
    where.OR = [
      { subscriber: { email: { contains: query.search, mode: 'insensitive' } } },
      { creator: { email: { contains: query.search, mode: 'insensitive' } } },
      { creator: { profile: { username: { contains: query.search, mode: 'insensitive' } } } }
    ]
  }

  const [dbSubscriptions, total] = await Promise.all([
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
    subscriptions: dbSubscriptions.map(s => ({
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

// ============================================
// SUBSCRIPTION DETAIL
// ============================================

/**
 * GET /admin/subscriptions/:id
 * Get full subscription detail with subscriber info and payment history
 */
subscriptions.get('/:id', async (c) => {
  const { id } = c.req.param()

  const subscription = await db.subscription.findUnique({
    where: { id },
    include: {
      creator: {
        select: {
          id: true,
          email: true,
          profile: { select: { username: true, displayName: true } }
        }
      },
      subscriber: {
        select: {
          id: true,
          email: true,
          createdAt: true
        }
      }
    }
  })

  if (!subscription) return c.json({ error: 'Subscription not found' }, 404)

  // Get payment history for this subscription
  const payments = await db.payment.findMany({
    where: { subscriptionId: id },
    orderBy: { occurredAt: 'desc' },
    take: 20,
    select: {
      id: true,
      grossCents: true,
      amountCents: true,
      feeCents: true,
      netCents: true,
      currency: true,
      status: true,
      type: true,
      stripePaymentIntentId: true,
      paystackTransactionRef: true,
      occurredAt: true
    }
  })

  // Get subscriber's other active subscriptions
  const otherSubscriptions = await db.subscription.findMany({
    where: {
      subscriberId: subscription.subscriberId,
      id: { not: id },
      status: { in: ['active', 'paused', 'past_due'] }
    },
    include: {
      creator: {
        select: {
          email: true,
          profile: { select: { username: true, displayName: true } }
        }
      }
    },
    take: 10
  })

  // Calculate subscriber totals
  const subscriberStats = await db.payment.aggregate({
    where: {
      subscriberId: subscription.subscriberId,
      status: 'succeeded'
    },
    _sum: { grossCents: true },
    _count: true
  })

  return c.json({
    subscription: {
      id: subscription.id,
      status: subscription.status,
      amount: subscription.amount,
      currency: subscription.currency,
      interval: subscription.interval,
      ltvCents: subscription.ltvCents,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      createdAt: subscription.createdAt,
      canceledAt: subscription.canceledAt,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      paystackAuthorizationCode: subscription.paystackAuthorizationCode ? true : false
    },
    creator: {
      id: subscription.creator.id,
      email: subscription.creator.email,
      username: subscription.creator.profile?.username,
      displayName: subscription.creator.profile?.displayName
    },
    subscriber: {
      id: subscription.subscriber.id,
      email: subscription.subscriber.email,
      joinedAt: subscription.subscriber.createdAt,
      totalSpentCents: subscriberStats._sum.grossCents || 0,
      totalPayments: subscriberStats._count
    },
    payments: payments.map(p => ({
      id: p.id,
      grossCents: p.grossCents ?? p.amountCents,
      feeCents: p.feeCents,
      netCents: p.netCents,
      currency: p.currency,
      status: p.status,
      type: p.type,
      provider: p.stripePaymentIntentId ? 'stripe' : p.paystackTransactionRef ? 'paystack' : 'unknown',
      occurredAt: p.occurredAt
    })),
    otherSubscriptions: otherSubscriptions.map(s => ({
      id: s.id,
      creatorUsername: s.creator.profile?.username,
      creatorDisplayName: s.creator.profile?.displayName,
      amount: s.amount,
      currency: s.currency,
      status: s.status
    }))
  })
})

// ============================================
// SUBSCRIPTION ACTIONS
// ============================================

/**
 * POST /admin/subscriptions/:id/cancel
 * Cancel a subscription
 * Requires: super_admin
 */
subscriptions.post('/:id/cancel', adminSensitiveRateLimit, requireRole('super_admin'), requireFreshSession, async (c) => {
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

/**
 * POST /admin/subscriptions/:id/pause
 * Pause a subscription (stop billing but keep active)
 */
subscriptions.post('/:id/pause', adminSensitiveRateLimit, requireRole('super_admin'), requireFreshSession, async (c) => {
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
        payload: {
          subscriptionId: id,
          adminId: c.get('adminUserId'),
          adminEmail: c.get('adminEmail')
        }
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
subscriptions.post('/:id/resume', adminSensitiveRateLimit, requireRole('super_admin'), requireFreshSession, async (c) => {
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
        pause_collection: null // null clears the pause per Stripe docs
      } as any)
    }

    await db.subscription.update({
      where: { id },
      data: { status: 'active' }
    })

    await db.activity.create({
      data: {
        userId: subscription.creatorId,
        type: 'admin_subscription_resumed',
        payload: {
          subscriptionId: id,
          adminId: c.get('adminUserId'),
          adminEmail: c.get('adminEmail')
        }
      }
    })

    return c.json({ success: true, message: 'Subscription resumed' })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

export default subscriptions
