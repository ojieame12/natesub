/**
 * Admin Revenue Routes
 *
 * Revenue and fee analytics for admin dashboard.
 * Separated from main admin.ts for clarity.
 *
 * Accessible via:
 * 1. ADMIN_API_KEY header (for Retool/external tools)
 * 2. Valid user session with email in admin whitelist (for frontend dashboard)
 */

import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { db } from '../db/client.js'
import { adminAuth } from '../middleware/adminAuth.js'
import { todayStart, thisMonthStart, previousMonth, lastNDays, lastNMonths, parsePeriod, BUSINESS_TIMEZONE } from '../utils/timezone.js'
import { cached, CACHE_TTL, adminRevenueKey } from '../utils/cache.js'

const adminRevenue = new Hono()

type PaymentStats = {
  totalVolumeCents: number
  platformFeeCents: number
  creatorPayoutsCents: number
  paymentCount: number
}

async function aggregatePaymentStats(where: any): Promise<PaymentStats> {
  const [agg, legacyVolume] = await Promise.all([
    db.payment.aggregate({
      where,
      _sum: { grossCents: true, feeCents: true, netCents: true },
      _count: true,
    }),
    db.payment.aggregate({
      where: { ...where, grossCents: null },
      _sum: { amountCents: true },
      _count: true,
    }),
  ])

  return {
    totalVolumeCents: (agg._sum.grossCents || 0) + (legacyVolume._sum.amountCents || 0),
    platformFeeCents: agg._sum.feeCents || 0,
    creatorPayoutsCents: agg._sum.netCents || 0,
    paymentCount: agg._count,
  }
}

async function aggregateGrossOnly(where: any): Promise<{ totalCents: number; count: number }> {
  const [agg, legacyVolume] = await Promise.all([
    db.payment.aggregate({
      where,
      _sum: { grossCents: true },
      _count: true,
    }),
    db.payment.aggregate({
      where: { ...where, grossCents: null },
      _sum: { amountCents: true },
      _count: true,
    }),
  ])

  return {
    totalCents: (agg._sum.grossCents || 0) + (legacyVolume._sum.amountCents || 0),
    count: agg._count,
  }
}

// Use centralized admin auth middleware
adminRevenue.use('*', adminAuth)

// ============================================
// REVENUE OVERVIEW
// ============================================

/**
 * GET /admin/revenue/overview
 * High-level revenue metrics
 * Cached for 60 seconds to prevent repeated full-table scans
 */
adminRevenue.get('/overview', async (c) => {
  const result = await cached(
    adminRevenueKey('overview'),
    CACHE_TTL.SHORT, // 60 seconds
    async () => {
      // Use timezone-aware dates for consistent reporting
      const startOfDay = todayStart()
      const startOfMonth = thisMonthStart()
      const { start: startOfLastMonth, end: endOfLastMonth } = previousMonth()

      const [
        allTimeStats,
        thisMonthStats,
        lastMonthStats,
        todayStats,
        // Payment counts
        paymentCounts,
        lastPayment,
        lastProcessedWebhook,
      ] = await Promise.all([
        aggregatePaymentStats({ status: 'succeeded', type: { in: ['recurring', 'one_time'] } }),
        aggregatePaymentStats({ status: 'succeeded', type: { in: ['recurring', 'one_time'] }, occurredAt: { gte: startOfMonth } }),
        aggregatePaymentStats({ status: 'succeeded', type: { in: ['recurring', 'one_time'] }, occurredAt: { gte: startOfLastMonth, lte: endOfLastMonth } }),
        aggregatePaymentStats({ status: 'succeeded', type: { in: ['recurring', 'one_time'] }, occurredAt: { gte: startOfDay } }),
        db.payment.groupBy({
          by: ['status'],
          where: { type: { in: ['recurring', 'one_time'] } },
          _count: true
        }),
        db.payment.findFirst({
          where: { status: 'succeeded', type: { in: ['recurring', 'one_time'] } },
          orderBy: { occurredAt: 'desc' },
          select: { occurredAt: true },
        }),
        db.webhookEvent.findFirst({
          where: { status: 'processed', processedAt: { not: null } },
          orderBy: { processedAt: 'desc' },
          select: { processedAt: true, provider: true, eventType: true },
        }),
      ])

      const statusCounts = Object.fromEntries(paymentCounts.map(p => [p.status, p._count]))

      return {
        allTime: allTimeStats,
        thisMonth: thisMonthStats,
        lastMonth: lastMonthStats,
        today: todayStats,
        paymentsByStatus: statusCounts,
        freshness: {
          businessTimezone: BUSINESS_TIMEZONE,
          lastPaymentAt: lastPayment?.occurredAt ? lastPayment.occurredAt.toISOString() : null,
          lastWebhookProcessedAt: lastProcessedWebhook?.processedAt ? lastProcessedWebhook.processedAt.toISOString() : null,
          lastWebhookProvider: lastProcessedWebhook?.provider || null,
          lastWebhookType: lastProcessedWebhook?.eventType || null,
        },
      }
    }
  )

  return c.json(result)
})

