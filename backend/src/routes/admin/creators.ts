/**
 * Admin Creator Management Controller
 *
 * Creator oversight and management:
 * - List creators with revenue and compliance metrics
 * - View individual creator details and compliance status
 * - Restrict/unrestrict creators from accepting new subscriptions
 *
 * Note: Uses profile.isPublic as the restriction flag until
 * dedicated restriction fields are added to the schema.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { HTTPException } from 'hono/http-exception'
import { requireRole, logAdminAction, requireFreshSession } from '../../middleware/adminAuth.js'
import { adminSensitiveRateLimit } from '../../middleware/rateLimit.js'
import { auditSensitiveRead } from '../../middleware/auditLog.js'
import { PAGINATION_DEFAULTS } from '../../utils/pagination.js'

const creators = new Hono()

// Basic routes need admin role
creators.use('*', requireRole('admin'))

/**
 * GET /admin/creators
 * List all creators with revenue and health metrics
 */
creators.get('/', auditSensitiveRead('creator_list'), async (c) => {
  const query = z.object({
    limit: z.coerce.number().min(1).max(PAGINATION_DEFAULTS.maxLimit).default(PAGINATION_DEFAULTS.limit),
    offset: z.coerce.number().min(0).default(0),
    search: z.string().optional(),
    country: z.string().optional(),
    payoutStatus: z.enum(['pending', 'active', 'restricted', 'disabled']).optional(),
    hasDisputes: z.enum(['true', 'false']).optional(),
    sortBy: z.enum(['revenue', 'subscribers', 'created', 'disputes']).default('revenue'),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  }).parse(c.req.query())

  // Build type-safe where clause
  type ProfileWhere = {
    isNot?: null
    countryCode?: string
    payoutStatus?: string
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type UserWhere = any

  const profileWhere: ProfileWhere = { isNot: null }
  if (query.country) profileWhere.countryCode = query.country
  if (query.payoutStatus) profileWhere.payoutStatus = query.payoutStatus

  const where: UserWhere = {
    profile: profileWhere,
    deletedAt: null,
  }

  if (query.search) {
    where.OR = [
      { email: { contains: query.search, mode: 'insensitive' } },
      { profile: { username: { contains: query.search, mode: 'insensitive' } } },
      { profile: { displayName: { contains: query.search, mode: 'insensitive' } } },
    ]
  }

  // Get creators with aggregated metrics
  const creatorsData = await db.user.findMany({
    where,
    select: {
      id: true,
      email: true,
      createdAt: true,
      profile: {
        select: {
          username: true,
          displayName: true,
          avatarUrl: true,
          country: true,
          countryCode: true,
          currency: true,
          purpose: true,
          paymentProvider: true,
          payoutStatus: true,
          stripeAccountId: true,
          paystackSubaccountCode: true,
          isPublic: true,
          createdAt: true,
        },
      },
      _count: {
        select: {
          subscriptions: true,
        },
      },
    },
    orderBy: { createdAt: query.sortOrder },
    take: query.limit,
    skip: query.offset,
  })

  // Get revenue and dispute data for each creator
  const creatorIds = creatorsData.map(c => c.id)

  // Revenue per creator
  const revenueByCreator = await db.payment.groupBy({
    by: ['creatorId'],
    where: {
      creatorId: { in: creatorIds },
      status: 'succeeded',
    },
    _sum: { amountCents: true, feeCents: true },
    _count: true,
  })
  const revenueMap = new Map(revenueByCreator.map(r => [r.creatorId, {
    gross: r._sum?.amountCents || 0,
    fees: r._sum?.feeCents || 0,
    count: r._count,
  }]))

  // Active subscriptions per creator
  const activeSubsByCreator = await db.subscription.groupBy({
    by: ['creatorId'],
    where: {
      creatorId: { in: creatorIds },
      status: 'active',
      canceledAt: null,
    },
    _count: true,
    _sum: { amount: true },
  })
  const activeSubsMap = new Map(activeSubsByCreator.map(s => [s.creatorId, {
    count: s._count,
    mrr: s._sum?.amount || 0,
  }]))

  // Disputes per creator
  const disputesByCreator = await db.payment.groupBy({
    by: ['creatorId'],
    where: {
      creatorId: { in: creatorIds },
      status: { in: ['disputed', 'dispute_lost'] },
    },
    _count: true,
  })
  const disputeMap = new Map(disputesByCreator.map(d => [d.creatorId, d._count]))

  // Format response
  const formattedCreators = creatorsData.map(creator => {
    const revenue = revenueMap.get(creator.id) || { gross: 0, fees: 0, count: 0 }
    const activeSubs = activeSubsMap.get(creator.id) || { count: 0, mrr: 0 }
    const disputes = disputeMap.get(creator.id) || 0

    return {
      id: creator.id,
      email: creator.email,
      username: creator.profile?.username,
      displayName: creator.profile?.displayName,
      avatarUrl: creator.profile?.avatarUrl,
      country: creator.profile?.country,
      countryCode: creator.profile?.countryCode,
      currency: creator.profile?.currency,
      purpose: creator.profile?.purpose,
      paymentProvider: creator.profile?.paymentProvider,
      payoutStatus: creator.profile?.payoutStatus,
      hasPayoutSetup: !!(creator.profile?.stripeAccountId || creator.profile?.paystackSubaccountCode),
      isPublic: creator.profile?.isPublic ?? true,
      createdAt: creator.createdAt,
      metrics: {
        totalSubscriptions: creator._count.subscriptions,
        activeSubscriptions: activeSubs.count,
        mrr: activeSubs.mrr,
        totalRevenue: revenue.gross,
        platformFees: revenue.fees,
        paymentCount: revenue.count,
        disputeCount: disputes,
      },
    }
  })

  // Sort by requested field
  if (query.sortBy === 'revenue') {
    formattedCreators.sort((a, b) => query.sortOrder === 'desc'
      ? b.metrics.totalRevenue - a.metrics.totalRevenue
      : a.metrics.totalRevenue - b.metrics.totalRevenue)
  } else if (query.sortBy === 'subscribers') {
    formattedCreators.sort((a, b) => query.sortOrder === 'desc'
      ? b.metrics.activeSubscriptions - a.metrics.activeSubscriptions
      : a.metrics.activeSubscriptions - b.metrics.activeSubscriptions)
  } else if (query.sortBy === 'disputes') {
    formattedCreators.sort((a, b) => query.sortOrder === 'desc'
      ? b.metrics.disputeCount - a.metrics.disputeCount
      : a.metrics.disputeCount - b.metrics.disputeCount)
  }

  // Filter by disputes if requested
  const filteredCreators = query.hasDisputes === 'true'
    ? formattedCreators.filter(c => c.metrics.disputeCount > 0)
    : query.hasDisputes === 'false'
      ? formattedCreators.filter(c => c.metrics.disputeCount === 0)
      : formattedCreators

  const total = await db.user.count({ where })

  return c.json({
    creators: filteredCreators,
    pagination: {
      total,
      limit: query.limit,
      offset: query.offset,
      returned: filteredCreators.length,
    },
  })
})

/**
 * GET /admin/creators/:id
 * Get detailed creator profile with compliance information
 */
creators.get('/:id', auditSensitiveRead('creator_details'), async (c) => {
  const { id } = c.req.param()

  const creator = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      lastLoginAt: true,
      deletedAt: true,
      profile: {
        select: {
          username: true,
          displayName: true,
          bio: true,
          avatarUrl: true,
          voiceIntroUrl: true,
          phone: true,
          country: true,
          countryCode: true,
          currency: true,
          purpose: true,
          pricingModel: true,
          singleAmount: true,
          paymentProvider: true,
          payoutStatus: true,
          stripeAccountId: true,
          paystackSubaccountCode: true,
          paystackBankCode: true,
          paystackAccountNumber: true,
          paystackAccountName: true,
          isPublic: true,
          createdAt: true,
          address: true,
          city: true,
          state: true,
          zip: true,
          // Salary mode fields (for debugging billing anchor issues)
          salaryModeEnabled: true,
          preferredPayday: true,
          paydayAlignmentUnlocked: true,
        },
      },
    },
  })

  if (!creator) {
    throw new HTTPException(404, { message: 'Creator not found' })
  }

  if (!creator.profile) {
    throw new HTTPException(400, { message: 'User has no creator profile' })
  }

  // Get subscription stats
  const subscriptionStats = await db.subscription.groupBy({
    by: ['status'],
    where: { creatorId: id },
    _count: true,
    _sum: { amount: true },
  })

  // Get payment stats
  const paymentStats = await db.payment.groupBy({
    by: ['status'],
    where: { creatorId: id },
    _count: true,
    _sum: { amountCents: true, feeCents: true },
  })

  // Get recent disputes
  const disputes = await db.payment.findMany({
    where: {
      creatorId: id,
      status: { in: ['disputed', 'dispute_lost', 'dispute_won'] },
    },
    select: {
      id: true,
      status: true,
      amountCents: true,
      currency: true,
      stripeDisputeId: true,
      paystackDisputeId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  // Note: blockedSubscriber model doesn't exist yet
  const blockedSubscribers = 0

  // Recent activity (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const recentPayments = await db.payment.count({
    where: {
      creatorId: id,
      status: 'succeeded',
      createdAt: { gte: thirtyDaysAgo },
    },
  })

  const recentNewSubs = await db.subscription.count({
    where: {
      creatorId: id,
      createdAt: { gte: thirtyDaysAgo },
    },
  })

  const recentCancellations = await db.subscription.count({
    where: {
      creatorId: id,
      canceledAt: { gte: thirtyDaysAgo },
    },
  })

  // Compliance checklist
  const compliance = {
    hasProfile: !!creator.profile,
    hasPaymentSetup: !!(creator.profile.stripeAccountId || creator.profile.paystackSubaccountCode),
    payoutVerified: creator.profile.payoutStatus === 'active',
    hasActiveSubscriptions: subscriptionStats.some(s => s.status === 'active' && s._count > 0),
    hasDisputes: disputes.length > 0,
    disputeRate: (() => {
      const succeeded = paymentStats.find(p => p.status === 'succeeded')?._count || 0
      const disputeCount = disputes.length
      return succeeded > 0 ? parseFloat(((disputeCount / succeeded) * 100).toFixed(2)) : 0
    })(),
    blockedSubscribersCount: blockedSubscribers,
    isRestricted: !creator.profile.isPublic,
  }

  return c.json({
    creator: {
      id: creator.id,
      email: creator.email,
      role: creator.role,
      createdAt: creator.createdAt,
      lastLoginAt: creator.lastLoginAt,
      deletedAt: creator.deletedAt,
      profile: creator.profile,
    },
    subscriptions: {
      byStatus: subscriptionStats.map(s => ({
        status: s.status,
        count: s._count,
        totalAmount: s._sum?.amount || 0,
      })),
      total: subscriptionStats.reduce((sum, s) => sum + s._count, 0),
    },
    payments: {
      byStatus: paymentStats.map(p => ({
        status: p.status,
        count: p._count,
        totalAmount: p._sum?.amountCents || 0,
        totalFees: p._sum?.feeCents || 0,
      })),
      total: paymentStats.reduce((sum, p) => sum + p._count, 0),
    },
    disputes: {
      count: disputes.length,
      recent: disputes,
    },
    recentActivity: {
      payments: recentPayments,
      newSubscriptions: recentNewSubs,
      cancellations: recentCancellations,
      period: '30 days',
    },
    compliance,
  })
})

