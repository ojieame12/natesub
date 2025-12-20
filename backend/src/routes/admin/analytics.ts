/**
 * Admin Subscription Analytics Controller
 *
 * Provides insights into subscription health:
 * - Churn analysis (who's leaving and why)
 * - Lifetime Value (LTV) metrics
 * - At-risk subscription identification
 * - Cohort analysis for retention tracking
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { requireRole } from '../../middleware/adminAuth.js'
import { lastNDays } from '../../utils/timezone.js'

const analytics = new Hono()

// All analytics require admin role
analytics.use('*', requireRole('admin'))

/**
 * GET /admin/analytics/churn
 * Analyze subscription cancellations and churn patterns
 */
analytics.get('/churn', async (c) => {
  const query = z.object({
    days: z.coerce.number().min(1).max(365).default(30),
  }).parse(c.req.query())

  const { start: periodStart, end: periodEnd } = lastNDays(query.days)

  // Get cancelled subscriptions in period
  const cancelledSubs = await db.subscription.findMany({
    where: {
      canceledAt: { gte: periodStart, lte: periodEnd },
    },
    select: {
      id: true,
      canceledAt: true,
      cancelReason: true,
      cancelSource: true,
      createdAt: true,
      amountCents: true,
      currency: true,
    },
  })

  // Group by cancellation reason
  const byReason: Record<string, { count: number; mrrLost: number }> = {}
  let totalMrrLost = 0

  for (const sub of cancelledSubs) {
    const reason = sub.cancelReason || sub.cancelSource || 'unknown'
    if (!byReason[reason]) {
      byReason[reason] = { count: 0, mrrLost: 0 }
    }
    byReason[reason].count++
    byReason[reason].mrrLost += sub.amountCents
    totalMrrLost += sub.amountCents
  }

  // Get active subscriptions at start of period for churn rate calculation
  const activeAtStart = await db.subscription.count({
    where: {
      createdAt: { lt: periodStart },
      OR: [
        { canceledAt: null },
        { canceledAt: { gt: periodStart } },
      ],
      status: { in: ['active', 'past_due'] },
    },
  })

  // Calculate churn rate
  const churnRate = activeAtStart > 0
    ? (cancelledSubs.length / activeAtStart) * 100
    : 0

  // Daily trend
  const dailyChurn = await db.$queryRaw<Array<{
    date: string
    count: bigint
    mrr_lost: bigint
  }>>`
    SELECT
      DATE("canceledAt") as date,
      COUNT(*)::bigint as count,
      SUM("amountCents")::bigint as mrr_lost
    FROM "Subscription"
    WHERE "canceledAt" >= ${periodStart}
      AND "canceledAt" <= ${periodEnd}
    GROUP BY DATE("canceledAt")
    ORDER BY date
  `

  return c.json({
    period: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      days: query.days,
    },
    summary: {
      cancelled: cancelledSubs.length,
      mrrLost: totalMrrLost,
      churnRate: parseFloat(churnRate.toFixed(2)),
      activeAtPeriodStart: activeAtStart,
    },
    byReason: Object.entries(byReason)
      .map(([reason, data]) => ({
        reason,
        count: data.count,
        mrrLost: data.mrrLost,
        percentage: parseFloat(((data.count / cancelledSubs.length) * 100).toFixed(1)),
      }))
      .sort((a, b) => b.count - a.count),
    trend: dailyChurn.map(d => ({
      date: d.date,
      count: Number(d.count),
      mrrLost: Number(d.mrr_lost),
    })),
  })
})

/**
 * GET /admin/analytics/ltv
 * Lifetime Value analysis by creator and overall
 */
