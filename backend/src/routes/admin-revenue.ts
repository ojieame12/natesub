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
import { getCookie } from 'hono/cookie'
import { z } from 'zod'
import { db } from '../db/client.js'
import { validateSession } from '../services/auth.js'
import { isAdminEmail } from '../config/admin.js'

const adminRevenue = new Hono()

// Get session token from cookie or Authorization header
function getSessionToken(c: any): string | undefined {
  const cookieToken = getCookie(c, 'session')
  if (cookieToken) return cookieToken
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7)
  return undefined
}

// Admin auth middleware - requires ADMIN_API_KEY OR valid admin user session
adminRevenue.use('*', async (c, next) => {
  // Option 1: API key auth (for Retool/external tools)
  const apiKey = c.req.header('x-admin-api-key')
  const expectedKey = process.env.ADMIN_API_KEY

  if (apiKey && expectedKey && apiKey === expectedKey) {
    await next()
    return
  }

  // Option 2: User session auth (for frontend dashboard)
  const sessionToken = getSessionToken(c)
  if (sessionToken) {
    const session = await validateSession(sessionToken)
    if (session) {
      const user = await db.user.findUnique({
        where: { id: session.userId },
        select: { email: true },
      })
      if (user && isAdminEmail(user.email)) {
        await next()
        return
      }
    }
  }

  throw new HTTPException(401, { message: 'Admin access required' })
})

// ============================================
// REVENUE OVERVIEW
// ============================================

/**
 * GET /admin/revenue/overview
 * High-level revenue metrics
 */
adminRevenue.get('/overview', async (c) => {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0)

  const [
    // All-time totals
    allTimeStats,
    // This month
    thisMonthStats,
    // Last month (for comparison)
    lastMonthStats,
    // Today
    todayStats,
    // Payment counts
    paymentCounts
  ] = await Promise.all([
    db.payment.aggregate({
      where: { status: 'succeeded', type: { in: ['recurring', 'one_time'] } },
      _sum: { grossCents: true, feeCents: true, netCents: true },
      _count: true
    }),
    db.payment.aggregate({
      where: { status: 'succeeded', type: { in: ['recurring', 'one_time'] }, createdAt: { gte: startOfMonth } },
      _sum: { grossCents: true, feeCents: true, netCents: true },
      _count: true
    }),
    db.payment.aggregate({
      where: { status: 'succeeded', type: { in: ['recurring', 'one_time'] }, createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } },
      _sum: { grossCents: true, feeCents: true, netCents: true },
      _count: true
    }),
    db.payment.aggregate({
      where: { status: 'succeeded', type: { in: ['recurring', 'one_time'] }, createdAt: { gte: startOfDay } },
      _sum: { grossCents: true, feeCents: true, netCents: true },
      _count: true
    }),
    db.payment.groupBy({
      by: ['status'],
      where: { type: { in: ['recurring', 'one_time'] } },
      _count: true
    })
  ])

  const statusCounts = Object.fromEntries(paymentCounts.map(p => [p.status, p._count]))

  return c.json({
    allTime: {
      totalVolumeCents: allTimeStats._sum.grossCents || 0,
      platformFeeCents: allTimeStats._sum.feeCents || 0,
      creatorPayoutsCents: allTimeStats._sum.netCents || 0,
      paymentCount: allTimeStats._count
    },
    thisMonth: {
      totalVolumeCents: thisMonthStats._sum.grossCents || 0,
      platformFeeCents: thisMonthStats._sum.feeCents || 0,
      creatorPayoutsCents: thisMonthStats._sum.netCents || 0,
      paymentCount: thisMonthStats._count
    },
    lastMonth: {
      totalVolumeCents: lastMonthStats._sum.grossCents || 0,
      platformFeeCents: lastMonthStats._sum.feeCents || 0,
      creatorPayoutsCents: lastMonthStats._sum.netCents || 0,
      paymentCount: lastMonthStats._count
    },
    today: {
      totalVolumeCents: todayStats._sum.grossCents || 0,
      platformFeeCents: todayStats._sum.feeCents || 0,
      creatorPayoutsCents: todayStats._sum.netCents || 0,
      paymentCount: todayStats._count
    },
    paymentsByStatus: statusCounts
  })
})

// ============================================
// REVENUE BY PROVIDER
// ============================================

/**
 * GET /admin/revenue/by-provider
 * Revenue breakdown by payment provider (Stripe vs Paystack)
 */