// ============================================
// REVENUE BY PROVIDER
// ============================================

/**
 * GET /admin/revenue/by-provider
 * Revenue breakdown by payment provider (Stripe vs Paystack)
 * Cached for 5 minutes
 */
adminRevenue.get('/by-provider', async (c) => {
  const query = z.object({
    period: z.enum(['today', 'week', 'month', 'year', 'all']).default('month')
  }).parse(c.req.query())

  const result = await cached(
    adminRevenueKey('by-provider', { period: query.period }),
    CACHE_TTL.MEDIUM, // 5 minutes
    async () => {
      // Use timezone-aware date parsing
      const { start: startDate } = parsePeriod(query.period)

      const where: any = { status: 'succeeded', type: { in: ['recurring', 'one_time'] } }
      if (startDate) where.occurredAt = { gte: startDate }

      // Get Stripe payments (have stripePaymentIntentId)
      const [stripeStats, paystackStats] = await Promise.all([
        aggregatePaymentStats({ ...where, stripePaymentIntentId: { not: null } }),
        aggregatePaymentStats({ ...where, paystackTransactionRef: { not: null } })
      ])

      return {
        period: query.period,
        stripe: stripeStats,
        paystack: paystackStats
      }
    }
  )

  return c.json(result)
})

// ============================================
// REVENUE BY CURRENCY
// ============================================

/**
 * GET /admin/revenue/by-currency
 * Revenue breakdown by currency
 */
adminRevenue.get('/by-currency', async (c) => {
  const query = z.object({
    period: z.enum(['today', 'week', 'month', 'year', 'all']).default('month')
  }).parse(c.req.query())

  const result = await cached(
    adminRevenueKey('by-currency', { period: query.period }),
    CACHE_TTL.MEDIUM, // 5 minutes
    async () => {
      // Use timezone-aware date parsing
      const { start: startDate } = parsePeriod(query.period)

      const where: any = { status: 'succeeded', type: { in: ['recurring', 'one_time'] } }
      if (startDate) where.occurredAt = { gte: startDate }

      const [byCurrency, legacyByCurrency] = await Promise.all([
        db.payment.groupBy({
          by: ['currency'],
          where,
          _sum: { grossCents: true, feeCents: true, netCents: true },
          _count: true
        }),
        db.payment.groupBy({
          by: ['currency'],
          where: { ...where, grossCents: null },
          _sum: { amountCents: true },
          _count: true
        })
      ])

      const legacyMap = new Map(legacyByCurrency.map(c => [c.currency, c._sum.amountCents || 0]))

      return {
        period: query.period,
        currencies: byCurrency.map(c => ({
          currency: c.currency,
          totalVolumeCents: (c._sum.grossCents || 0) + (legacyMap.get(c.currency) || 0),
          platformFeeCents: c._sum.feeCents || 0,
          creatorPayoutsCents: c._sum.netCents || 0,
          paymentCount: c._count
        }))
      }
    }
  )

  return c.json(result)
})

