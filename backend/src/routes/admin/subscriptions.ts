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
    status: z.enum(['all', 'active', 'canceled', 'past_due']).default('all'),
    page: z.coerce.number().default(1),
    limit: z.coerce.number().min(1).max(200).default(50)
  }).parse(c.req.query())

  const skip = (query.page - 1) * query.limit
  const where: any = query.status !== 'all' ? { status: query.status } : {}

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
