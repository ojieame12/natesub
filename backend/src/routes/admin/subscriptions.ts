/**
 * Admin Subscriptions Controller
 *
 * Subscription management routes for admin dashboard.
 * Includes: list, cancel, pause, resume, trigger-renewal (for testing).
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { stripe } from '../../services/stripe.js'
import { chargeAuthorization, createTransferRecipient, initiateTransfer } from '../../services/paystack.js'
import { calculateServiceFee, calculateLegacyFee, type FeeMode } from '../../services/fees.js'
import { decryptAccountNumber, decryptAuthorizationCode, encryptAuthorizationCode } from '../../utils/encryption.js'
import { adminSensitiveRateLimit } from '../../middleware/rateLimit.js'
import { requireRole, requireFreshSession, logAdminAction } from '../../middleware/adminAuth.js'

const subscriptions = new Hono()

// ============================================
// SUBSCRIPTIONS LIST
// ============================================

/**
 * GET /admin/subscriptions
 * List subscriptions with pagination and filtering
 */
subscriptions.get('/', async (c) => {
  const query = z.object({
    search: z.string().optional(),
    status: z.enum(['all', 'active', 'canceled', 'past_due', 'paused']).default('all'),
    page: z.coerce.number().default(1),
    limit: z.coerce.number().min(1).max(200).default(50)
  }).parse(c.req.query())

  const skip = (query.page - 1) * query.limit
  const where: any = query.status !== 'all' ? { status: query.status } : {}

  // Search by subscriber email, creator email, or creator username
  if (query.search) {
    where.OR = [
      { subscriber: { email: { contains: query.search, mode: 'insensitive' } } },
      { creator: { email: { contains: query.search, mode: 'insensitive' } } },
      { creator: { profile: { username: { contains: query.search, mode: 'insensitive' } } } }
    ]
  }

  const [dbSubscriptions, total] = await Promise.all([
    db.subscription.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { email: true, profile: { select: { username: true } } } },
        subscriber: { select: { email: true } }
      }
    }),
    db.subscription.count({ where })
  ])

  return c.json({
    subscriptions: dbSubscriptions.map(s => ({
      id: s.id,
      creator: {
        id: s.creatorId,
        email: s.creator.email,
        username: s.creator.profile?.username || null,
      },
      subscriber: {
        id: s.subscriberId,
        email: s.subscriber.email,
      },
      amount: s.amount,
      currency: s.currency,
      interval: s.interval,
      status: s.status,
      ltvCents: s.ltvCents,
      createdAt: s.createdAt,
      currentPeriodEnd: s.currentPeriodEnd
    })),
    total,
    page: query.page,
    totalPages: Math.ceil(total / query.limit)
  })
})

// ============================================
// SUBSCRIPTION DETAIL
// ============================================

/**
 * GET /admin/subscriptions/:id
 * Get full subscription detail with subscriber info and payment history
 */
