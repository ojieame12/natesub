/**
 * Admin Payments Controller
 *
 * Payment management routes for admin dashboard.
 * Includes: payments list/detail, refunds, disputes, and blocked subscribers.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { stripe } from '../../services/stripe.js'
import { env } from '../../config/env.js'
import { adminSensitiveRateLimit } from '../../middleware/rateLimit.js'
import { requireRole, requireFreshSession } from '../../middleware/adminAuth.js'

const payments = new Hono()

// ============================================
// PAYMENTS LIST & DETAIL
// ============================================

/**
 * GET /admin/payments
 * List payments with pagination and filtering
 */
payments.get('/', async (c) => {
  const query = z.object({
    search: z.string().optional(),
    status: z.enum(['all', 'succeeded', 'failed', 'refunded', 'disputed']).default('all'),
    page: z.coerce.number().default(1),
    limit: z.coerce.number().min(1).max(200).default(50)
  }).parse(c.req.query())

  const skip = (query.page - 1) * query.limit
  const where: any = { type: { in: ['recurring', 'one_time'] } }

  if (query.status !== 'all') where.status = query.status

  const [dbPayments, total] = await Promise.all([
    db.payment.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { occurredAt: 'desc' },
      include: {
        subscription: {
          include: {
            creator: { select: { email: true, profile: { select: { username: true } } } },
            subscriber: { select: { email: true } }
          }
        }
      }
    }),
    db.payment.count({ where })
  ])

  return c.json({
    payments: dbPayments.map(p => ({
      id: p.id,
      creator: {
        id: p.creatorId,
        email: p.subscription?.creator?.email || '',
        username: p.subscription?.creator?.profile?.username || null,
      },
      subscriber: {
        id: p.subscriberId,
        email: p.subscription?.subscriber?.email || '',
      },
      grossCents: p.grossCents ?? p.amountCents,
      amountCents: p.amountCents,
      feeCents: p.feeCents,
      netCents: p.netCents,
      currency: p.currency,
      status: p.status,
      type: p.type,
      provider: p.stripePaymentIntentId ? 'stripe' : p.paystackTransactionRef ? 'paystack' : 'unknown',
      stripePaymentIntentId: p.stripePaymentIntentId,
      paystackTransactionRef: p.paystackTransactionRef,
      occurredAt: p.occurredAt,
      createdAt: p.createdAt,
    })),
    total,
    page: query.page,
    totalPages: Math.ceil(total / query.limit)
  })
})

/**
 * GET /admin/payments/:id
 * Get payment details
 */
payments.get('/:id', async (c) => {
  const { id } = c.req.param()

  const payment = await db.payment.findUnique({
    where: { id },
    include: {
      subscription: {
        include: {
          creator: { select: { id: true, email: true, profile: { select: { username: true, displayName: true } } } },
          subscriber: { select: { id: true, email: true } }
        }
      }
    }
  })

  if (!payment) return c.json({ error: 'Payment not found' }, 404)
  return c.json({ payment })
})

// ============================================
// REFUNDS
// ============================================

/**
 * POST /admin/payments/:id/refund
 * Process a refund for a payment
 * Requires: super_admin
 */
payments.post('/:id/refund', adminSensitiveRateLimit, requireRole('super_admin'), requireFreshSession, async (c) => {
  const { id } = c.req.param()
  const body = z.object({
    reason: z.string().optional(),
    amount: z.number().optional()
  }).parse(await c.req.json().catch(() => ({})))

  const payment = await db.payment.findUnique({
    where: { id },
    include: { subscription: { include: { creator: { select: { profile: { select: { paymentProvider: true } } } } } } }
  })

  if (!payment) return c.json({ error: 'Payment not found' }, 404)
  if (payment.status === 'refunded') return c.json({ error: 'Already refunded' }, 400)
  if (payment.status !== 'succeeded') return c.json({ error: 'Can only refund succeeded payments' }, 400)

  const maxRefundCents = payment.grossCents ?? payment.amountCents

  // Validate refund amount
  if (body.amount !== undefined) {
    if (body.amount <= 0) {
      return c.json({ error: 'Refund amount must be positive' }, 400)
    }
    if (body.amount > maxRefundCents) {
      return c.json({ error: 'Refund amount exceeds payment amount' }, 400)
    }
  }

  // Idempotency check
  const existingRefund = await db.activity.findFirst({
    where: {
      type: 'admin_refund',
      payload: { path: ['paymentId'], equals: id }
    }
  })
  if (existingRefund) {
    return c.json({ error: 'Refund already processed for this payment' }, 400)
  }

  // Idempotency key without timestamp - same payment+amount always produces same key
  // This prevents double-refunds if Stripe succeeds but our DB update fails
  const idempotencyKey = `refund_${id}_${body.amount || 'full'}`

  try {
    if (payment.stripePaymentIntentId) {
      const refund = await stripe.refunds.create({
        payment_intent: payment.stripePaymentIntentId,
        amount: body.amount,
        reason: 'requested_by_customer'
      }, { idempotencyKey })

      await db.payment.update({ where: { id }, data: { status: 'refunded' } })
      await db.activity.create({
        data: {
          userId: payment.creatorId,
          type: 'admin_refund',
          payload: {
            paymentId: id,
            refundId: refund.id,
            amountCents: refund.amount,
            reason: body.reason,
            adminId: c.get('adminUserId'),
            adminEmail: c.get('adminEmail')
          }
        }
      })

      return c.json({ success: true, refund: { id: refund.id, amountCents: refund.amount, status: refund.status } })

    } else if (payment.paystackTransactionRef) {
      const response = await fetch('https://api.paystack.co/refund', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction: payment.paystackTransactionRef,
          amount: body.amount,
          merchant_note: body.reason || 'Admin refund'
        })
      })

      const result = await response.json() as { status: boolean; message?: string; data?: any }
      if (!result.status) return c.json({ error: result.message || 'Paystack refund failed' }, 400)

      await db.payment.update({ where: { id }, data: { status: 'refunded' } })
      await db.activity.create({
        data: {
          userId: payment.creatorId,
          type: 'admin_refund',
          payload: {
            paymentId: id,
            refundData: result.data,
            reason: body.reason,
            adminId: c.get('adminUserId'),
            adminEmail: c.get('adminEmail')
          }
        }
      })

      return c.json({ success: true, refund: result.data })

    } else {
      return c.json({ error: 'No payment provider reference found' }, 400)
    }
  } catch (error: any) {
    console.error('Refund error:', error)
    const safeMessage = error.type === 'StripeCardError' ? error.message : 'Refund failed'
    return c.json({ error: safeMessage }, 500)
  }
})

export default payments