/**
 * POST /admin/creators/:id/restrict
 * Restrict a creator from accepting new subscriptions
 * Uses isPublic = false as the restriction flag
 */
creators.post('/:id/restrict', adminSensitiveRateLimit, requireFreshSession, async (c) => {
  const { id } = c.req.param()
  const body = z.object({
    reason: z.string().min(1).max(1000),
  }).parse(await c.req.json())

  const creator = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      profile: {
        select: { id: true, username: true, isPublic: true },
      },
    },
  })

  if (!creator) {
    throw new HTTPException(404, { message: 'Creator not found' })
  }

  if (!creator.profile) {
    throw new HTTPException(400, { message: 'User has no creator profile' })
  }

  if (!creator.profile.isPublic) {
    throw new HTTPException(400, { message: 'Creator is already restricted' })
  }

  // Restrict by setting isPublic to false
  await db.profile.update({
    where: { id: creator.profile.id },
    data: { isPublic: false },
  })

  await logAdminAction(c, 'Restricted creator', {
    creatorId: id,
    creatorEmail: creator.email,
    username: creator.profile.username,
    reason: body.reason,
  })

  return c.json({
    success: true,
    message: `Creator ${creator.profile.username} has been restricted`,
    creator: {
      id: creator.id,
      email: creator.email,
      username: creator.profile.username,
      isRestricted: true,
    },
  })
})

