/**
 * Admin Tax Reporting Controller
 *
 * Tax summaries, creator earnings reports, and 1099 data export.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { requireRole } from '../../middleware/adminAuth.js'
import { auditSensitiveRead, auditExport } from '../../middleware/auditLog.js'

const tax = new Hono()

// All tax routes require super_admin
tax.use('*', requireRole('super_admin'))

// Allowed currency codes for validation
const VALID_CURRENCIES = ['USD', 'NGN', 'GHS', 'KES', 'GBP', 'EUR', 'CAD', 'AUD'] as const
type ValidCurrency = (typeof VALID_CURRENCIES)[number]

function isValidCurrency(currency: string): currency is ValidCurrency {
  return VALID_CURRENCIES.includes(currency as ValidCurrency)
}

// Type for creator earnings query result
type CreatorEarningsRow = {
  creator_id: string
  total_earnings: bigint
  platform_fees: bigint
  net_earnings: bigint
  payment_count: bigint
  currency: string
}

/**
 * Get creator earnings with optional currency filter
 * Uses separate queries to avoid SQL injection from dynamic fragments
 */
async function getCreatorEarnings(
  yearStart: Date,
  yearEnd: Date,
  minAmount: number,
  limit: number,
  offset: number,
  currency?: ValidCurrency
): Promise<CreatorEarningsRow[]> {
  if (currency) {
    return db.$queryRaw<CreatorEarningsRow[]>`
      SELECT
        s."creatorId" as creator_id,
        SUM(COALESCE(p."grossCents", p."amountCents"))::bigint as total_earnings,
        SUM(COALESCE(p."feeCents", 0))::bigint as platform_fees,
        SUM(p."netCents")::bigint as net_earnings,
        COUNT(*)::bigint as payment_count,
        p.currency
      FROM "payments" p
      JOIN "subscriptions" s ON p."subscriptionId" = s.id
      WHERE p.status = 'succeeded'
        AND p."createdAt" >= ${yearStart}
        AND p."createdAt" < ${yearEnd}
        AND p.currency = ${currency}
      GROUP BY s."creatorId", p.currency
      HAVING SUM(p."netCents") >= ${minAmount}
      ORDER BY net_earnings DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `
  }

  return db.$queryRaw<CreatorEarningsRow[]>`
    SELECT
      s."creatorId" as creator_id,
      SUM(COALESCE(p."grossCents", p."amountCents"))::bigint as total_earnings,
      SUM(COALESCE(p."feeCents", 0))::bigint as platform_fees,
      SUM(p."netCents")::bigint as net_earnings,
      COUNT(*)::bigint as payment_count,
      p.currency
    FROM "payments" p
    JOIN "subscriptions" s ON p."subscriptionId" = s.id
    WHERE p.status = 'succeeded'
      AND p."createdAt" >= ${yearStart}
      AND p."createdAt" < ${yearEnd}
    GROUP BY s."creatorId", p.currency
    HAVING SUM(p."netCents") >= ${minAmount}
    ORDER BY net_earnings DESC
    LIMIT ${limit}
    OFFSET ${offset}
  `
}

/**
 * Get creator earnings for 1099 export (no pagination)
 */
async function getCreatorEarningsForExport(
  yearStart: Date,
  yearEnd: Date,
  minAmount: number,
  currency?: ValidCurrency
): Promise<CreatorEarningsRow[]> {
  if (currency) {
    return db.$queryRaw<CreatorEarningsRow[]>`
      SELECT
        s."creatorId" as creator_id,
        SUM(COALESCE(p."grossCents", p."amountCents"))::bigint as total_earnings,
        SUM(COALESCE(p."feeCents", 0))::bigint as platform_fees,
        SUM(p."netCents")::bigint as net_earnings,
        COUNT(*)::bigint as payment_count,
        p.currency
      FROM "payments" p
      JOIN "subscriptions" s ON p."subscriptionId" = s.id
      WHERE p.status = 'succeeded'
        AND p."createdAt" >= ${yearStart}
        AND p."createdAt" < ${yearEnd}
        AND p.currency = ${currency}
      GROUP BY s."creatorId", p.currency
      HAVING SUM(p."netCents") >= ${minAmount}
      ORDER BY net_earnings DESC
    `
  }

  return db.$queryRaw<CreatorEarningsRow[]>`
    SELECT
      s."creatorId" as creator_id,
      SUM(COALESCE(p."grossCents", p."amountCents"))::bigint as total_earnings,
      SUM(COALESCE(p."feeCents", 0))::bigint as platform_fees,
      SUM(p."netCents")::bigint as net_earnings,
      COUNT(*)::bigint as payment_count,
      p.currency
    FROM "payments" p
    JOIN "subscriptions" s ON p."subscriptionId" = s.id
    WHERE p.status = 'succeeded'
      AND p."createdAt" >= ${yearStart}
      AND p."createdAt" < ${yearEnd}
    GROUP BY s."creatorId", p.currency
    HAVING SUM(p."netCents") >= ${minAmount}
    ORDER BY net_earnings DESC
  `
}

