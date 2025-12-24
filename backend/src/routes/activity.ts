import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { centsToDisplayAmount } from '../utils/currency.js'
import { getUSDRate, convertLocalCentsToUSD, convertUSDCentsToLocal } from '../services/fx.js'
import { syncCreatorBalance, isBalanceStale } from '../services/balanceSync.js'

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
    profile,
    subscriberCount,
    mrrResult,
    totalRevenueResult,
    tierBreakdown,
  ] = await Promise.all([
    // Profile for currency and cached balance
    db.profile.findUnique({
      where: { userId },
      select: {
        currency: true,
        stripeAccountId: true,
        paymentProvider: true,
        balanceAvailableCents: true,
        balancePendingCents: true,
        balanceCurrency: true,
        balanceLastSyncedAt: true,
      },
    }),

    // Count active subscribers
    db.subscription.count({
      where: {
        creatorId: userId,
        status: 'active',
      },
    }),

    // Calculate MRR using DB aggregate, grouped by currency
    db.subscription.groupBy({
      by: ['currency'],
      where: {
        creatorId: userId,
        status: 'active',
        interval: 'month',
      },
      _sum: { amount: true },
    }),

    // Get total revenue, grouped by currency
    db.payment.groupBy({
      by: ['currency'],
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

  const profileCurrency = profile?.currency || 'USD'

  // Helper to normalize cents from any currency to Profile Currency
  // 1. Convert Local -> USD
  // 2. Convert USD -> Profile Currency
  // Note: FX rates for NGN/KES/etc are "USD to Local".
  const normalizeToProfile = async (groups: { currency: string, _sum: any }[], field: string) => {
    let totalUsdCents = 0

    // First pass: Convert everything to USD common base
    for (const group of groups) {
      const currency = group.currency
      const amount = group._sum[field] || 0

      if (amount === 0) continue

      if (currency === 'USD') {
        totalUsdCents += amount
      } else {
        // Fetch rate (e.g., 1 USD = 1600 NGN)
        const rate = await getUSDRate(currency)
        // Convert NGN cents -> USD cents
        totalUsdCents += convertLocalCentsToUSD(amount, rate)
      }
    }

    // Second pass: Convert Total USD -> Profile Currency
    if (profileCurrency === 'USD') {
      return totalUsdCents
    } else {
      const rate = await getUSDRate(profileCurrency)
      return convertUSDCentsToLocal(totalUsdCents, rate)
    }
  }

  // Calculate normalized totals
  const mrrCents = await normalizeToProfile(mrrResult, 'amount')
  const totalRevenueCents = await normalizeToProfile(totalRevenueResult, 'netCents')

  // If balance is stale (>5 min), trigger background refresh
  if (profile?.stripeAccountId && isBalanceStale(profile.balanceLastSyncedAt)) {
    syncCreatorBalance(userId).catch(() => {}) // Fire-and-forget
  }

  return c.json({
    metrics: {
      subscriberCount,
      mrrCents,
      mrr: centsToDisplayAmount(mrrCents, profileCurrency),
      totalRevenueCents,
      totalRevenue: centsToDisplayAmount(totalRevenueCents, profileCurrency),
      currency: profileCurrency,
      tierBreakdown: tierBreakdownRecord,
      // Balance breakdown (from cached Stripe balance)
      balance: {
        available: profile?.balanceAvailableCents || 0,
        pending: profile?.balancePendingCents || 0,
        currency: profile?.balanceCurrency || profileCurrency,
        lastSyncedAt: profile?.balanceLastSyncedAt || null,
      },
    },
  })
})

// Force-refresh balance from Stripe
activity.post('/balance/refresh', requireAuth, async (c) => {
  const userId = c.get('userId')

  const balance = await syncCreatorBalance(userId)
  if (!balance) {
    return c.json({ error: 'Failed to sync balance or no payment provider configured' }, 400)
  }

  return c.json({ balance })
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
