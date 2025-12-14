import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'

const activity = new Hono()

// Get activity feed (with pagination, max 100 per page)
activity.get(
  '/',
  requireAuth,
  zValidator('query', z.object({
    limit: z.string().optional().transform(v => Math.min(parseInt(v || '20') || 20, 100)),
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
// Optimized to use DB aggregates instead of loading all subscriptions into memory
activity.get('/metrics', requireAuth, async (c) => {
  const userId = c.get('userId')

  // Run all queries in parallel for efficiency
  const [
    subscriberCount,
    mrrResult,
    totalRevenue,
    tierBreakdown,
  ] = await Promise.all([
    // Count active subscribers
    db.subscription.count({
      where: {
        creatorId: userId,
        status: 'active',
      },
    }),

    // Calculate MRR using DB aggregate (only recurring subscriptions)
    db.subscription.aggregate({
      where: {
        creatorId: userId,
        status: 'active',
        interval: 'month',
      },
      _sum: { amount: true },
    }),

    // Get total revenue
    db.payment.aggregate({
      where: {
        creatorId: userId,
        status: 'succeeded',
      },
      _sum: { netCents: true },
    }),

    // Tier breakdown using groupBy
    db.subscription.groupBy({
      by: ['tierName'],
      where: {
        creatorId: userId,
        status: 'active',
      },
      _count: true,
    }),
  ])

  // Convert tier breakdown to record format
  const tierBreakdownRecord: Record<string, number> = {}
  for (const tier of tierBreakdown) {
    const tierName = tier.tierName || 'Default'
    tierBreakdownRecord[tierName] = tier._count
  }

  const mrrCents = mrrResult._sum.amount || 0

  return c.json({
    metrics: {
      subscriberCount,
      mrrCents,
      mrr: mrrCents / 100,
      totalRevenueCents: totalRevenue._sum.netCents || 0,
      totalRevenue: (totalRevenue._sum.netCents || 0) / 100,
      tierBreakdown: tierBreakdownRecord,
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
