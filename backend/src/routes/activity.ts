import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'

const activity = new Hono()

// Get activity feed
activity.get(
  '/',
  requireAuth,
  zValidator('query', z.object({
    limit: z.string().optional().transform(v => parseInt(v || '20')),
    cursor: z.string().optional(),
  })),
  async (c) => {
    const userId = c.get('userId')
    const { limit, cursor } = c.req.valid('query')

    const activities = await db.activity.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // Get one extra to check if there's more
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })

    const hasMore = activities.length > limit
    if (hasMore) activities.pop()

    return c.json({
      activities: activities.map(a => ({
        id: a.id,
        type: a.type,
        payload: a.payload,
        createdAt: a.createdAt,
      })),
      nextCursor: hasMore ? activities[activities.length - 1]?.id : null,
    })
  }
)

// Get dashboard metrics (must be before /:id to avoid route conflict)
activity.get('/metrics', requireAuth, async (c) => {
  const userId = c.get('userId')

  // Get active subscriptions
  const subscriptions = await db.subscription.findMany({
    where: {
      creatorId: userId,
      status: 'active',
    },
    select: {
      amount: true,
      currency: true,
      tierName: true,
      interval: true,
    },
  })

  // Calculate MRR (only recurring subscriptions)
  const mrrCents = subscriptions
    .filter(s => s.interval === 'month')
    .reduce((sum, s) => sum + s.amount, 0)

  // Get total revenue
  const payments = await db.payment.aggregate({
    where: {
      creatorId: userId,
      status: 'succeeded',
    },
    _sum: { netCents: true },
  })

  // Tier breakdown
  const tierBreakdown: Record<string, number> = {}
  for (const sub of subscriptions) {
    const tier = sub.tierName || 'Default'
    tierBreakdown[tier] = (tierBreakdown[tier] || 0) + 1
  }

  return c.json({
    metrics: {
      subscriberCount: subscriptions.length,
      mrrCents,
      mrr: mrrCents / 100,
      totalRevenueCents: payments._sum.netCents || 0,
      totalRevenue: (payments._sum.netCents || 0) / 100,
      tierBreakdown,
    },
  })
})

// Get single activity (must be after /metrics to avoid route conflict)
activity.get(
  '/:id',
  requireAuth,
  zValidator('param', z.object({ id: z.string().uuid() })),
  async (c) => {
    const userId = c.get('userId')
    const { id } = c.req.valid('param')

    const act = await db.activity.findFirst({
      where: { id, userId },
    })

    if (!act) {
      return c.json({ error: 'Activity not found' }, 404)
    }

    return c.json({ activity: act })
  }
)

export default activity