/**
 * GET /admin/tax/summary/:year
 * Annual platform tax summary
 */
tax.get('/summary/:year', auditSensitiveRead('tax_summary'), async (c) => {
  const year = parseInt(c.req.param('year'))
  if (isNaN(year) || year < 2020 || year > 2100) {
    return c.json({ error: 'Invalid year' }, 400)
  }

  const yearStart = new Date(year, 0, 1)
  const yearEnd = new Date(year + 1, 0, 1)

  // Total platform revenue (platform fees)
  const totalRevenue = await db.payment.aggregate({
    where: {
      status: 'succeeded',
      createdAt: { gte: yearStart, lt: yearEnd },
    },
    _sum: { grossCents: true, amountCents: true, feeCents: true },
    _count: true,
  })

  // Refunds issued
  const refunds = await db.payment.aggregate({
    where: {
      status: 'refunded',
      createdAt: { gte: yearStart, lt: yearEnd },
    },
    _sum: { amountCents: true },
    _count: true,
  })

  // By currency
  const byCurrency = await db.payment.groupBy({
    by: ['currency'],
    where: {
      status: 'succeeded',
      createdAt: { gte: yearStart, lt: yearEnd },
    },
    _sum: { grossCents: true, amountCents: true, feeCents: true },
    _count: true,
  })

  // Unique creators paid
  const creatorsWithEarnings = await db.payment.findMany({
    where: {
      status: 'succeeded',
      createdAt: { gte: yearStart, lt: yearEnd },
    },
    select: {
      subscription: {
        select: { creatorId: true }
      }
    },
    distinct: ['subscriptionId'],
  })
  const uniqueCreators = new Set(creatorsWithEarnings.map(p => p.subscription?.creatorId).filter(Boolean))

  // Monthly breakdown
  const monthlyBreakdown = await db.$queryRaw<Array<{
    month: number
    total_amount: bigint
    total_fees: bigint
    count: bigint
  }>>`
    SELECT
      EXTRACT(MONTH FROM "createdAt")::int as month,
      SUM(COALESCE("grossCents", "amountCents"))::bigint as total_amount,
      SUM(COALESCE("feeCents", 0))::bigint as total_fees,
      COUNT(*)::bigint as count
    FROM "payments"
    WHERE status = 'succeeded'
      AND "createdAt" >= ${yearStart}
      AND "createdAt" < ${yearEnd}
    GROUP BY EXTRACT(MONTH FROM "createdAt")
    ORDER BY month
  `

  return c.json({
    year,
    totals: {
      grossVolume: Number(totalRevenue._sum?.grossCents || totalRevenue._sum?.amountCents || 0),
      platformFees: Number(totalRevenue._sum?.feeCents || 0),
      creatorPayouts: Number(totalRevenue._sum?.grossCents || totalRevenue._sum?.amountCents || 0) - Number(totalRevenue._sum?.feeCents || 0),
      transactionCount: totalRevenue._count || 0,
      refundsIssued: Number(refunds._sum?.amountCents || 0),
      refundCount: refunds._count || 0,
    },
    uniqueCreators: uniqueCreators.size,
    byCurrency: byCurrency.map(c => ({
      currency: c.currency,
      gross: Number(c._sum?.grossCents || c._sum?.amountCents || 0),
      platformFees: Number(c._sum?.feeCents || 0),
      count: c._count,
    })),
    monthly: monthlyBreakdown.map(m => ({
      month: m.month,
      monthName: new Date(year, m.month - 1, 1).toLocaleString('en', { month: 'long' }),
      gross: Number(m.total_amount),
      platformFees: Number(m.total_fees),
      count: Number(m.count),
    })),
    disclaimer: 'This is a summary for internal use only. Consult a tax professional for official filings.',
  })
})

/**
 * GET /admin/tax/creator-earnings/:year
 * Per-creator earnings for 1099 reporting
 */
