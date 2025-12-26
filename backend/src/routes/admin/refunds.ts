/**
 * Admin Refund Management Controller
 *
 * Centralized refund management:
 * - View refund history
 * - Process refund requests
 * - Refund policies and rules
 *
 * Note: Works with existing Payment model's 'refunded' status.
 * For full workflow with approval queue, add RefundRequest model to schema.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { HTTPException } from 'hono/http-exception'
import { requireRole, logAdminAction, requireFreshSession } from '../../middleware/adminAuth.js'
import { adminSensitiveRateLimit } from '../../middleware/rateLimit.js'
import { auditSensitiveRead } from '../../middleware/auditLog.js'
import { stripe } from '../../services/stripe.js'
import { env } from '../../config/env.js'
import { invalidateAdminRevenueCache } from '../../utils/cache.js'

const refunds = new Hono()

// All refund routes need admin role
refunds.use('*', requireRole('admin'))

// Default refund policy (can be overridden by system settings)
const DEFAULT_REFUND_POLICY = {
  windowDays: 14,           // Refunds allowed within 14 days
  maxRefundPercent: 100,    // Full refund allowed
  requireReason: true,      // Reason must be provided
  autoApproveWindow: 3,     // Auto-approve if within 3 days
}

/**
 * GET /admin/refunds
 * List all refunds with filters
 */