adminRevenue.get('/by-provider', async (c) => {
  const query = z.object({
    period: z.enum(['today', 'week', 'month', 'year', 'all']).default('month')
  }).parse(c.req.query())

  const now = new Date()
  let startDate: Date | undefined

  switch (query.period) {
    case 'today':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      break
    case 'week':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      break
    case 'month':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    case 'year':
      startDate = new Date(now.getFullYear(), 0, 1)
      break
    case 'all':
      startDate = undefined
      break
  }

  const where: any = { status: 'succeeded', type: { in: ['recurring', 'one_time'] } }
  if (startDate) where.createdAt = { gte: startDate }

  // Get Stripe payments (have stripePaymentIntentId)
  const [stripeStats, paystackStats] = await Promise.all([
    db.payment.aggregate({
      where: { ...where, stripePaymentIntentId: { not: null } },
      _sum: { grossCents: true, feeCents: true, netCents: true },
      _count: true
    }),
    db.payment.aggregate({
      where: { ...where, paystackTransactionRef: { not: null } },
      _sum: { grossCents: true, feeCents: true, netCents: true },
      _count: true
    })
  ])

  return c.json({
    period: query.period,
    stripe: {
      totalVolumeCents: stripeStats._sum.grossCents || 0,
      platformFeeCents: stripeStats._sum.feeCents || 0,
      creatorPayoutsCents: stripeStats._sum.netCents || 0,
      paymentCount: stripeStats._count
    },
    paystack: {
      totalVolumeCents: paystackStats._sum.grossCents || 0,
      platformFeeCents: paystackStats._sum.feeCents || 0,
      creatorPayoutsCents: paystackStats._sum.netCents || 0,
      paymentCount: paystackStats._count
    }
  })
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

  const now = new Date()
  let startDate: Date | undefined

  switch (query.period) {
    case 'today':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      break
    case 'week':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      break
    case 'month':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    case 'year':
      startDate = new Date(now.getFullYear(), 0, 1)
      break
    case 'all':
      startDate = undefined
      break
  }

  const where: any = { status: 'succeeded', type: { in: ['recurring', 'one_time'] } }
  if (startDate) where.createdAt = { gte: startDate }

  const byCurrency = await db.payment.groupBy({
    by: ['currency'],
    where,
    _sum: { grossCents: true, feeCents: true, netCents: true },
    _count: true
  })

  return c.json({
    period: query.period,
    currencies: byCurrency.map(c => ({
      currency: c.currency,
      totalVolumeCents: c._sum.grossCents || 0,
      platformFeeCents: c._sum.feeCents || 0,
      creatorPayoutsCents: c._sum.netCents || 0,
      paymentCount: c._count
    }))
  })
})

// ============================================
// DAILY REVENUE TREND
// ============================================

/**
 * GET /admin/revenue/daily
 * Daily revenue for the last N days
 */
adminRevenue.get('/daily', async (c) => {
  const query = z.object({
    days: z.coerce.number().default(30)
  }).parse(c.req.query())

  const startDate = new Date()
  startDate.setDate(startDate.getDate() - query.days)
  startDate.setHours(0, 0, 0, 0)

  // Get all payments in the period
  const payments = await db.payment.findMany({
    where: {
      status: 'succeeded',
      type: { in: ['recurring', 'one_time'] },
      createdAt: { gte: startDate }
    },
    select: {
      grossCents: true,
      feeCents: true,
      netCents: true,
      createdAt: true
    }
  })

  // Aggregate by day
  const dailyMap = new Map<string, { volume: number; fees: number; payouts: number; count: number }>()

  for (const p of payments) {
    const day = p.createdAt.toISOString().split('T')[0]
    const existing = dailyMap.get(day) || { volume: 0, fees: 0, payouts: 0, count: 0 }
    existing.volume += p.grossCents || 0
    existing.fees += p.feeCents || 0
    existing.payouts += p.netCents || 0
    existing.count += 1
    dailyMap.set(day, existing)
  }

  // Fill in missing days with zeros
  const result: Array<{ date: string; volumeCents: number; feesCents: number; payoutsCents: number; count: number }> = []
  const current = new Date(startDate)
  const today = new Date()

  while (current <= today) {
    const day = current.toISOString().split('T')[0]
    const data = dailyMap.get(day) || { volume: 0, fees: 0, payouts: 0, count: 0 }
    result.push({
      date: day,
      volumeCents: data.volume,
      feesCents: data.fees,
      payoutsCents: data.payouts,
      count: data.count
    })
    current.setDate(current.getDate() + 1)
  }

  return c.json({ days: result })
})

// ============================================
// MONTHLY REVENUE TREND
// ============================================

/**
 * GET /admin/revenue/monthly
 * Monthly revenue for the last N months
 */
