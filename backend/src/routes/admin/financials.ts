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
import { todayStart, thisMonthStart, lastNDays } from '../../utils/timezone.js'
import { env } from '../../config/env.js'

const financials = new Hono()

// All financial tools require super_admin
financials.use('*', requireRole('super_admin'))

/**
 * GET /admin/financials/reconciliation
 * Comprehensive financial reconciliation report
 * Compares DB records against Stripe/Paystack
 */
financials.get('/reconciliation', async (c) => {
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

  const stripeGross = stripePayments.reduce((sum, p) => sum + (p.grossCents || p.amountCents), 0)
  const paystackGross = paystackPayments.reduce((sum, p) => sum + (p.grossCents || p.amountCents), 0)

  const stripeFees = stripePayments.reduce((sum, p) => sum + (p.feeCents || 0), 0)
  const paystackFees = paystackPayments.reduce((sum, p) => sum + (p.feeCents || 0), 0)

  // Get refunds
  const refunds = await db.payment.findMany({
    where: {
      createdAt: { gte: periodStart, lte: periodEnd },
      status: 'refunded',
    },
    select: {
      amountCents: true,
      stripePaymentIntentId: true,
      paystackTransactionRef: true,
    }
  })
  const stripeRefunds = refunds.filter(r => r.stripePaymentIntentId).reduce((sum, r) => sum + r.amountCents, 0)
  const paystackRefunds = refunds.filter(r => r.paystackTransactionRef).reduce((sum, r) => sum + r.amountCents, 0)

  // Get disputes
  const disputes = await db.payment.groupBy({
    by: ['status'],
    where: {
      createdAt: { gte: periodStart, lte: periodEnd },
      status: { in: ['disputed', 'dispute_won', 'dispute_lost'] },
    },
    _count: true,
    _sum: { amountCents: true },
  })

  const disputeStats = {
    open: disputes.find(d => d.status === 'disputed')?._count || 0,
    won: disputes.find(d => d.status === 'dispute_won')?._count || 0,
    lost: disputes.find(d => d.status === 'dispute_lost')?._count || 0,
    openAmount: disputes.find(d => d.status === 'disputed')?._sum?.amountCents || 0,
    lostAmount: disputes.find(d => d.status === 'dispute_lost')?._sum?.amountCents || 0,
  }

  // Try to get actual balances from payment providers
  let stripeBalance: number | null = null
  let paystackBalance: number | null = null
  let balanceErrors: string[] = []

  // Stripe balance
  if (env.STRIPE_SECRET_KEY) {
    try {
      const balance = await stripe.balance.retrieve()
      // Sum available balances (might be in multiple currencies)
      stripeBalance = balance.available.reduce((sum, b) => {
        // Convert to cents if needed
        return sum + b.amount
      }, 0)
    } catch (err) {
      balanceErrors.push(`Stripe balance error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  // Paystack balance
  if (env.PAYSTACK_SECRET_KEY) {
    try {
      const balances = await getPaystackBalance()
      paystackBalance = balances.reduce((sum, b) => sum + b.balance, 0)
    } catch (err) {
      balanceErrors.push(`Paystack balance error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  // Calculate expected platform balance
  // This is simplified - real calculation would need to account for:
  // - Pending transfers to creators
  // - Processing fees from payment providers
  // - Chargebacks/disputes
  const expectedPlatformFees = stripeFees + paystackFees
  const totalRefunds = stripeRefunds + paystackRefunds

  return c.json({
    period: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      days: query.days,
    },
    collected: {
      stripe: {
        gross: stripeGross,
        platformFees: stripeFees,
        count: stripePayments.length,
        currency: 'USD',
      },
      paystack: {
        gross: paystackGross,
        platformFees: paystackFees,
        count: paystackPayments.length,
        currency: 'NGN', // Note: Paystack can have multiple currencies
      },
      total: {
        gross: stripeGross + paystackGross,
        platformFees: expectedPlatformFees,
        count: dbPayments.length,
      }
    },
    refunds: {
      stripe: stripeRefunds,
      paystack: paystackRefunds,
      total: totalRefunds,
      count: refunds.length,
    },
    disputes: disputeStats,
    balances: {
      stripe: stripeBalance,
      paystack: paystackBalance,
      errors: balanceErrors.length > 0 ? balanceErrors : undefined,
    },
    platformFees: {
      expected: expectedPlatformFees,
      note: 'Platform fees collected (before processor fees)',
    },
    warnings: [
      stripeBalance === null ? 'Could not fetch Stripe balance' : null,
      paystackBalance === null ? 'Could not fetch Paystack balance' : null,
      disputeStats.open > 0 ? `${disputeStats.open} open disputes totaling ${disputeStats.openAmount} cents` : null,
    ].filter(Boolean),
  })
})

/**
 * GET /admin/financials/fee-audit
 * Per-transaction fee verification
 * Checks that platform fees were correctly calculated
 */
financials.get('/fee-audit', async (c) => {
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
      currency: true,
      createdAt: true,
      subscription: {
        select: {
          creator: {
            select: {
              profile: {
                select: {
                  purpose: true,
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
    const paymentAmount = payment.grossCents || payment.amountCents

    // Expected fee rate: personal = 10%, service = 8%
    const expectedRate = purpose === 'service' ? 0.08 : 0.10
    const expectedFee = Math.round(paymentAmount * expectedRate)

    const actualFee = payment.feeCents || 0
    const variance = actualFee - expectedFee

    // Flag if variance is > 1% of the payment or > $1
    if (Math.abs(variance) > Math.max(paymentAmount * 0.01, 100)) {
      discrepancies.push({
        paymentId: payment.id,
        amount: paymentAmount,
        currency: payment.currency,
        expectedFee,
        actualFee,
        variance,
        variancePercent: ((variance / paymentAmount) * 100).toFixed(2),
        purpose,
        feeModel: payment.feeModel || 'unknown',
        createdAt: payment.createdAt,
      })
    }
  }

  return c.json({
    analyzed: payments.length,
    discrepancies: discrepancies.length,
    discrepancyList: discrepancies,
    feeRates: {
      personal: '10%',
      service: '8%',
    },
    note: 'Discrepancies flagged if variance > 1% of payment or > $1',
  })
})

/**
 * GET /admin/financials/balance-sheet
 * Current platform financial position
 */
financials.get('/balance-sheet', async (c) => {
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
financials.get('/daily/:date', async (c) => {
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