// ============================================
// DAILY REVENUE TREND
// ============================================

/**
 * GET /admin/revenue/daily
 * Daily revenue for the last N days
 * Cached for 5 minutes
 */
adminRevenue.get('/daily', async (c) => {
  const query = z.object({
    days: z.coerce.number().default(30)
  }).parse(c.req.query())

  const result = await cached(
    adminRevenueKey('daily', { days: query.days }),
    CACHE_TTL.MEDIUM, // 5 minutes
    async () => {
      // Use timezone-aware date range
      const { start: startDate, end: endDate } = lastNDays(query.days)

      // Unit tests run with an in-memory Prisma mock that does not implement $queryRaw.
      // Keep a JS aggregation fallback so tests remain meaningful while production stays fast.
      if (process.env.NODE_ENV === 'test') {
        const payments = await db.payment.findMany({
          where: {
            status: 'succeeded',
            type: { in: ['recurring', 'one_time'] },
            occurredAt: { gte: startDate, lte: endDate }
          },
          select: {
            grossCents: true,
            amountCents: true,
            feeCents: true,
            netCents: true,
            occurredAt: true
          }
        })

        const dailyMap = new Map<string, { volume: number; fees: number; payouts: number; count: number }>()

        for (const p of payments) {
          const day = p.occurredAt.toISOString().split('T')[0]
          const existing = dailyMap.get(day) || { volume: 0, fees: 0, payouts: 0, count: 0 }
          existing.volume += p.grossCents ?? p.amountCents
          existing.fees += p.feeCents || 0
          existing.payouts += p.netCents || 0
          existing.count += 1
          dailyMap.set(day, existing)
        }

        const days: Array<{ date: string; volumeCents: number; feesCents: number; payoutsCents: number; count: number }> = []
        const current = new Date(startDate)

        while (current <= endDate) {
          const day = current.toISOString().split('T')[0]
          const data = dailyMap.get(day) || { volume: 0, fees: 0, payouts: 0, count: 0 }
          days.push({
            date: day,
            volumeCents: data.volume,
            feesCents: data.fees,
            payoutsCents: data.payouts,
            count: data.count
          })
          current.setDate(current.getDate() + 1)
        }

        return { days }
      }

      // Database aggregation (faster than pulling all rows)
      const rows = await db.$queryRaw<Array<{
        date: string
        volumeCents: unknown
        feesCents: unknown
        payoutsCents: unknown
        count: number
      }>>`
          WITH days AS (
            SELECT generate_series(${startDate}::date, ${endDate}::date, interval '1 day')::date AS day
          ),
          agg AS (
            SELECT
              date_trunc('day', "occurredAt")::date AS day,
              SUM(COALESCE("grossCents", "amountCents"))::bigint AS "volumeCents",
              SUM("feeCents")::bigint AS "feesCents",
              SUM("netCents")::bigint AS "payoutsCents",
              COUNT(*)::int AS count
            FROM "payments"
            WHERE "status" = 'succeeded'
              AND "type" IN ('recurring', 'one_time')
              AND "occurredAt" >= ${startDate}
              AND "occurredAt" <= ${endDate}
            GROUP BY 1
          )
          SELECT
            to_char(days.day, 'YYYY-MM-DD') AS date,
            COALESCE(agg."volumeCents", 0)::bigint AS "volumeCents",
            COALESCE(agg."feesCents", 0)::bigint AS "feesCents",
            COALESCE(agg."payoutsCents", 0)::bigint AS "payoutsCents",
            COALESCE(agg.count, 0)::int AS count
          FROM days
          LEFT JOIN agg ON agg.day = days.day
          ORDER BY days.day ASC;
        `

      const days = rows.map((r) => ({
        date: r.date,
        volumeCents: Number(r.volumeCents),
        feesCents: Number(r.feesCents),
        payoutsCents: Number(r.payoutsCents),
        count: Number(r.count),
      }))

      return { days }
    }
  )

  return c.json(result)
})