subscriptions.get('/:id', async (c) => {
  const { id } = c.req.param()

  const subscription = await db.subscription.findUnique({
    where: { id },
    include: {
      creator: {
        select: {
          id: true,
          email: true,
          profile: { select: { username: true, displayName: true } }
        }
      },
      subscriber: {
        select: {
          id: true,
          email: true,
          createdAt: true
        }
      }
    }
  })

  if (!subscription) return c.json({ error: 'Subscription not found' }, 404)

  // Get payment history for this subscription
  const payments = await db.payment.findMany({
    where: { subscriptionId: id },
    orderBy: { occurredAt: 'desc' },
    take: 20,
    select: {
      id: true,
      grossCents: true,
      amountCents: true,
      feeCents: true,
      netCents: true,
      currency: true,
      status: true,
      type: true,
      stripePaymentIntentId: true,
      paystackTransactionRef: true,
      occurredAt: true
    }
  })

  // Get subscriber's other active subscriptions
  const otherSubscriptions = await db.subscription.findMany({
    where: {
      subscriberId: subscription.subscriberId,
      id: { not: id },
      status: { in: ['active', 'paused', 'past_due'] }
    },
    include: {
      creator: {
        select: {
          email: true,
          profile: { select: { username: true, displayName: true } }
        }
      }
    },
    take: 10
  })

  // Calculate subscriber totals
  const subscriberStats = await db.payment.aggregate({
    where: {
      subscriberId: subscription.subscriberId,
      status: 'succeeded'
    },
    _sum: { grossCents: true },
    _count: true
  })

  return c.json({
    subscription: {
      id: subscription.id,
      status: subscription.status,
      amount: subscription.amount,
      currency: subscription.currency,
      interval: subscription.interval,
      ltvCents: subscription.ltvCents,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      createdAt: subscription.createdAt,
      canceledAt: subscription.canceledAt,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      paystackAuthorizationCode: subscription.paystackAuthorizationCode ? true : false
    },
    creator: {
      id: subscription.creator.id,
      email: subscription.creator.email,
      username: subscription.creator.profile?.username,
      displayName: subscription.creator.profile?.displayName
    },
    subscriber: {
      id: subscription.subscriber.id,
      email: subscription.subscriber.email,
      joinedAt: subscription.subscriber.createdAt,
      totalSpentCents: subscriberStats._sum.grossCents || 0,
      totalPayments: subscriberStats._count
    },
    payments: payments.map(p => ({
      id: p.id,
      grossCents: p.grossCents ?? p.amountCents,
      feeCents: p.feeCents,
      netCents: p.netCents,
      currency: p.currency,
      status: p.status,
      type: p.type,
      provider: p.stripePaymentIntentId ? 'stripe' : p.paystackTransactionRef ? 'paystack' : 'unknown',
      occurredAt: p.occurredAt
    })),
    otherSubscriptions: otherSubscriptions.map(s => ({
      id: s.id,
      creatorUsername: s.creator.profile?.username,
      creatorDisplayName: s.creator.profile?.displayName,
      amount: s.amount,
      currency: s.currency,
      status: s.status
    }))
  })
})

// ============================================
// SUBSCRIPTION ACTIONS
// ============================================

/**
 * POST /admin/subscriptions/:id/cancel
 * Cancel a subscription
 * Requires: super_admin
 */
subscriptions.post('/:id/cancel', adminSensitiveRateLimit, requireRole('super_admin'), requireFreshSession, async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json().catch(() => ({}))
  const immediate = body.immediate ?? false

  const subscription = await db.subscription.findUnique({ where: { id } })
  if (!subscription) return c.json({ error: 'Subscription not found' }, 404)

  if (subscription.stripeSubscriptionId) {
    if (immediate) {
      await stripe.subscriptions.cancel(subscription.stripeSubscriptionId)
    } else {
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, { cancel_at_period_end: true })
    }
  }

  await db.subscription.update({
    where: { id },
    data: immediate ? { status: 'canceled', canceledAt: new Date() } : { cancelAtPeriodEnd: true }
  })

  return c.json({ success: true })
})

/**
 * POST /admin/subscriptions/:id/pause
 * Pause a subscription (stop billing but keep active)
 */