analytics.get('/ltv', async (c) => {
  const query = z.object({
    limit: z.coerce.number().min(1).max(100).default(20),
  }).parse(c.req.query())

  // Overall LTV calculation
  // LTV = Average Revenue Per User * Average Customer Lifetime
  const overallStats = await db.$queryRaw<Array<{
    total_payments: bigint
    total_revenue: bigint
    unique_subscribers: bigint
    avg_subscription_days: number | null
  }>>`
    SELECT
      COUNT(DISTINCT p.id)::bigint as total_payments,
      SUM(p."amountCents")::bigint as total_revenue,
      COUNT(DISTINCT p."subscriberId")::bigint as unique_subscribers,
      AVG(
        CASE
          WHEN s."canceledAt" IS NOT NULL
          THEN EXTRACT(EPOCH FROM (s."canceledAt" - s."createdAt")) / 86400
          ELSE EXTRACT(EPOCH FROM (NOW() - s."createdAt")) / 86400
        END
      ) as avg_subscription_days
    FROM "Payment" p
    JOIN "Subscription" s ON p."subscriptionId" = s.id
    WHERE p.status = 'succeeded'
  `

  const stats = overallStats[0]
  const totalRevenue = Number(stats?.total_revenue || 0)
  const uniqueSubscribers = Number(stats?.unique_subscribers || 1)
  const avgLifespanDays = stats?.avg_subscription_days || 0

  const avgRevenuePerUser = totalRevenue / uniqueSubscribers
  const overallLtv = avgRevenuePerUser // Simplified: could multiply by churn adjustment

  // LTV by creator
  const creatorLtv = await db.$queryRaw<Array<{
    creator_id: string
    subscriber_count: bigint
    total_revenue: bigint
    avg_revenue_per_sub: number
    avg_lifespan_days: number
    churn_count: bigint
  }>>`
    SELECT
      s."creatorId" as creator_id,
      COUNT(DISTINCT s."subscriberId")::bigint as subscriber_count,
      SUM(p."amountCents")::bigint as total_revenue,
      AVG(p."amountCents")::float as avg_revenue_per_sub,
      AVG(
        CASE
          WHEN s."canceledAt" IS NOT NULL
          THEN EXTRACT(EPOCH FROM (s."canceledAt" - s."createdAt")) / 86400
          ELSE EXTRACT(EPOCH FROM (NOW() - s."createdAt")) / 86400
        END
      )::float as avg_lifespan_days,
      COUNT(CASE WHEN s."canceledAt" IS NOT NULL THEN 1 END)::bigint as churn_count
    FROM "Payment" p
    JOIN "Subscription" s ON p."subscriptionId" = s.id
    WHERE p.status = 'succeeded'
    GROUP BY s."creatorId"
    HAVING COUNT(DISTINCT s."subscriberId") >= 3
    ORDER BY SUM(p."amountCents") DESC
    LIMIT ${query.limit}
  `

  // Get creator details
  const creatorIds = creatorLtv.map(c => c.creator_id)
  const creators = await db.user.findMany({
    where: { id: { in: creatorIds } },
    select: {
      id: true,
      profile: {
        select: {
          displayName: true,
          username: true,
        },
      },
    },
  })
  const creatorMap = new Map(creators.map(c => [c.id, c]))

  return c.json({
    overall: {
      averageLtv: Math.round(overallLtv),
      averageRevenuePerUser: Math.round(avgRevenuePerUser),
      averageLifespanDays: Math.round(avgLifespanDays),
      totalSubscribers: uniqueSubscribers,
      totalRevenue,
    },
    byCreator: creatorLtv.map(c => {
      const creator = creatorMap.get(c.creator_id)
      const subscriberCount = Number(c.subscriber_count)
      const churnCount = Number(c.churn_count)
      const churnRate = subscriberCount > 0 ? (churnCount / subscriberCount) * 100 : 0

      return {
        creatorId: c.creator_id,
        displayName: creator?.profile?.displayName,
        username: creator?.profile?.username,
        subscriberCount,
        totalRevenue: Number(c.total_revenue),
        avgRevenuePerSub: Math.round(c.avg_revenue_per_sub || 0),
        avgLifespanDays: Math.round(c.avg_lifespan_days || 0),
        churnRate: parseFloat(churnRate.toFixed(1)),
        estimatedLtv: Math.round((c.avg_revenue_per_sub || 0) * (c.avg_lifespan_days || 30) / 30),
      }
    }),
  })
})