// ============================================
// MONTHLY REVENUE TREND
// ============================================

/**
 * GET /admin/revenue/monthly
 * Monthly revenue for the last N months
 * Cached for 15 minutes (historical data changes slowly)
 */
adminRevenue.get('/monthly', async (c) => {
  const query = z.object({
    months: z.coerce.number().default(12)
  }).parse(c.req.query())

  const result = await cached(
    adminRevenueKey('monthly', { months: query.months }),
    CACHE_TTL.LONG, // 15 minutes
    async () => {
      // Use timezone-aware date range
      const { start: startDate, end: endDate } = lastNMonths(query.months)

      if (process.env.NODE_ENV === 'test') {
        const payments = await db.payment.findMany({
          where: {
            status: 'succeeded',
            type: { in: ['recurring', 'one_time'] },
            occurredAt: { gte: startDate, lte: endDate }
          },
          select: {
            grossCents: true,
            amountCents: true,
            feeCents: true,
            netCents: true,
            occurredAt: true
          }
        })

        const monthlyMap = new Map<string, { volume: number; fees: number; payouts: number; count: number }>()
        for (const p of payments) {
          const month = p.occurredAt.toISOString().slice(0, 7)
          const existing = monthlyMap.get(month) || { volume: 0, fees: 0, payouts: 0, count: 0 }
          existing.volume += p.grossCents ?? p.amountCents
          existing.fees += p.feeCents || 0
          existing.payouts += p.netCents || 0
          existing.count += 1
          monthlyMap.set(month, existing)
        }

        const months: Array<{ month: string; volumeCents: number; feesCents: number; payoutsCents: number; count: number }> = []

        const current = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1))
        const endMonth = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1))

        while (current <= endMonth) {
          const key = current.toISOString().slice(0, 7)
          const data = monthlyMap.get(key) || { volume: 0, fees: 0, payouts: 0, count: 0 }
          months.push({
            month: key,
            volumeCents: data.volume,
            feesCents: data.fees,
            payoutsCents: data.payouts,
            count: data.count,
          })
          current.setUTCMonth(current.getUTCMonth() + 1)
        }

        return { months }
      }

      const rows = await db.$queryRaw<Array<{
        month: string
        volumeCents: unknown
        feesCents: unknown
        payoutsCents: unknown
        count: number
      }>>`
          WITH months AS (
            SELECT generate_series(
              date_trunc('month', ${startDate}::date),
              date_trunc('month', ${endDate}::date),
              interval '1 month'
            )::date AS month
          ),
          agg AS (
            SELECT
              date_trunc('month', "occurredAt")::date AS month,
              SUM(COALESCE("grossCents", "amountCents"))::bigint AS "volumeCents",
              SUM("feeCents")::bigint AS "feesCents",
              SUM("netCents")::bigint AS "payoutsCents",
              COUNT(*)::int AS count
            FROM "payments"
            WHERE "status" = 'succeeded'
              AND "type" IN ('recurring', 'one_time')
              AND "occurredAt" >= ${startDate}
              AND "occurredAt" <= ${endDate}
            GROUP BY 1
          )
          SELECT
            to_char(months.month, 'YYYY-MM') AS month,
            COALESCE(agg."volumeCents", 0)::bigint AS "volumeCents",
            COALESCE(agg."feesCents", 0)::bigint AS "feesCents",
            COALESCE(agg."payoutsCents", 0)::bigint AS "payoutsCents",
            COALESCE(agg.count, 0)::int AS count
          FROM months
          LEFT JOIN agg ON agg.month = months.month
          ORDER BY months.month ASC;
        `

      const months = rows.map((r) => ({
        month: r.month,
        volumeCents: Number(r.volumeCents),
        feesCents: Number(r.feesCents),
        payoutsCents: Number(r.payoutsCents),
        count: Number(r.count),
      }))

      return { months }
    }
  )

  return c.json(result)
})

// ============================================
// TOP CREATORS BY REVENUE
// ============================================

/**
 * GET /admin/revenue/top-creators
 * Top creators by revenue
 * Cached for 5 minutes
 */