/**
 * POST /admin/creators/:id/unrestrict
 * Lift restriction from a creator
 */
creators.post('/:id/unrestrict', adminSensitiveRateLimit, requireFreshSession, async (c) => {
  const { id } = c.req.param()
  const body = z.object({
    reason: z.string().min(1).max(1000).optional(),
  }).parse(await c.req.json())

  const creator = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      profile: {
        select: { id: true, username: true, isPublic: true },
      },
    },
  })

  if (!creator) {
    throw new HTTPException(404, { message: 'Creator not found' })
  }

  if (!creator.profile) {
    throw new HTTPException(400, { message: 'User has no creator profile' })
  }

  if (creator.profile.isPublic) {
    throw new HTTPException(400, { message: 'Creator is not restricted' })
  }

  // Unrestrict by setting isPublic to true
  await db.profile.update({
    where: { id: creator.profile.id },
    data: { isPublic: true },
  })

  await logAdminAction(c, 'Unrestricted creator', {
    creatorId: id,
    creatorEmail: creator.email,
    username: creator.profile.username,
    reason: body.reason,
  })

  return c.json({
    success: true,
    message: `Creator ${creator.profile.username} restriction has been lifted`,
    creator: {
      id: creator.id,
      email: creator.email,
      username: creator.profile.username,
      isRestricted: false,
    },
  })
})