adminRevenue.get('/monthly', async (c) => {
  const query = z.object({
    months: z.coerce.number().default(12)
  }).parse(c.req.query())

  const startDate = new Date()
  startDate.setMonth(startDate.getMonth() - query.months)
  startDate.setDate(1)
  startDate.setHours(0, 0, 0, 0)

  const payments = await db.payment.findMany({
    where: {
      status: 'succeeded',
      type: { in: ['recurring', 'one_time'] },
      createdAt: { gte: startDate }
    },
    select: {
      grossCents: true,
      feeCents: true,
      netCents: true,
      createdAt: true
    }
  })

  // Aggregate by month
  const monthlyMap = new Map<string, { volume: number; fees: number; payouts: number; count: number }>()

  for (const p of payments) {
    const month = p.createdAt.toISOString().slice(0, 7) // YYYY-MM
    const existing = monthlyMap.get(month) || { volume: 0, fees: 0, payouts: 0, count: 0 }
    existing.volume += p.grossCents || 0
    existing.fees += p.feeCents || 0
    existing.payouts += p.netCents || 0
    existing.count += 1
    monthlyMap.set(month, existing)
  }

  // Sort by month
  const result = Array.from(monthlyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, data]) => ({
      month,
      volumeCents: data.volume,
      feesCents: data.fees,
      payoutsCents: data.payouts,
      count: data.count
    }))

  return c.json({ months: result })
})

// ============================================
// TOP CREATORS BY REVENUE
// ============================================

/**
 * GET /admin/revenue/top-creators
 * Top creators by revenue
 */
adminRevenue.get('/top-creators', async (c) => {
  const query = z.object({
    limit: z.coerce.number().default(20),
    period: z.enum(['month', 'year', 'all']).default('month')
  }).parse(c.req.query())

  const now = new Date()
  let startDate: Date | undefined

  switch (query.period) {
    case 'month':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    case 'year':
      startDate = new Date(now.getFullYear(), 0, 1)
      break
    case 'all':
      startDate = undefined
      break
  }

  const where: any = { status: 'succeeded', type: { in: ['recurring', 'one_time'] } }
  if (startDate) where.createdAt = { gte: startDate }

  const topCreators = await db.payment.groupBy({
    by: ['creatorId'],
    where,
    _sum: { grossCents: true, feeCents: true, netCents: true },
    _count: true,
    orderBy: { _sum: { grossCents: 'desc' } },
    take: query.limit
  })

  // Get creator details
  const creatorIds = topCreators.map(c => c.creatorId)
  const creators = await db.user.findMany({
    where: { id: { in: creatorIds } },
    select: {
      id: true,
      email: true,
      profile: { select: { username: true, displayName: true, country: true } }
    }
  })

  const creatorMap = new Map(creators.map(c => [c.id, c]))

  return c.json({
    period: query.period,
    creators: topCreators.map(tc => {
      const creator = creatorMap.get(tc.creatorId)
      return {
        creatorId: tc.creatorId,
        email: creator?.email,
        username: creator?.profile?.username,
        displayName: creator?.profile?.displayName,
        country: creator?.profile?.country,
        totalVolumeCents: tc._sum.grossCents || 0,
        platformFeeCents: tc._sum.feeCents || 0,
        creatorEarningsCents: tc._sum.netCents || 0,
        paymentCount: tc._count
      }
    })
  })
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
    period: z.enum(['month', 'year', 'all']).default('month')
  }).parse(c.req.query())

  const now = new Date()
  let startDate: Date | undefined

  switch (query.period) {
    case 'month':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    case 'year':
      startDate = new Date(now.getFullYear(), 0, 1)
      break
    case 'all':
      startDate = undefined
      break
  }

  const where: any = {}
  if (startDate) where.createdAt = { gte: startDate }

  const [refunded, disputed, chargedBack] = await Promise.all([
    db.payment.aggregate({
      where: { ...where, status: 'refunded' },
      _sum: { grossCents: true },
      _count: true
    }),
    db.payment.aggregate({
      where: { ...where, status: 'disputed' },
      _sum: { grossCents: true },
      _count: true
    }),
    db.payment.aggregate({
      where: { ...where, status: 'charged_back' },
      _sum: { grossCents: true },
      _count: true
    })
  ])

  return c.json({
    period: query.period,
    refunds: {
      totalCents: refunded._sum.grossCents || 0,
      count: refunded._count
    },
    disputes: {
      totalCents: disputed._sum.grossCents || 0,
      count: disputed._count
    },
    chargebacks: {
      totalCents: chargedBack._sum.grossCents || 0,
      count: chargedBack._count
    }
  })
})

export default adminRevenue
