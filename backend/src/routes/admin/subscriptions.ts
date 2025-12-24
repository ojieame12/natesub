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
// UPCOMING PAYMENTS
// ============================================

/**
 * Helper: Get date bucket (YYYY-MM-DD) for a given date in UTC
 */
function getDateBucket(date: Date): string {
  return date.toISOString().split('T')[0]
}

/**
 * Helper: Calculate days until billing with proper semantics (UTC-based)
 * - 0 = due today (UTC date matches)
 * - 1 = due tomorrow
 * - negative = overdue
 *
 * Uses UTC to ensure consistent behavior across servers/timezones.
 */
function getDaysUntilBilling(billingDate: Date, now: Date): number {
  // Use UTC date boundaries for consistent cross-timezone behavior
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const billingUTC = Date.UTC(billingDate.getUTCFullYear(), billingDate.getUTCMonth(), billingDate.getUTCDate())
  return Math.floor((billingUTC - todayUTC) / (1000 * 60 * 60 * 24))
}

/**
 * GET /admin/subscriptions/upcoming
 * List subscriptions with payments due in the next X days
 *
 * Features:
 * - Global summary computed from full dataset (not just page)
 * - Per-day totals with amounts grouped by currency
 * - Overdue visibility with includeOverdue=true
 * - Date buckets (YYYY-MM-DD in UTC) for clear semantics
 *
 * Timezone: All date calculations use UTC.
 * - dueDate: YYYY-MM-DD in UTC
 * - daysUntilBilling: 0 = due today (UTC), 1 = tomorrow (UTC), negative = overdue
 */