subscriptions.post('/:id/pause', adminSensitiveRateLimit, requireRole('super_admin'), requireFreshSession, async (c) => {
  const { id } = c.req.param()

  const subscription = await db.subscription.findUnique({
    where: { id },
    select: { id: true, status: true, stripeSubscriptionId: true, creatorId: true }
  })

  if (!subscription) return c.json({ error: 'Subscription not found' }, 404)
  if (subscription.status !== 'active') return c.json({ error: 'Can only pause active subscriptions' }, 400)

  try {
    if (subscription.stripeSubscriptionId) {
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        pause_collection: { behavior: 'void' }
      })
    }

    await db.subscription.update({
      where: { id },
      data: { status: 'paused' }
    })

    await db.activity.create({
      data: {
        userId: subscription.creatorId,
        type: 'admin_subscription_paused',
        payload: {
          subscriptionId: id,
          adminId: c.get('adminUserId'),
          adminEmail: c.get('adminEmail')
        }
      }
    })

    return c.json({ success: true, message: 'Subscription paused' })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

/**
 * POST /admin/subscriptions/:id/resume
 * Resume a paused subscription
 */
subscriptions.post('/:id/resume', adminSensitiveRateLimit, requireRole('super_admin'), requireFreshSession, async (c) => {
  const { id } = c.req.param()

  const subscription = await db.subscription.findUnique({
    where: { id },
    select: { id: true, status: true, stripeSubscriptionId: true, creatorId: true }
  })

  if (!subscription) return c.json({ error: 'Subscription not found' }, 404)
  if (subscription.status !== 'paused') return c.json({ error: 'Subscription is not paused' }, 400)

  try {
    if (subscription.stripeSubscriptionId) {
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        pause_collection: null // null clears the pause per Stripe docs
      } as any)
    }

    await db.subscription.update({
      where: { id },
      data: { status: 'active' }
    })

    await db.activity.create({
      data: {
        userId: subscription.creatorId,
        type: 'admin_subscription_resumed',
        payload: {
          subscriptionId: id,
          adminId: c.get('adminUserId'),
          adminEmail: c.get('adminEmail')
        }
      }
    })

    return c.json({ success: true, message: 'Subscription resumed' })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// ============================================
// TRIGGER RENEWAL (TEST MODE)
// ============================================

/**
 * Helper: Add months to a date without day overflow
 */
function addMonthSafe(date: Date, months: number): Date {
  const result = new Date(date)
  const targetMonth = result.getMonth() + months
  result.setMonth(targetMonth)
  const expectedMonth = (date.getMonth() + months) % 12
  if (result.getMonth() !== expectedMonth) {
    result.setDate(0)
  }
  if (date.getDate() >= 29 && result.getDate() > 28) {
    result.setDate(28)
  }
  return result
}

/**
 * POST /admin/subscriptions/:id/trigger-renewal
 * Manually trigger a billing cycle for testing
 * Only works for Paystack subscriptions with authorization codes
 * Requires: super_admin + fresh session
 */
subscriptions.post('/:id/trigger-renewal', adminSensitiveRateLimit, requireRole('super_admin'), requireFreshSession, async (c) => {
  const { id } = c.req.param()
  const body = z.object({
    skipTransfer: z.boolean().default(false), // Skip payout to creator (for testing)
  }).parse(await c.req.json().catch(() => ({})))

  const subscription = await db.subscription.findUnique({
    where: { id },
    include: {
      creator: { include: { profile: true } },
      subscriber: true,
    },
  })

  if (!subscription) {
    return c.json({ error: 'Subscription not found' }, 404)
  }

  if (subscription.status !== 'active') {
    return c.json({ error: `Cannot renew subscription with status: ${subscription.status}` }, 400)
  }

  if (subscription.interval === 'one_time') {
    return c.json({ error: 'Cannot renew one-time subscription' }, 400)
  }

  if (!subscription.paystackAuthorizationCode) {
    return c.json({ error: 'No Paystack authorization code - use Stripe test clocks for Stripe subscriptions' }, 400)
  }

  // Decrypt authorization code
  const authCode = decryptAuthorizationCode(subscription.paystackAuthorizationCode)
  if (!authCode) {
    return c.json({ error: 'Failed to decrypt authorization code' }, 500)
  }

  const now = new Date()
  const isNewFeeModel = subscription.feeModel === 'flat' || subscription.feeModel === 'split_v1' || subscription.feeModel?.startsWith('progressive')

  // Calculate fees
  let feeCents: number
  let netCents: number
  let grossCents: number | null = null
  let feeModel: string | null = null
  let feeEffectiveRate: number | null = null

  if (isNewFeeModel && subscription.creator.profile) {
    const creatorPurpose = subscription.creator.profile.purpose
    const subscriptionFeeMode = (subscription.feeMode || subscription.creator.profile.feeMode) as FeeMode
    const feeCalc = calculateServiceFee(subscription.amount, subscription.currency, creatorPurpose, subscriptionFeeMode)
    grossCents = feeCalc.grossCents
    feeCents = feeCalc.feeCents
    netCents = feeCalc.netCents
    feeModel = feeCalc.feeModel
    feeEffectiveRate = feeCalc.effectiveRate
  } else {
    const creatorPurpose = subscription.creator.profile?.purpose as 'personal' | 'service' | null
    const legacyFees = calculateLegacyFee(subscription.amount, creatorPurpose, subscription.currency)
    feeCents = legacyFees.feeCents
    netCents = legacyFees.netCents
  }

  // Generate unique reference for this test renewal
  const reference = `TEST-${id.slice(0, 8)}-${Date.now()}`

  try {
    // Charge the subscriber
    const chargeResult = await chargeAuthorization({
      authorizationCode: authCode,
      email: subscription.subscriber.email,
      amount: isNewFeeModel ? grossCents! : subscription.amount,
      currency: subscription.currency,
      metadata: {
        subscriptionId: subscription.id,
        creatorId: subscription.creatorId,
        subscriberId: subscription.subscriberId,
        interval: 'month',
        isRecurring: true,
        isTestRenewal: true,
        feeModel: feeModel || undefined,
        creatorAmount: netCents,
        serviceFee: feeCents,
      },
      reference,
    })

    // Update subscription period
    const newPeriodEnd = addMonthSafe(subscription.currentPeriodEnd || now, 1)

    await db.subscription.update({
      where: { id },
      data: {
        currentPeriodEnd: newPeriodEnd,
        ltvCents: { increment: netCents },
        paystackAuthorizationCode: chargeResult.authorization?.authorization_code
          ? encryptAuthorizationCode(chargeResult.authorization.authorization_code)
          : subscription.paystackAuthorizationCode,
      },
    })

    // Create payment record
    const paidAt = chargeResult.paid_at ? new Date(chargeResult.paid_at) : new Date()

    const paymentRecord = await db.payment.create({
      data: {
        subscriptionId: subscription.id,
        creatorId: subscription.creatorId,
        subscriberId: subscription.subscriberId,
        grossCents,
        amountCents: grossCents || subscription.amount,
        currency: subscription.currency,
        feeCents,
        netCents,
        feeModel,
        feeEffectiveRate,
        type: 'recurring',
        status: 'succeeded',
        occurredAt: paidAt,
        paystackEventId: chargeResult.id?.toString(),
        paystackTransactionRef: reference,
      },
    })

    // Transfer to creator (unless skipped)
    let transferResult = null
    if (!body.skipTransfer && isNewFeeModel && subscription.creator.profile?.paystackBankCode && subscription.creator.profile?.paystackAccountNumber) {
      const payoutReference = `PAYOUT-${reference}`
      const accountNumber = decryptAccountNumber(subscription.creator.profile.paystackAccountNumber)

      if (accountNumber) {
        try {
          const { recipientCode } = await createTransferRecipient({
            name: subscription.creator.profile.displayName || 'Creator',
            accountNumber,
            bankCode: subscription.creator.profile.paystackBankCode,
            currency: subscription.currency,
          })

          const transfer = await initiateTransfer({
            amount: netCents,
            recipientCode,
            reason: `Test renewal payout for subscription`,
            reference: payoutReference,
          })

          transferResult = { status: 'initiated', transferCode: transfer.transferCode }

          await db.payment.create({
            data: {
              subscriptionId: subscription.id,
              creatorId: subscription.creatorId,
              subscriberId: subscription.subscriberId,
              amountCents: netCents,
              currency: subscription.currency,
              feeCents: 0,
              netCents,
              type: 'payout',
              status: 'pending',
              paystackTransactionRef: payoutReference,
            },
          })
        } catch (transferErr: any) {
          transferResult = { status: 'failed', error: transferErr.message }
        }
      }
    }

    // Log admin action
    await logAdminAction(c, 'Triggered test renewal', {
      subscriptionId: id,
      reference,
      chargedAmount: grossCents || subscription.amount,
      netToCreator: netCents,
      skipTransfer: body.skipTransfer,
    })

    return c.json({
      success: true,
      message: 'Test renewal completed',
      details: {
        reference,
        chargedAmount: grossCents || subscription.amount,
        feeCents,
        netToCreator: netCents,
        newPeriodEnd,
        paymentId: paymentRecord.id,
        transfer: transferResult,
      },
    })
  } catch (err: any) {
    // Log failed attempt
    await logAdminAction(c, 'Test renewal failed', {
      subscriptionId: id,
      error: err.message,
    })

    return c.json({
      error: 'Charge failed',
      details: err.message,
    }, 400)
  }
})

export default subscriptions