tax.get('/creator-earnings/:year', auditSensitiveRead('tax_creator_earnings'), async (c) => {
  const year = parseInt(c.req.param('year'))
  if (isNaN(year) || year < 2020 || year > 2100) {
    return c.json({ error: 'Invalid year' }, 400)
  }

  const query = z.object({
    minAmount: z.coerce.number().default(0), // Filter by minimum earnings (in cents)
    limit: z.coerce.number().min(1).max(1000).default(500),
    offset: z.coerce.number().min(0).default(0),
    currency: z.string().optional(),
  }).parse(c.req.query())

  // Validate currency if provided
  const currency = query.currency && isValidCurrency(query.currency) ? query.currency : undefined
  if (query.currency && !currency) {
    return c.json({ error: `Invalid currency. Allowed: ${VALID_CURRENCIES.join(', ')}` }, 400)
  }

  const yearStart = new Date(year, 0, 1)
  const yearEnd = new Date(year + 1, 0, 1)

  // Get creator earnings using safe parameterized query
  const creatorEarnings = await getCreatorEarnings(
    yearStart,
    yearEnd,
    query.minAmount,
    query.limit,
    query.offset,
    currency
  )

  // Get creator details
  const creatorIds = creatorEarnings.map(e => e.creator_id)
  const creators = await db.user.findMany({
    where: { id: { in: creatorIds } },
    select: {
      id: true,
      email: true,
      profile: {
        select: {
          displayName: true,
          username: true,
          address: true,
          city: true,
          state: true,
          zip: true,
          country: true,
        }
      }
    }
  })
  const creatorMap = new Map(creators.map(c => [c.id, c]))

  const result = creatorEarnings.map(e => {
    const creator = creatorMap.get(e.creator_id)
    return {
      creatorId: e.creator_id,
      email: creator?.email,
      displayName: creator?.profile?.displayName,
      username: creator?.profile?.username,
      address: creator?.profile ? {
        street: creator.profile.address,
        city: creator.profile.city,
        state: creator.profile.state,
        zip: creator.profile.zip,
        country: creator.profile.country,
      } : null,
      currency: e.currency,
      grossEarnings: Number(e.total_earnings),
      platformFees: Number(e.platform_fees),
      netEarnings: Number(e.net_earnings),
      paymentCount: Number(e.payment_count),
    }
  })

  // 1099-K threshold is $20,000 and 200 transactions (as of 2023)
  // Or $600 starting 2024 (phased rollout)
  const threshold = year >= 2024 ? 60000 : 2000000 // $600 or $20,000 in cents
  const needsReporting = result.filter(r => r.netEarnings >= threshold)

  return c.json({
    year,
    filters: {
      minAmount: query.minAmount,
      currency: query.currency,
    },
    creators: result,
    pagination: {
      limit: query.limit,
      offset: query.offset,
      returned: result.length,
    },
    reportingThreshold: {
      amount: threshold,
      amountFormatted: `$${(threshold / 100).toLocaleString()}`,
      creatorsAboveThreshold: needsReporting.length,
      note: year >= 2024
        ? '1099-K threshold is $600 (2024+)'
        : '1099-K threshold is $20,000 and 200 transactions (2023)',
    },
  })
})

/**
 * POST /admin/tax/export-1099
 * Export 1099-ready data as CSV
 */
tax.post('/export-1099', auditExport('tax_1099_export'), async (c) => {
  const body = z.object({
    year: z.number().min(2020).max(2100),
    minAmount: z.number().optional(),
    currency: z.string().optional(),
  }).parse(await c.req.json())

  // Validate currency if provided
  const currency = body.currency && isValidCurrency(body.currency) ? body.currency : undefined
  if (body.currency && !currency) {
    return c.json({ error: `Invalid currency. Allowed: ${VALID_CURRENCIES.join(', ')}` }, 400)
  }

  const yearStart = new Date(body.year, 0, 1)
  const yearEnd = new Date(body.year + 1, 0, 1)
  const minAmount = body.minAmount || (body.year >= 2024 ? 60000 : 2000000)

  // Get creator earnings using safe parameterized query
  const creatorEarnings = await getCreatorEarningsForExport(
    yearStart,
    yearEnd,
    minAmount,
    currency
  )

  // Get creator details
  const creatorIds = creatorEarnings.map(e => e.creator_id)
  const creators = await db.user.findMany({
    where: { id: { in: creatorIds } },
    select: {
      id: true,
      email: true,
      profile: {
        select: {
          displayName: true,
          username: true,
          address: true,
          city: true,
          state: true,
          zip: true,
          country: true,
          phone: true,
        }
      }
    }
  })
  const creatorMap = new Map(creators.map(c => [c.id, c]))

  // Build CSV
  const headers = [
    'Creator ID',
    'Email',
    'Display Name',
    'Username',
    'Street Address',
    'City',
    'State',
    'Zip',
    'Country',
    'Phone',
    'Currency',
    'Gross Earnings (cents)',
    'Platform Fees (cents)',
    'Net Earnings (cents)',
    'Net Earnings (formatted)',
    'Payment Count',
  ]

  const rows = creatorEarnings.map(e => {
    const creator = creatorMap.get(e.creator_id)
    const netCents = Number(e.net_earnings)
    return [
      e.creator_id,
      creator?.email || '',
      creator?.profile?.displayName || '',
      creator?.profile?.username || '',
      creator?.profile?.address || '',
      creator?.profile?.city || '',
      creator?.profile?.state || '',
      creator?.profile?.zip || '',
      creator?.profile?.country || '',
      creator?.profile?.phone || '',
      e.currency,
      Number(e.total_earnings),
      Number(e.platform_fees),
      netCents,
      `$${(netCents / 100).toFixed(2)}`,
      Number(e.payment_count),
    ]
  })

  // Create CSV string
  const escapeCSV = (val: any): string => {
    const str = String(val)
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const csv = [
    headers.map(escapeCSV).join(','),
    ...rows.map(row => row.map(escapeCSV).join(','))
  ].join('\n')

  return c.json({
    year: body.year,
    threshold: minAmount,
    creatorsIncluded: rows.length,
    csv,
    filename: `1099-export-${body.year}.csv`,
  })
})

export default tax
