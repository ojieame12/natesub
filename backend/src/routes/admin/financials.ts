/**
 * Admin Financial Tools Controller
 *
 * Financial reconciliation, balance verification, and reporting.
 * Helps ensure platform funds match Stripe/Paystack balances.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { stripe } from '../../services/stripe.js'
import { getBalance as getPaystackBalance } from '../../services/paystack.js'
import { requireRole } from '../../middleware/adminAuth.js'
import { auditSensitiveRead } from '../../middleware/auditLog.js'
import { todayStart, thisMonthStart, lastNDays } from '../../utils/timezone.js'
import { env } from '../../config/env.js'
import { PLATFORM_FEE_RATE, CROSS_BORDER_BUFFER, isCrossBorderCountry } from '../../constants/fees.js'

const financials = new Hono()

// All financial tools require super_admin
financials.use('*', requireRole('super_admin'))

/**
 * GET /admin/financials/reconciliation
 * Comprehensive financial reconciliation report
 * Compares DB records against Stripe/Paystack
 */
financials.get('/reconciliation', auditSensitiveRead('financial_reconciliation'), async (c) => {
  const query = z.object({
    days: z.coerce.number().min(1).max(90).default(30),
  }).parse(c.req.query())

  const { start: periodStart } = lastNDays(query.days)
  const periodEnd = new Date()

  // Get payments from our database
  const dbPayments = await db.payment.findMany({
    where: {
      createdAt: { gte: periodStart, lte: periodEnd },
      status: { in: ['succeeded', 'refunded'] },
    },
    select: {
      id: true,
      stripePaymentIntentId: true,
      paystackTransactionRef: true,
      grossCents: true,
      amountCents: true,
      feeCents: true,
      netCents: true,
      currency: true,
      status: true,
      createdAt: true,
    }
  })

  // Determine provider by presence of IDs
  const stripePayments = dbPayments.filter(p => p.stripePaymentIntentId)
  const paystackPayments = dbPayments.filter(p => p.paystackTransactionRef)

  // Group by currency to avoid mixing different currency amounts
  type CurrencyTotals = Record<string, { gross: number; fees: number; count: number }>

  const groupByCurrency = (payments: typeof dbPayments): CurrencyTotals => {
    return payments.reduce((acc, p) => {
      const currency = (p.currency || 'USD').toUpperCase()
      if (!acc[currency]) {
        acc[currency] = { gross: 0, fees: 0, count: 0 }
      }
      acc[currency].gross += p.grossCents || p.amountCents
      acc[currency].fees += p.feeCents || 0
      acc[currency].count += 1
      return acc
    }, {} as CurrencyTotals)
  }

  const stripeByCurrency = groupByCurrency(stripePayments)
  const paystackByCurrency = groupByCurrency(paystackPayments)

  // Get refunds grouped by currency - use grossCents for subscriber-paid amount
  const refunds = await db.payment.findMany({
    where: {
      createdAt: { gte: periodStart, lte: periodEnd },
      status: 'refunded',
    },
    select: {
      grossCents: true,
      amountCents: true,
      currency: true,
      stripePaymentIntentId: true,
      paystackTransactionRef: true,
    }
  })

  type RefundTotals = Record<string, number>
  const groupRefundsByCurrency = (refundList: typeof refunds): RefundTotals => {
    return refundList.reduce((acc, r) => {
      const currency = (r.currency || 'USD').toUpperCase()
      // Use grossCents (subscriber-paid) for reconciliation with Stripe/Paystack
      acc[currency] = (acc[currency] || 0) + (r.grossCents || r.amountCents)
      return acc
    }, {} as RefundTotals)
  }

  const stripeRefundsByCurrency = groupRefundsByCurrency(refunds.filter(r => r.stripePaymentIntentId))
  const paystackRefundsByCurrency = groupRefundsByCurrency(refunds.filter(r => r.paystackTransactionRef))

  // Get disputes - use grossCents for subscriber-paid amount in reconciliation
  const disputes = await db.payment.groupBy({
    by: ['status'],
    where: {
      createdAt: { gte: periodStart, lte: periodEnd },
      status: { in: ['disputed', 'dispute_won', 'dispute_lost'] },
    },
    _count: true,
    _sum: { grossCents: true, amountCents: true },
  })

  const disputeStats = {
    open: disputes.find(d => d.status === 'disputed')?._count || 0,
    won: disputes.find(d => d.status === 'dispute_won')?._count || 0,
    lost: disputes.find(d => d.status === 'dispute_lost')?._count || 0,
    // Use grossCents (subscriber-paid) for reconciliation with Stripe/Paystack
    openAmount: disputes.find(d => d.status === 'disputed')?._sum?.grossCents ||
                disputes.find(d => d.status === 'disputed')?._sum?.amountCents || 0,
    lostAmount: disputes.find(d => d.status === 'dispute_lost')?._sum?.grossCents ||
                disputes.find(d => d.status === 'dispute_lost')?._sum?.amountCents || 0,
  }

  // Try to get actual balances from payment providers (grouped by currency)
  type BalanceByCurrency = Record<string, number>
  let stripeBalances: BalanceByCurrency | null = null
  let paystackBalances: BalanceByCurrency | null = null
  const balanceErrors: string[] = []

  // Stripe balance - grouped by currency
  if (env.STRIPE_SECRET_KEY) {
    try {
      const balance = await stripe.balance.retrieve()
      stripeBalances = balance.available.reduce((acc, b) => {
        const currency = b.currency.toUpperCase()
        acc[currency] = (acc[currency] || 0) + b.amount
        return acc
      }, {} as BalanceByCurrency)
    } catch (err) {
      balanceErrors.push(`Stripe balance error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  // Paystack balance - grouped by currency
  if (env.PAYSTACK_SECRET_KEY) {
    try {
      const balances = await getPaystackBalance()
      paystackBalances = balances.reduce((acc, b) => {
        const currency = (b.currency || 'NGN').toUpperCase()
        acc[currency] = (acc[currency] || 0) + b.balance
        return acc
      }, {} as BalanceByCurrency)
    } catch (err) {
      balanceErrors.push(`Paystack balance error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  // Note: We no longer calculate cross-currency totals as they're mathematically meaningless
  // Each currency's fees/amounts should be viewed independently

  return c.json({
    period: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      days: query.days,
    },
    collected: {
      stripe: {
        byCurrency: stripeByCurrency,
        count: stripePayments.length,
      },
      paystack: {
        byCurrency: paystackByCurrency,
        count: paystackPayments.length,
      },
      totalCount: dbPayments.length,
      note: 'Amounts grouped by currency - do not sum across currencies',
    },
    refunds: {
      stripe: stripeRefundsByCurrency,
      paystack: paystackRefundsByCurrency,
      count: refunds.length,
    },
    disputes: disputeStats,
    balances: {
      stripe: stripeBalances,
      paystack: paystackBalances,
      errors: balanceErrors.length > 0 ? balanceErrors : undefined,
      note: 'Balances grouped by currency',
    },
    warnings: [
      stripeBalances === null ? 'Could not fetch Stripe balance' : null,
      paystackBalances === null ? 'Could not fetch Paystack balance' : null,
      disputeStats.open > 0 ? `${disputeStats.open} open disputes totaling ${disputeStats.openAmount} cents` : null,
    ].filter(Boolean),
  })
})

/**
 * GET /admin/financials/fee-audit
 * Per-transaction fee verification
 * Checks that platform fees were correctly calculated
 */
financials.get('/fee-audit', auditSensitiveRead('fee_audit'), async (c) => {
  const query = z.object({
    days: z.coerce.number().min(1).max(30).default(7),
    limit: z.coerce.number().min(1).max(200).default(100),
  }).parse(c.req.query())

  const { start: periodStart } = lastNDays(query.days)

  // Get recent payments with their expected vs actual fees
  const payments = await db.payment.findMany({
    where: {
      createdAt: { gte: periodStart },
      status: 'succeeded',
      feeCents: { not: 0 },
    },
    select: {
      id: true,
      grossCents: true,
      amountCents: true,
      feeCents: true,
      netCents: true,
      feeModel: true,
      feeEffectiveRate: true,
      feeWasCapped: true,
      currency: true,
      createdAt: true,
      subscription: {
        select: {
          creator: {
            select: {
              profile: {
                select: {
                  purpose: true,
                  country: true,
                }
              }
            }
          }
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: query.limit,
  })

  // Check each payment's fee calculation
  const discrepancies: any[] = []

  for (const payment of payments) {
    const purpose = payment.subscription?.creator?.profile?.purpose
    const creatorCountry = payment.subscription?.creator?.profile?.country
    // Use amountCents (base price) for fee calculation, NOT grossCents
    // Fees are calculated as percentage of BASE, not what subscriber paid
    const baseAmount = payment.amountCents
    const grossAmount = payment.grossCents || payment.amountCents

    // Expected fee rate depends on creator country:
    // - Domestic: 9% (split model: 4.5% + 4.5%)
    // - Cross-border: 10.5% (9% + 1.5% buffer, split 5.25%/5.25%)
    const isCrossBorder = creatorCountry && isCrossBorderCountry(creatorCountry)
    const baseRate = isCrossBorder
      ? PLATFORM_FEE_RATE + CROSS_BORDER_BUFFER  // 10.5%
      : PLATFORM_FEE_RATE                         // 9%

    // feeEffectiveRate is the PER-SIDE rate (4.5% or 5.25%), not total
    // Total fee = 2x per-side rate (subscriber pays + creator pays)
    // If feeEffectiveRate is stored, use that (handles processor buffer on small txns)
    // Otherwise fall back to the base rate calculation
    const perSideRate = payment.feeEffectiveRate || (baseRate / 2)
    const totalRate = perSideRate * 2  // Both sides pay same rate
    // Expected fee is percentage of BASE, not gross
    const expectedFee = Math.round(baseAmount * totalRate)

    const actualFee = payment.feeCents || 0
    const variance = actualFee - expectedFee

    // Flag if variance is > 1% of the base amount or > $1
    // BUT: if feeWasCapped (processor buffer applied), allow higher fees
    const wasCapped = payment.feeWasCapped || false
    const threshold = wasCapped
      ? Math.max(baseAmount * 0.05, 200)  // Higher tolerance for capped fees
      : Math.max(baseAmount * 0.01, 100)

    if (Math.abs(variance) > threshold) {
      discrepancies.push({
        paymentId: payment.id,
        baseAmount,   // Creator's set price
        grossAmount,  // What subscriber paid
        currency: payment.currency,
        expectedFee,
        actualFee,
        variance,
        variancePercent: ((variance / baseAmount) * 100).toFixed(2),
        purpose,
        feeModel: payment.feeModel || 'unknown',
        isCrossBorder,
        feeWasCapped: wasCapped,
        createdAt: payment.createdAt,
      })
    }
  }

  return c.json({
    analyzed: payments.length,
    discrepancies: discrepancies.length,
    discrepancyList: discrepancies,
    feeRates: {
      domestic: '9%',
      crossBorder: '10.5%',
      note: 'Cross-border includes 1.5% buffer split between subscriber and creator',
    },
    note: 'Discrepancies flagged if variance > 1% (or 5% for capped fees) of payment or > $1',
  })
})

/**
 * GET /admin/financials/balance-sheet
 * Current platform financial position
 */
financials.get('/balance-sheet', auditSensitiveRead('balance_sheet'), async (c) => {
  const today = todayStart()
  const monthStart = thisMonthStart()

  // Total collected ever
  const totalCollected = await db.payment.aggregate({
    where: { status: 'succeeded' },
    _sum: { grossCents: true, amountCents: true, feeCents: true, netCents: true },
    _count: true,
  })

  // This month collected
  const monthlyCollected = await db.payment.aggregate({
    where: {
      status: 'succeeded',
      createdAt: { gte: monthStart },
    },
    _sum: { grossCents: true, amountCents: true, feeCents: true, netCents: true },
    _count: true,
  })

  // Today collected
  const todayCollected = await db.payment.aggregate({
    where: {
      status: 'succeeded',
      createdAt: { gte: today },
    },
    _sum: { grossCents: true, amountCents: true, feeCents: true, netCents: true },
    _count: true,
  })

  // Total refunded
  const totalRefunded = await db.payment.aggregate({
    where: { status: 'refunded' },
    _sum: { amountCents: true },
    _count: true,
  })

  // Total disputed (lost)
  const totalDisputeLost = await db.payment.aggregate({
    where: { status: 'dispute_lost' },
    _sum: { amountCents: true },
    _count: true,
  })

  // Pending payouts (simplified - would need to track actual payout records)
  // For now, estimate based on net amounts (what creators receive)
  const creatorEarnings = totalCollected._sum?.netCents || 0

  return c.json({
    asOf: new Date().toISOString(),
    collected: {
      allTime: {
        gross: (totalCollected._sum?.grossCents || totalCollected._sum?.amountCents || 0),
        platformFees: totalCollected._sum?.feeCents || 0,
        netToCreators: totalCollected._sum?.netCents || 0,
        count: totalCollected._count || 0,
      },
      thisMonth: {
        gross: (monthlyCollected._sum?.grossCents || monthlyCollected._sum?.amountCents || 0),
        platformFees: monthlyCollected._sum?.feeCents || 0,
        netToCreators: monthlyCollected._sum?.netCents || 0,
        count: monthlyCollected._count || 0,
      },
      today: {
        gross: (todayCollected._sum?.grossCents || todayCollected._sum?.amountCents || 0),
        platformFees: todayCollected._sum?.feeCents || 0,
        netToCreators: todayCollected._sum?.netCents || 0,
        count: todayCollected._count || 0,
      },
    },
    deductions: {
      refunds: {
        total: totalRefunded._sum?.amountCents || 0,
        count: totalRefunded._count || 0,
      },
      disputesLost: {
        total: totalDisputeLost._sum?.amountCents || 0,
        count: totalDisputeLost._count || 0,
      },
    },
    estimates: {
      creatorEarnings,
      platformRevenue: totalCollected._sum?.feeCents || 0,
      note: 'Estimates exclude processor fees and pending payouts',
    },
  })
})

/**
 * GET /admin/financials/daily/:date
 * Daily financial summary for a specific date
 */
financials.get('/daily/:date', auditSensitiveRead('daily_financials'), async (c) => {
  const dateStr = c.req.param('date')
  const date = new Date(dateStr)

  if (isNaN(date.getTime())) {
    return c.json({ error: 'Invalid date format. Use YYYY-MM-DD' }, 400)
  }

  const dayStart = new Date(date)
  dayStart.setUTCHours(0, 0, 0, 0)
  const dayEnd = new Date(date)
  dayEnd.setUTCHours(23, 59, 59, 999)

  // Get all payments for the day
  const payments = await db.payment.findMany({
    where: {
      createdAt: { gte: dayStart, lte: dayEnd },
    },
    select: {
      grossCents: true,
      amountCents: true,
      feeCents: true,
      netCents: true,
      status: true,
      stripePaymentIntentId: true,
      paystackTransactionRef: true,
      currency: true,
    },
  })

  // Aggregate by status and provider
  const summary = {
    date: dateStr,
    byStatus: {
      succeeded: { count: 0, amount: 0, fees: 0 },
      failed: { count: 0, amount: 0 },
      refunded: { count: 0, amount: 0 },
      disputed: { count: 0, amount: 0 },
    } as Record<string, { count: number; amount: number; fees?: number }>,
    byProvider: {
      stripe: { count: 0, amount: 0 },
      paystack: { count: 0, amount: 0 },
    } as Record<string, { count: number; amount: number }>,
    total: {
      count: payments.length,
      gross: 0,
      platformFees: 0,
    },
  }

  for (const p of payments) {
    const paymentAmount = p.grossCents || p.amountCents
    const status = p.status
    if (!summary.byStatus[status]) {
      summary.byStatus[status] = { count: 0, amount: 0 }
    }
    summary.byStatus[status].count++
    summary.byStatus[status].amount += paymentAmount

    if (status === 'succeeded' && p.feeCents) {
      (summary.byStatus[status] as any).fees = ((summary.byStatus[status] as any).fees || 0) + p.feeCents
      summary.total.platformFees += p.feeCents
    }

    // Determine provider by presence of IDs
    const provider = p.stripePaymentIntentId ? 'stripe' : (p.paystackTransactionRef ? 'paystack' : 'unknown')
    if (!summary.byProvider[provider]) {
      summary.byProvider[provider] = { count: 0, amount: 0 }
    }
    summary.byProvider[provider].count++
    summary.byProvider[provider].amount += paymentAmount

    summary.total.gross += paymentAmount
  }

  return c.json(summary)
})

export default financials