/**
 * GET /admin/creators/stats
 * Overview statistics for all creators
 */
creators.get('/stats/overview', async (c) => {
  // Total creators
  const totalCreators = await db.profile.count()

  // By payout status
  const byPayoutStatus = await db.profile.groupBy({
    by: ['payoutStatus'],
    _count: true,
  })

  // By payment provider
  const byProvider = await db.profile.groupBy({
    by: ['paymentProvider'],
    _count: true,
  })

  // By country
  const byCountry = await db.profile.groupBy({
    by: ['countryCode'],
    _count: true,
    orderBy: { _count: { countryCode: 'desc' } },
    take: 10,
  })

  // Restricted creators (isPublic = false)
  const restrictedCount = await db.profile.count({
    where: { isPublic: false },
  })

  // Creators with disputes
  const creatorsWithDisputes = await db.payment.groupBy({
    by: ['creatorId'],
    where: {
      status: { in: ['disputed', 'dispute_lost'] },
    },
    _count: true,
  })

  // Revenue totals
  const revenueStats = await db.payment.aggregate({
    where: { status: 'succeeded' },
    _sum: { amountCents: true, feeCents: true },
    _count: true,
  })

  return c.json({
    totalCreators,
    restricted: restrictedCount,
    withDisputes: creatorsWithDisputes.length,
    byPayoutStatus: byPayoutStatus.map(p => ({
      status: p.payoutStatus,
      count: p._count,
    })),
    byProvider: byProvider.map(p => ({
      provider: p.paymentProvider || 'none',
      count: p._count,
    })),
    byCountry: byCountry.map(c => ({
      country: c.countryCode,
      count: c._count,
    })),
    revenue: {
      totalGross: revenueStats._sum?.amountCents || 0,
      totalFees: revenueStats._sum?.feeCents || 0,
      paymentCount: revenueStats._count || 0,
    },
  })
})

/**
 * GET /admin/creators/by-username/:username
 * Quick lookup by username (for debugging)
 */
creators.get('/by-username/:username', async (c) => {
  const { username } = c.req.param()

  const profile = await db.profile.findUnique({
    where: { username: username.toLowerCase() },
    select: {
      userId: true,
      username: true,
      displayName: true,
      countryCode: true,
      currency: true,
      paymentProvider: true,
      stripeAccountId: true,
      paystackSubaccountCode: true,
      salaryModeEnabled: true,
      preferredPayday: true,
      paydayAlignmentUnlocked: true,
      singleAmount: true,
      pricingModel: true,
    },
  })

  if (!profile) {
    throw new HTTPException(404, { message: 'Creator not found' })
  }

  return c.json({
    profile,
    debug: {
      willUseBillingAnchor: profile.salaryModeEnabled && profile.preferredPayday,
    },
  })
})

/**
 * POST /admin/creators/:id/disable-salary-mode
 * Force disable salary mode for a creator
 */
creators.post('/:id/disable-salary-mode', adminSensitiveRateLimit, async (c) => {
  const { id } = c.req.param()

  const profile = await db.profile.findUnique({
    where: { userId: id },
    select: {
      id: true,
      username: true,
      salaryModeEnabled: true,
      preferredPayday: true,
    },
  })

  if (!profile) {
    throw new HTTPException(404, { message: 'Creator profile not found' })
  }

  // Disable salary mode
  await db.profile.update({
    where: { id: profile.id },
    data: {
      salaryModeEnabled: false,
      // Keep preferredPayday in case they want to re-enable later
    },
  })

  await logAdminAction(c, 'Disabled salary mode for creator', {
    creatorId: id,
    username: profile.username,
    previousState: {
      salaryModeEnabled: profile.salaryModeEnabled,
      preferredPayday: profile.preferredPayday,
    },
  })

  return c.json({
    success: true,
    message: `Salary mode disabled for ${profile.username}`,
    previous: {
      salaryModeEnabled: profile.salaryModeEnabled,
      preferredPayday: profile.preferredPayday,
    },
    current: {
      salaryModeEnabled: false,
      preferredPayday: profile.preferredPayday,
    },
  })
})

export default creators