refunds.get('/', auditSensitiveRead('refund_list'), async (c) => {
  const query = z.object({
    limit: z.coerce.number().min(1).max(100).default(50),
    offset: z.coerce.number().min(0).default(0),
    status: z.enum(['succeeded', 'refunded', 'all']).default('all'),
    days: z.coerce.number().min(1).max(365).optional(),
    creatorId: z.string().optional(),
  }).parse(c.req.query())

  const where: any = {}

  if (query.status === 'refunded') {
    where.status = 'refunded'
  } else if (query.status === 'succeeded') {
    where.status = 'succeeded'
  }

  if (query.days) {
    where.createdAt = {
      gte: new Date(Date.now() - query.days * 24 * 60 * 60 * 1000),
    }
  }

  if (query.creatorId) {
    where.creatorId = query.creatorId
  }

  const payments = await db.payment.findMany({
    where,
    select: {
      id: true,
      creatorId: true,
      subscriberId: true,
      amountCents: true,
      grossCents: true,
      feeCents: true,
      netCents: true,
      currency: true,
      status: true,
      stripePaymentIntentId: true,
      paystackTransactionRef: true,
      createdAt: true,
      subscription: {
        select: {
          id: true,
          creator: {
            select: {
              email: true,
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
    take: query.limit,
    skip: query.offset,
  })

  const total = await db.payment.count({ where })

  // Calculate refund stats
  const refundStats = await db.payment.aggregate({
    where: { status: 'refunded' },
    _sum: { amountCents: true },
    _count: true,
  })

  return c.json({
    payments: payments.map(p => ({
      id: p.id,
      creatorId: p.creatorId,
      subscriberEmail: p.subscription?.subscriber?.email,
      creatorEmail: p.subscription?.creator?.email,
      creatorName: p.subscription?.creator?.profile?.displayName || p.subscription?.creator?.profile?.username,
      amount: p.grossCents || p.amountCents,
      fee: p.feeCents,
      net: p.netCents,
      currency: p.currency,
      status: p.status,
      provider: p.stripePaymentIntentId ? 'stripe' : 'paystack',
      providerRef: p.stripePaymentIntentId || p.paystackTransactionRef,
      createdAt: p.createdAt,
      daysSincePayment: Math.floor((Date.now() - p.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
    })),
    pagination: {
      total,
      limit: query.limit,
      offset: query.offset,
      returned: payments.length,
    },
    stats: {
      totalRefunded: refundStats._sum?.amountCents || 0,
      refundCount: refundStats._count || 0,
    },
  })
})

/**
 * GET /admin/refunds/eligible/:paymentId
 * Check if a payment is eligible for refund
 */
refunds.get('/eligible/:paymentId', auditSensitiveRead('refund_details'), async (c) => {
  const { paymentId } = c.req.param()

  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      status: true,
      amountCents: true,
      grossCents: true,
      feeCents: true,
      currency: true,
      stripePaymentIntentId: true,
      paystackTransactionRef: true,
      createdAt: true,
      subscription: {
        select: {
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
  })

  if (!payment) {
    throw new HTTPException(404, { message: 'Payment not found' })
  }

  const daysSincePayment = Math.floor((Date.now() - payment.createdAt.getTime()) / (1000 * 60 * 60 * 24))
  const isWithinWindow = daysSincePayment <= DEFAULT_REFUND_POLICY.windowDays
  const canAutoApprove = daysSincePayment <= DEFAULT_REFUND_POLICY.autoApproveWindow

  const eligibility = {
    paymentId: payment.id,
    status: payment.status,
    amount: payment.grossCents || payment.amountCents,
    currency: payment.currency,
    provider: payment.stripePaymentIntentId ? 'stripe' : 'paystack',
    daysSincePayment,
    policy: {
      windowDays: DEFAULT_REFUND_POLICY.windowDays,
      autoApproveWindow: DEFAULT_REFUND_POLICY.autoApproveWindow,
    },
    eligibility: {
      isEligible: payment.status === 'succeeded' && isWithinWindow,
      isWithinWindow,
      canAutoApprove,
      reason: payment.status !== 'succeeded'
        ? `Payment status is ${payment.status}, not succeeded`
        : !isWithinWindow
          ? `Payment is ${daysSincePayment} days old, exceeds ${DEFAULT_REFUND_POLICY.windowDays} day window`
          : 'Eligible for refund',
    },
    subscriber: payment.subscription?.subscriber?.email,
    creator: payment.subscription?.creator?.profile?.displayName || payment.subscription?.creator?.profile?.username,
  }

  return c.json(eligibility)
})

/**
 * POST /admin/refunds/:paymentId/process
 * Process a refund for a payment
 */
refunds.post('/:paymentId/process', adminSensitiveRateLimit, requireFreshSession, async (c) => {
  const { paymentId } = c.req.param()
  const body = z.object({
    reason: z.string().min(1).max(500),
    amount: z.number().positive().optional(), // Partial refund amount (in cents)
    bypassPolicy: z.boolean().default(false), // Super admin can bypass policy
  }).parse(await c.req.json())

  const adminRole = c.get('adminRole')

  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      status: true,
      amountCents: true,
      grossCents: true,
      currency: true,
      stripePaymentIntentId: true,
      stripeChargeId: true,
      paystackTransactionRef: true,
      createdAt: true,
      subscription: {
        select: {
          id: true,
          creator: {
            select: {
              email: true,
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
  })

  if (!payment) {
    throw new HTTPException(404, { message: 'Payment not found' })
  }

  if (payment.status === 'refunded') {
    throw new HTTPException(400, { message: 'Payment has already been refunded' })
  }

  if (payment.status !== 'succeeded') {
    throw new HTTPException(400, { message: `Cannot refund payment with status: ${payment.status}` })
  }

  const daysSincePayment = Math.floor((Date.now() - payment.createdAt.getTime()) / (1000 * 60 * 60 * 24))
  const isWithinWindow = daysSincePayment <= DEFAULT_REFUND_POLICY.windowDays

  // Check policy (unless bypassed by super_admin)
  if (!isWithinWindow && !body.bypassPolicy) {
    throw new HTTPException(400, {
      message: `Payment is ${daysSincePayment} days old, exceeds ${DEFAULT_REFUND_POLICY.windowDays} day refund window. Use bypassPolicy=true to override (super_admin only).`,
    })
  }

  if (body.bypassPolicy && adminRole !== 'super_admin') {
    throw new HTTPException(403, { message: 'Only super_admin can bypass refund policy' })
  }

  const refundAmount = body.amount || (payment.grossCents || payment.amountCents)

  // Process refund based on payment provider
  let refundResult: { success: boolean; refundId?: string; error?: string }

  if (payment.stripePaymentIntentId) {
    // Stripe refund
    if (!env.STRIPE_SECRET_KEY) {
      throw new HTTPException(500, { message: 'Stripe not configured' })
    }

    try {
      const refund = await stripe.refunds.create({
        payment_intent: payment.stripePaymentIntentId,
        amount: refundAmount,
        reason: 'requested_by_customer',
        metadata: {
          admin_refund: 'true',
          reason: body.reason,
          processed_by: c.get('adminEmail') || 'admin',
        },
      })

      refundResult = {
        success: refund.status === 'succeeded' || refund.status === 'pending',
        refundId: refund.id,
      }
    } catch (err) {
      refundResult = {
        success: false,
        error: err instanceof Error ? err.message : 'Stripe refund failed',
      }
    }
  } else if (payment.paystackTransactionRef) {
    // Paystack refund - Note: Paystack refunds are typically handled via dashboard
    // or require additional API setup. For now, mark as manual.
    refundResult = {
      success: false,
      error: 'Paystack refunds must be processed manually via Paystack dashboard',
    }
  } else {
    throw new HTTPException(400, { message: 'Unknown payment provider' })
  }

  if (!refundResult.success) {
    // Log the failed attempt
    await logAdminAction(c, 'Refund failed', {
      paymentId,
      amount: refundAmount,
      currency: payment.currency,
      reason: body.reason,
      error: refundResult.error,
      provider: payment.stripePaymentIntentId ? 'stripe' : 'paystack',
    })

    throw new HTTPException(500, { message: refundResult.error || 'Refund processing failed' })
  }

  // Update payment status - critical operation since refund already processed
  try {
    await db.payment.update({
      where: { id: paymentId },
      data: { status: 'refunded' },
    })
  } catch (dbError) {
    // Critical: Refund succeeded in Stripe but DB update failed
    // This creates an inconsistent state that needs manual intervention
    console.error('[CRITICAL] Refund DB update failed after Stripe refund succeeded:', {
      paymentId,
      refundId: refundResult.refundId,
      error: dbError instanceof Error ? dbError.message : String(dbError),
    })

    // Still return success since refund was processed, but flag the sync issue
    // A reconciliation job should detect and fix this
    await logAdminAction(c, 'Refund DB sync failed', {
      paymentId,
      refundId: refundResult.refundId,
      error: dbError instanceof Error ? dbError.message : String(dbError),
      severity: 'critical',
    })
  }

  // Invalidate admin revenue cache after refund (non-critical)
  await invalidateAdminRevenueCache().catch((err) => {
    console.warn('[cache] Failed to invalidate revenue cache after refund:', err)
  })

  // Log successful refund
  await logAdminAction(c, 'Refund processed', {
    paymentId,
    amount: refundAmount,
    currency: payment.currency,
    reason: body.reason,
    refundId: refundResult.refundId,
    provider: payment.stripePaymentIntentId ? 'stripe' : 'paystack',
    subscriberEmail: payment.subscription?.subscriber?.email,
    creatorEmail: payment.subscription?.creator?.email,
    bypassedPolicy: body.bypassPolicy,
    daysSincePayment,
  })

  return c.json({
    success: true,
    refund: {
      paymentId,
      refundId: refundResult.refundId,
      amount: refundAmount,
      currency: payment.currency,
      provider: payment.stripePaymentIntentId ? 'stripe' : 'paystack',
    },
    payment: {
      previousStatus: 'succeeded',
      newStatus: 'refunded',
    },
  })
})

/**
 * GET /admin/refunds/stats
 * Refund statistics and trends
 */
refunds.get('/stats', auditSensitiveRead('refund_stats'), async (c) => {
  const query = z.object({
    days: z.coerce.number().min(1).max(365).default(30),
  }).parse(c.req.query())

  const periodStart = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000)

  // Refund totals
  const refundTotals = await db.payment.aggregate({
    where: {
      status: 'refunded',
      createdAt: { gte: periodStart },
    },
    _sum: { amountCents: true },
    _count: true,
  })

  // Payment totals for comparison
  const paymentTotals = await db.payment.aggregate({
    where: {
      status: { in: ['succeeded', 'refunded'] },
      createdAt: { gte: periodStart },
    },
    _sum: { amountCents: true },
    _count: true,
  })

  // Refund rate
  const totalPayments = paymentTotals._count || 1
  const totalRefunds = refundTotals._count || 0
  const refundRate = (totalRefunds / totalPayments) * 100

  // Refunds by creator
  const refundsByCreator = await db.payment.groupBy({
    by: ['creatorId'],
    where: {
      status: 'refunded',
      createdAt: { gte: periodStart },
    },
    _count: true,
    _sum: { amountCents: true },
    orderBy: { _count: { creatorId: 'desc' } },
    take: 10,
  })

  // Get creator details
  const creatorIds = refundsByCreator.map(r => r.creatorId)
  const creatorDetails = await db.user.findMany({
    where: { id: { in: creatorIds } },
    select: {
      id: true,
      email: true,
      profile: {
        select: { displayName: true, username: true },
      },
    },
  })
  const creatorMap = new Map(creatorDetails.map(c => [c.id, c]))

  // Daily trend
  const dailyTrend = await db.$queryRaw<Array<{
    date: string
    count: bigint
    amount: bigint
  }>>`
    SELECT
      DATE("createdAt") as date,
      COUNT(*)::bigint as count,
      SUM("amountCents")::bigint as amount
    FROM "payments"
    WHERE status = 'refunded'
      AND "createdAt" >= ${periodStart}
    GROUP BY DATE("createdAt")
    ORDER BY date
  `

  return c.json({
    period: {
      days: query.days,
      start: periodStart.toISOString(),
    },
    totals: {
      refundCount: refundTotals._count || 0,
      refundAmount: refundTotals._sum?.amountCents || 0,
      paymentCount: paymentTotals._count || 0,
      paymentAmount: paymentTotals._sum?.amountCents || 0,
      refundRate: parseFloat(refundRate.toFixed(2)),
    },
    byCreator: refundsByCreator.map(r => {
      const creator = creatorMap.get(r.creatorId)
      return {
        creatorId: r.creatorId,
        email: creator?.email,
        name: creator?.profile?.displayName || creator?.profile?.username,
        refundCount: r._count,
        refundAmount: r._sum?.amountCents || 0,
      }
    }),
    trend: dailyTrend.map(d => ({
      date: d.date,
      count: Number(d.count),
      amount: Number(d.amount),
    })),
    policy: DEFAULT_REFUND_POLICY,
  })
})

/**
 * GET /admin/refunds/policy
 * Get current refund policy
 */
refunds.get('/policy', async (c) => {
  // In a full implementation, this would read from a database settings table
  // For now, return the default policy
  return c.json({
    policy: DEFAULT_REFUND_POLICY,
    note: 'Policy is currently hardcoded. Add RefundPolicy model to schema for configurable policies.',
  })
})

export default refunds