subscriptions.get('/upcoming', async (c) => {
  const query = z.object({
    days: z.coerce.number().min(1).max(30).default(7),
    limit: z.coerce.number().min(1).max(200).default(50),
    page: z.coerce.number().default(1),
    includeOverdue: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  }).parse(c.req.query())

  const now = new Date()
  const futureDate = new Date(now.getTime() + query.days * 24 * 60 * 60 * 1000)
  const skip = (query.page - 1) * query.limit

  // Base filter for active recurring subscriptions not marked for cancellation
  const baseWhere = {
    status: 'active' as const,
    interval: 'month' as const,
    cancelAtPeriodEnd: false,
    currentPeriodEnd: { not: null },
  }

  // Upcoming window filter
  const upcomingWhere = {
    ...baseWhere,
    currentPeriodEnd: {
      gte: now,
      lte: futureDate,
    },
  }

  // Overdue filter (currentPeriodEnd < now but still active)
  const overdueWhere = {
    ...baseWhere,
    currentPeriodEnd: {
      lt: now,
    },
  }

  // Fetch paginated results and counts
  const [upcoming, upcomingCount, overdueCount] = await Promise.all([
    db.subscription.findMany({
      where: query.includeOverdue
        ? { OR: [upcomingWhere, overdueWhere] }
        : upcomingWhere,
      include: {
        creator: {
          select: {
            id: true,
            email: true,
            profile: { select: { username: true, displayName: true } },
          },
        },
        subscriber: {
          select: {
            id: true,
            email: true,
          },
        },
      },
      orderBy: { currentPeriodEnd: 'asc' },
      skip,
      take: query.limit,
    }),
    db.subscription.count({ where: upcomingWhere }),
    db.subscription.count({ where: overdueWhere }),
  ])

  // Compute GLOBAL summary using DB-side aggregation (avoids loading all records)
  const combinedWhere = query.includeOverdue
    ? { OR: [upcomingWhere, overdueWhere] }
    : upcomingWhere

  // Use groupBy for currency totals (DB-side aggregation)
  const currencyTotals = await db.subscription.groupBy({
    by: ['currency'],
    where: combinedWhere,
    _sum: { amount: true },
    _count: true,
  })

  const totalByCurrency: Record<string, { count: number; totalCents: number }> = {}
  for (const row of currencyTotals) {
    totalByCurrency[row.currency] = {
      count: row._count,
      totalCents: row._sum.amount || 0,
    }
  }

  // Use raw SQL for date+currency grouping (more efficient than loading all records)
  // Note: Conditional queries because Prisma $queryRaw doesn't support SQL fragment embedding
  type DateCurrencyRow = {
    date_bucket: string
    currency: string
    count: bigint
    total_cents: bigint
  }

  const dateCurrencyRows = query.includeOverdue
    ? await db.$queryRaw<Array<DateCurrencyRow>>`
        SELECT
          TO_CHAR("currentPeriodEnd"::date, 'YYYY-MM-DD') AS date_bucket,
          currency,
          COUNT(*)::bigint AS count,
          SUM(amount)::bigint AS total_cents
        FROM "subscriptions"
        WHERE status = 'active'
          AND interval = 'month'
          AND "cancelAtPeriodEnd" = false
          AND "currentPeriodEnd" IS NOT NULL
          AND (
            ("currentPeriodEnd" >= ${now} AND "currentPeriodEnd" <= ${futureDate})
            OR "currentPeriodEnd" < ${now}
          )
        GROUP BY date_bucket, currency
        ORDER BY date_bucket
      `
    : await db.$queryRaw<Array<DateCurrencyRow>>`
        SELECT
          TO_CHAR("currentPeriodEnd"::date, 'YYYY-MM-DD') AS date_bucket,
          currency,
          COUNT(*)::bigint AS count,
          SUM(amount)::bigint AS total_cents
        FROM "subscriptions"
        WHERE status = 'active'
          AND interval = 'month'
          AND "cancelAtPeriodEnd" = false
          AND "currentPeriodEnd" IS NOT NULL
          AND "currentPeriodEnd" >= ${now}
          AND "currentPeriodEnd" <= ${futureDate}
        GROUP BY date_bucket, currency
        ORDER BY date_bucket
      `

  // Build per-date summary
  const byDate: Record<string, {
    count: number
    daysUntil: number
    isOverdue: boolean
    byCurrency: Record<string, { count: number; totalCents: number }>
  }> = {}

  for (const row of dateCurrencyRows) {
    const dateBucket = row.date_bucket
    const billingDate = new Date(dateBucket + 'T00:00:00Z')
    const daysUntil = getDaysUntilBilling(billingDate, now)
    const isOverdue = daysUntil < 0

    if (!byDate[dateBucket]) {
      byDate[dateBucket] = {
        count: 0,
        daysUntil,
        isOverdue,
        byCurrency: {},
      }
    }

    const rowCount = Number(row.count)
    byDate[dateBucket].count += rowCount
    byDate[dateBucket].byCurrency[row.currency] = {
      count: rowCount,
      totalCents: Number(row.total_cents),
    }
  }

  const total = query.includeOverdue ? upcomingCount + overdueCount : upcomingCount

  return c.json({
    subscriptions: upcoming.map((s) => {
      const daysUntil = s.currentPeriodEnd ? getDaysUntilBilling(s.currentPeriodEnd, now) : null
      return {
        id: s.id,
        creator: {
          id: s.creator.id,
          email: s.creator.email,
          username: s.creator.profile?.username,
          displayName: s.creator.profile?.displayName,
        },
        subscriber: {
          id: s.subscriber.id,
          email: s.subscriber.email,
        },
        amount: s.amount,
        currency: s.currency,
        currentPeriodEnd: s.currentPeriodEnd,
        dueDate: s.currentPeriodEnd ? getDateBucket(s.currentPeriodEnd) : null,
        daysUntilBilling: daysUntil,
        isOverdue: daysUntil !== null && daysUntil < 0,
        ltvCents: s.ltvCents,
        provider: s.stripeSubscriptionId ? 'stripe' : s.paystackAuthorizationCode ? 'paystack' : 'unknown',
      }
    }),
    summary: {
      total,
      upcomingCount,
      overdueCount,
      days: query.days,
      includeOverdue: query.includeOverdue,
      timezone: 'UTC', // All date calculations use UTC for consistency
      byDate, // Per-date breakdown with amounts
      totalByCurrency, // Overall currency breakdown
    },
    page: query.page,
    totalPages: Math.ceil(total / query.limit),
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