adminRevenue.get('/top-creators', async (c) => {
  const query = z.object({
    limit: z.coerce.number().default(20),
    period: z.enum(['today', 'week', 'month', 'year', 'all']).default('month')
  }).parse(c.req.query())

  const result = await cached(
    adminRevenueKey('top-creators', { limit: query.limit, period: query.period }),
    CACHE_TTL.MEDIUM, // 5 minutes
    async () => {
      // Use timezone-aware date parsing
      const { start: startDate } = parsePeriod(query.period)

      const where: any = { status: 'succeeded', type: { in: ['recurring', 'one_time'] } }
      if (startDate) where.occurredAt = { gte: startDate }

      const [topCreators, legacyTopCreators] = await Promise.all([
        db.payment.groupBy({
          by: ['creatorId'],
          where,
          _sum: { grossCents: true, feeCents: true, netCents: true },
          _count: true,
        }),
        db.payment.groupBy({
          by: ['creatorId'],
          where: { ...where, grossCents: null },
          _sum: { amountCents: true },
          _count: true,
        }),
      ])

      const legacyMap = new Map(legacyTopCreators.map(c => [c.creatorId, c._sum.amountCents || 0]))

      const combined = topCreators.map(tc => ({
        creatorId: tc.creatorId,
        totalVolumeCents: (tc._sum.grossCents || 0) + (legacyMap.get(tc.creatorId) || 0),
        platformFeeCents: tc._sum.feeCents || 0,
        creatorEarningsCents: tc._sum.netCents || 0,
        paymentCount: tc._count,
      }))

      combined.sort((a, b) => b.totalVolumeCents - a.totalVolumeCents)
      const top = combined.slice(0, query.limit)

      // Get creator details
      const creatorIds = top.map(c => c.creatorId)
      const creators = await db.user.findMany({
        where: { id: { in: creatorIds } },
        select: {
          id: true,
          email: true,
          profile: { select: { username: true, displayName: true, country: true } }
        }
      })

      const creatorMap = new Map(creators.map(c => [c.id, c]))

      return {
        period: query.period,
        creators: top.map(tc => {
          const creator = creatorMap.get(tc.creatorId)
          return {
            creatorId: tc.creatorId,
            email: creator?.email,
            username: creator?.profile?.username,
            displayName: creator?.profile?.displayName,
            country: creator?.profile?.country,
            totalVolumeCents: tc.totalVolumeCents,
            platformFeeCents: tc.platformFeeCents,
            creatorEarningsCents: tc.creatorEarningsCents,
            paymentCount: tc.paymentCount
          }
        })
      }
    }
  )

  return c.json(result)
})

// ============================================
// REFUNDS & DISPUTES
// ============================================

/**
 * GET /admin/revenue/refunds
 * Refund and dispute statistics
 */
adminRevenue.get('/refunds', async (c) => {
  const query = z.object({
    period: z.enum(['today', 'week', 'month', 'year', 'all']).default('month')
  }).parse(c.req.query())

  const result = await cached(
    adminRevenueKey('refunds', { period: query.period }),
    CACHE_TTL.SHORT, // 60 seconds
    async () => {
      // Use timezone-aware date parsing
      const { start: startDate } = parsePeriod(query.period)

      const where: any = {}
      if (startDate) where.occurredAt = { gte: startDate }

      const [refunded, disputed, disputeLost] = await Promise.all([
        aggregateGrossOnly({ ...where, status: 'refunded' }),
        aggregateGrossOnly({ ...where, status: 'disputed' }),
        aggregateGrossOnly({ ...where, status: 'dispute_lost' })
      ])

      return {
        period: query.period,
        refunds: {
          totalCents: refunded.totalCents,
          count: refunded.count
        },
        disputes: {
          totalCents: disputed.totalCents,
          count: disputed.count
        },
        chargebacks: {
          totalCents: disputeLost.totalCents,
          count: disputeLost.count
        }
      }
    }
  )

  return c.json(result)
})

export default adminRevenue