/**
 * GET /admin/analytics/at-risk
 * Identify subscriptions at risk of churning
 */
analytics.get('/at-risk', async (c) => {
  const now = new Date()
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const fourteenDaysAhead = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

  // Past due subscriptions (payment failed but not cancelled)
  const pastDue = await db.subscription.findMany({
    where: {
      status: 'past_due',
      canceledAt: null,
    },
    select: {
      id: true,
      subscriberId: true,
      creatorId: true,
      amountCents: true,
      currency: true,
      currentPeriodEnd: true,
      createdAt: true,
      creator: {
        select: {
          profile: {
            select: { displayName: true, username: true },
          },
        },
      },
      subscriber: {
        select: { email: true },
      },
    },
    orderBy: { currentPeriodEnd: 'asc' },
    take: 50,
  })

  // Recent payment failures (last 7 days)
  const failedPayments = await db.payment.findMany({
    where: {
      status: 'failed',
      createdAt: { gte: sevenDaysAgo },
    },
    select: {
      id: true,
      subscriptionId: true,
      amountCents: true,
      currency: true,
      createdAt: true,
      subscription: {
        select: {
          id: true,
          status: true,
          creator: {
            select: {
              profile: {
                select: { displayName: true, username: true },
              },
            },
          },
          subscriber: {
            select: { email: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  // Group failures by subscription
  const failuresBySubscription = new Map<string, { count: number; lastAttempt: Date; amount: number }>()
  for (const payment of failedPayments) {
    if (!payment.subscriptionId) continue
    const existing = failuresBySubscription.get(payment.subscriptionId)
    if (existing) {
      existing.count++
      if (payment.createdAt > existing.lastAttempt) {
        existing.lastAttempt = payment.createdAt
      }
    } else {
      failuresBySubscription.set(payment.subscriptionId, {
        count: 1,
        lastAttempt: payment.createdAt,
        amount: payment.amountCents,
      })
    }
  }

  // Subscriptions expiring soon (next 14 days, already cancelled)
  const expiringSoon = await db.subscription.findMany({
    where: {
      canceledAt: { not: null },
      currentPeriodEnd: {
        gte: now,
        lte: fourteenDaysAhead,
      },
    },
    select: {
      id: true,
      subscriberId: true,
      creatorId: true,
      amountCents: true,
      currency: true,
      currentPeriodEnd: true,
      cancelReason: true,
      creator: {
        select: {
          profile: {
            select: { displayName: true, username: true },
          },
        },
      },
      subscriber: {
        select: { email: true },
      },
    },
    orderBy: { currentPeriodEnd: 'asc' },
    take: 50,
  })

  // Creators with high churn (>30% in last 30 days)
  const highChurnCreators = await db.$queryRaw<Array<{
    creator_id: string
    total_subs: bigint
    cancelled_count: bigint
    churn_rate: number
  }>>`
    SELECT
      "creatorId" as creator_id,
      COUNT(*)::bigint as total_subs,
      COUNT(CASE WHEN "canceledAt" >= ${sevenDaysAgo} THEN 1 END)::bigint as cancelled_count,
      (COUNT(CASE WHEN "canceledAt" >= ${sevenDaysAgo} THEN 1 END)::float / NULLIF(COUNT(*), 0) * 100) as churn_rate
    FROM "Subscription"
    WHERE "createdAt" < ${sevenDaysAgo}
    GROUP BY "creatorId"
    HAVING COUNT(*) >= 5
      AND COUNT(CASE WHEN "canceledAt" >= ${sevenDaysAgo} THEN 1 END)::float / NULLIF(COUNT(*), 0) > 0.30
    ORDER BY churn_rate DESC
    LIMIT 20
  `

  // Get creator details for high churn
  const highChurnCreatorIds = highChurnCreators.map(c => c.creator_id)
  const highChurnCreatorDetails = await db.user.findMany({
    where: { id: { in: highChurnCreatorIds } },
    select: {
      id: true,
      profile: {
        select: { displayName: true, username: true },
      },
    },
  })
  const highChurnCreatorMap = new Map(highChurnCreatorDetails.map(c => [c.id, c]))

  return c.json({
    pastDue: {
      count: pastDue.length,
      totalMrrAtRisk: pastDue.reduce((sum, s) => sum + s.amountCents, 0),
      subscriptions: pastDue.map(s => ({
        id: s.id,
        subscriberEmail: s.subscriber?.email,
        creatorName: s.creator?.profile?.displayName || s.creator?.profile?.username,
        amount: s.amountCents,
        currency: s.currency,
        daysPastDue: Math.floor((now.getTime() - (s.currentPeriodEnd?.getTime() || now.getTime())) / (1000 * 60 * 60 * 24)),
      })),
    },
    failedPayments: {
      count: failuresBySubscription.size,
      subscriptions: Array.from(failuresBySubscription.entries())
        .map(([subId, data]) => {
          const payment = failedPayments.find(p => p.subscriptionId === subId)
          return {
            subscriptionId: subId,
            failureCount: data.count,
            lastAttempt: data.lastAttempt.toISOString(),
            amount: data.amount,
            status: payment?.subscription?.status,
            subscriberEmail: payment?.subscription?.subscriber?.email,
            creatorName: payment?.subscription?.creator?.profile?.displayName,
          }
        })
        .sort((a, b) => b.failureCount - a.failureCount),
    },
    expiringSoon: {
      count: expiringSoon.length,
      totalMrrExpiring: expiringSoon.reduce((sum, s) => sum + s.amountCents, 0),
      subscriptions: expiringSoon.map(s => ({
        id: s.id,
        subscriberEmail: s.subscriber?.email,
        creatorName: s.creator?.profile?.displayName || s.creator?.profile?.username,
        amount: s.amountCents,
        currency: s.currency,
        expiresIn: Math.floor(((s.currentPeriodEnd?.getTime() || now.getTime()) - now.getTime()) / (1000 * 60 * 60 * 24)),
        cancelReason: s.cancelReason,
      })),
    },
    highChurnCreators: highChurnCreators.map(c => {
      const creator = highChurnCreatorMap.get(c.creator_id)
      return {
        creatorId: c.creator_id,
        displayName: creator?.profile?.displayName,
        username: creator?.profile?.username,
        totalSubscribers: Number(c.total_subs),
        recentCancellations: Number(c.cancelled_count),
        churnRate: parseFloat((c.churn_rate || 0).toFixed(1)),
      }
    }),
  })
})

/**
 * GET /admin/analytics/cohort/:month
 * Cohort retention analysis for a specific month
 */
analytics.get('/cohort/:month', async (c) => {
  const monthStr = c.req.param('month') // Expected format: YYYY-MM
  const match = monthStr.match(/^(\d{4})-(\d{2})$/)

  if (!match) {
    return c.json({ error: 'Invalid month format. Use YYYY-MM' }, 400)
  }

  const year = parseInt(match[1])
  const month = parseInt(match[2])

  const cohortStart = new Date(year, month - 1, 1)
  const cohortEnd = new Date(year, month, 1)
  const now = new Date()

  // Get all subscriptions created in this cohort month
  const cohortSubscriptions = await db.subscription.findMany({
    where: {
      createdAt: { gte: cohortStart, lt: cohortEnd },
    },
    select: {
      id: true,
      createdAt: true,
      canceledAt: true,
      status: true,
      amountCents: true,
    },
  })

  if (cohortSubscriptions.length === 0) {
    return c.json({
      cohortMonth: monthStr,
      message: 'No subscriptions in this cohort',
      totalSubscribers: 0,
      retention: [],
    })
  }

  // Calculate retention for each subsequent month
  const monthsElapsed = Math.min(
    Math.floor((now.getTime() - cohortStart.getTime()) / (30 * 24 * 60 * 60 * 1000)),
    24 // Max 24 months of retention data
  )

  const retention: Array<{
    monthNumber: number
    monthLabel: string
    retained: number
    retentionRate: number
    revenue: number
  }> = []

  for (let m = 0; m <= monthsElapsed; m++) {
    const checkDate = new Date(year, month - 1 + m + 1, 1) // End of month m

    let retained = 0
    let revenue = 0

    for (const sub of cohortSubscriptions) {
      // Subscription is retained if it wasn't cancelled before this check date
      const isRetained = !sub.canceledAt || sub.canceledAt >= checkDate
      if (isRetained) {
        retained++
        revenue += sub.amountCents
      }
    }

    const monthLabel = new Date(year, month - 1 + m, 1).toLocaleString('en', { month: 'short', year: '2-digit' })

    retention.push({
      monthNumber: m,
      monthLabel,
      retained,
      retentionRate: parseFloat(((retained / cohortSubscriptions.length) * 100).toFixed(1)),
      revenue,
    })
  }

  // Calculate cohort LTV
  const totalRevenue = retention.reduce((sum, r) => sum + r.revenue, 0)
  const avgLtv = totalRevenue / cohortSubscriptions.length

  // Get cancellation reasons for this cohort
  const cancelReasons = cohortSubscriptions
    .filter(s => s.canceledAt)
    .reduce((acc, s) => {
      acc['unknown'] = (acc['unknown'] || 0) + 1
      return acc
    }, {} as Record<string, number>)

  return c.json({
    cohortMonth: monthStr,
    totalSubscribers: cohortSubscriptions.length,
    currentlyActive: cohortSubscriptions.filter(s => !s.canceledAt).length,
    cancelled: cohortSubscriptions.filter(s => s.canceledAt).length,
    avgLtv: Math.round(avgLtv),
    retention,
    cancelReasons: Object.entries(cancelReasons)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  })
})

/**
 * GET /admin/analytics/mrr
 * Monthly Recurring Revenue trends
 */
analytics.get('/mrr', async (c) => {
  const query = z.object({
    months: z.coerce.number().min(1).max(24).default(12),
  }).parse(c.req.query())

  const now = new Date()
  const monthlyData: Array<{
    month: string
    activeSubscriptions: number
    mrr: number
    newSubscriptions: number
    churned: number
    netGrowth: number
  }> = []

  for (let i = query.months - 1; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
    const monthLabel = monthStart.toLocaleString('en', { month: 'short', year: 'numeric' })

    // Active subscriptions at end of month
    const active = await db.subscription.count({
      where: {
        createdAt: { lt: monthEnd },
        OR: [
          { canceledAt: null },
          { canceledAt: { gte: monthEnd } },
        ],
        status: { in: ['active', 'past_due'] },
      },
    })

    // MRR at end of month
    const mrrResult = await db.subscription.aggregate({
      where: {
        createdAt: { lt: monthEnd },
        OR: [
          { canceledAt: null },
          { canceledAt: { gte: monthEnd } },
        ],
        status: { in: ['active', 'past_due'] },
      },
      _sum: { amountCents: true },
    })

    // New subscriptions in month
    const newSubs = await db.subscription.count({
      where: {
        createdAt: { gte: monthStart, lt: monthEnd },
      },
    })

    // Churned in month
    const churned = await db.subscription.count({
      where: {
        canceledAt: { gte: monthStart, lt: monthEnd },
      },
    })

    monthlyData.push({
      month: monthLabel,
      activeSubscriptions: active,
      mrr: mrrResult._sum?.amountCents || 0,
      newSubscriptions: newSubs,
      churned,
      netGrowth: newSubs - churned,
    })
  }

  // Current totals
  const currentMrr = monthlyData[monthlyData.length - 1]?.mrr || 0
  const previousMrr = monthlyData[monthlyData.length - 2]?.mrr || 0
  const mrrGrowth = previousMrr > 0 ? ((currentMrr - previousMrr) / previousMrr) * 100 : 0

  return c.json({
    current: {
      mrr: currentMrr,
      mrrFormatted: `$${(currentMrr / 100).toLocaleString()}`,
      activeSubscriptions: monthlyData[monthlyData.length - 1]?.activeSubscriptions || 0,
      monthOverMonthGrowth: parseFloat(mrrGrowth.toFixed(1)),
    },
    trend: monthlyData,
  })
})

export default analytics
