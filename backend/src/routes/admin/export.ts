/**
 * Admin Data Export Controller
 *
 * Generate and download CSV exports of platform data:
 * - Payments export
 * - Subscriptions export
 * - Creators export
 * - Users export
 *
 * Exports are generated synchronously for small datasets.
 * For large exports (>10k rows), consider implementing async job queue.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { requireRole, logAdminAction } from '../../middleware/adminAuth.js'
import { auditExport } from '../../middleware/auditLog.js'
import { createExportResponse } from '../../utils/csv.js'

const exportRoutes = new Hono()

// All exports require admin role
exportRoutes.use('*', requireRole('admin'))

/**
 * POST /admin/export/payments
 * Export payments data
 */
exportRoutes.post('/payments', auditExport('export_data'), async (c) => {
  const body = z.object({
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    status: z.enum(['succeeded', 'failed', 'refunded', 'disputed', 'all']).default('all'),
    creatorId: z.string().optional(),
    limit: z.number().min(1).max(10000).default(5000),
  }).parse(await c.req.json())

  const where: any = {}

  if (body.status !== 'all') {
    where.status = body.status
  }

  if (body.startDate) {
    where.createdAt = { ...where.createdAt, gte: new Date(body.startDate) }
  }

  if (body.endDate) {
    where.createdAt = { ...where.createdAt, lte: new Date(body.endDate) }
  }

  if (body.creatorId) {
    where.creatorId = body.creatorId
  }

  const payments = await db.payment.findMany({
    where,
    select: {
      id: true,
      creatorId: true,
      subscriberId: true,
      grossCents: true,
      amountCents: true,
      feeCents: true,
      netCents: true,
      currency: true,
      status: true,
      type: true,
      stripePaymentIntentId: true,
      paystackTransactionRef: true,
      createdAt: true,
      subscription: {
        select: {
          creator: {
            select: {
              email: true,
              profile: { select: { username: true } },
            },
          },
          subscriber: {
            select: { email: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: body.limit,
  })

  const headers = [
    'Payment ID',
    'Creator ID',
    'Creator Email',
    'Creator Username',
    'Subscriber ID',
    'Subscriber Email',
    'Gross (cents)',
    'Amount (cents)',
    'Fee (cents)',
    'Net (cents)',
    'Currency',
    'Status',
    'Type',
    'Provider',
    'Provider Reference',
    'Created At',
  ]

  const rows = payments.map(p => [
    p.id,
    p.creatorId,
    p.subscription?.creator?.email || '',
    p.subscription?.creator?.profile?.username || '',
    p.subscriberId || '',
    p.subscription?.subscriber?.email || '',
    p.grossCents || '',
    p.amountCents,
    p.feeCents || 0,
    p.netCents,
    p.currency,
    p.status,
    p.type,
    p.stripePaymentIntentId ? 'stripe' : 'paystack',
    p.stripePaymentIntentId || p.paystackTransactionRef || '',
    p.createdAt.toISOString(),
  ])

  await logAdminAction(c, 'Exported payments', {
    filters: body,
    count: payments.length,
  })

  return c.json(createExportResponse(headers, rows, 'payments-export'))
})

/**
 * POST /admin/export/subscriptions
 * Export subscriptions data
 */
exportRoutes.post('/subscriptions', auditExport('export_data'), async (c) => {
  const body = z.object({
    status: z.enum(['active', 'canceled', 'paused', 'past_due', 'all']).default('all'),
    creatorId: z.string().optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    limit: z.number().min(1).max(10000).default(5000),
  }).parse(await c.req.json())

  const where: any = {}

  if (body.status !== 'all') {
    if (body.status === 'canceled') {
      where.canceledAt = { not: null }
    } else {
      where.status = body.status
      where.canceledAt = null
    }
  }

  if (body.creatorId) {
    where.creatorId = body.creatorId
  }

  if (body.startDate) {
    where.createdAt = { ...where.createdAt, gte: new Date(body.startDate) }
  }

  if (body.endDate) {
    where.createdAt = { ...where.createdAt, lte: new Date(body.endDate) }
  }

  const subscriptions = await db.subscription.findMany({
    where,
    select: {
      id: true,
      creatorId: true,
      subscriberId: true,
      amount: true,
      currency: true,
      status: true,
      canceledAt: true,
      currentPeriodEnd: true,
      createdAt: true,
      creator: {
        select: {
          email: true,
          profile: { select: { username: true, displayName: true } },
        },
      },
      subscriber: {
        select: { email: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: body.limit,
  })

  const headers = [
    'Subscription ID',
    'Creator ID',
    'Creator Email',
    'Creator Username',
    'Subscriber ID',
    'Subscriber Email',
    'Amount (cents)',
    'Currency',
    'Status',
    'Canceled At',
    'Current Period End',
    'Created At',
  ]

  const rows = subscriptions.map(s => [
    s.id,
    s.creatorId,
    s.creator?.email || '',
    s.creator?.profile?.username || '',
    s.subscriberId || '',
    s.subscriber?.email || '',
    s.amount,
    s.currency,
    s.status,
    s.canceledAt?.toISOString() || '',
    s.currentPeriodEnd?.toISOString() || '',
    s.createdAt.toISOString(),
  ])

  await logAdminAction(c, 'Exported subscriptions', {
    filters: body,
    count: subscriptions.length,
  })

  return c.json(createExportResponse(headers, rows, 'subscriptions-export'))
})

/**
 * POST /admin/export/creators
 * Export creator profiles
 */
exportRoutes.post('/creators', auditExport('export_data'), async (c) => {
  const body = z.object({
    country: z.string().optional(),
    payoutStatus: z.enum(['pending', 'connected', 'verified']).optional(),
    paymentProvider: z.enum(['stripe', 'paystack']).optional(),
    limit: z.number().min(1).max(10000).default(5000),
  }).parse(await c.req.json())

  const where: any = {}

  if (body.country) {
    where.countryCode = body.country
  }

  if (body.payoutStatus) {
    where.payoutStatus = body.payoutStatus
  }

  if (body.paymentProvider) {
    where.paymentProvider = body.paymentProvider
  }

  const profiles = await db.profile.findMany({
    where,
    select: {
      id: true,
      userId: true,
      username: true,
      displayName: true,
      bio: true,
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
      isPublic: true,
      createdAt: true,
      user: {
        select: {
          email: true,
          createdAt: true,
          lastLoginAt: true,
          deletedAt: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: body.limit,
  })

  const headers = [
    'Profile ID',
    'User ID',
    'Email',
    'Username',
    'Display Name',
    'Bio',
    'Country',
    'Country Code',
    'Currency',
    'Purpose',
    'Pricing Model',
    'Single Amount (cents)',
    'Payment Provider',
    'Payout Status',
    'Stripe Account ID',
    'Paystack Subaccount',
    'Is Public',
    'Profile Created At',
    'User Created At',
    'Last Login At',
    'Deleted At',
  ]

  const rows = profiles.map(p => [
    p.id,
    p.userId,
    p.user?.email || '',
    p.username,
    p.displayName,
    p.bio || '',
    p.country,
    p.countryCode,
    p.currency,
    p.purpose,
    p.pricingModel,
    p.singleAmount || '',
    p.paymentProvider || '',
    p.payoutStatus,
    p.stripeAccountId || '',
    p.paystackSubaccountCode || '',
    p.isPublic ? 'Yes' : 'No',
    p.createdAt.toISOString(),
    p.user?.createdAt?.toISOString() || '',
    p.user?.lastLoginAt?.toISOString() || '',
    p.user?.deletedAt?.toISOString() || '',
  ])

  await logAdminAction(c, 'Exported creators', {
    filters: body,
    count: profiles.length,
  })

  return c.json(createExportResponse(headers, rows, 'creators-export'))
})

/**
 * POST /admin/export/users
 * Export all users
 */
exportRoutes.post('/users', auditExport('export_data'), async (c) => {
  const body = z.object({
    role: z.enum(['user', 'admin', 'super_admin', 'all']).default('all'),
    includeDeleted: z.boolean().default(false),
    limit: z.number().min(1).max(10000).default(5000),
  }).parse(await c.req.json())

  const where: any = {}

  if (body.role !== 'all') {
    where.role = body.role
  }

  if (!body.includeDeleted) {
    where.deletedAt = null
  }

  const users = await db.user.findMany({
    where,
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
          country: true,
          countryCode: true,
        },
      },
      _count: {
        select: {
          subscriptions: true,
          subscribedTo: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: body.limit,
  })

  const headers = [
    'User ID',
    'Email',
    'Role',
    'Username',
    'Display Name',
    'Country',
    'Country Code',
    'Subscriptions As Creator',
    'Subscriptions As Subscriber',
    'Created At',
    'Last Login At',
    'Deleted At',
  ]

  const rows = users.map(u => [
    u.id,
    u.email,
    u.role,
    u.profile?.username || '',
    u.profile?.displayName || '',
    u.profile?.country || '',
    u.profile?.countryCode || '',
    u._count.subscriptions,
    u._count.subscribedTo,
    u.createdAt.toISOString(),
    u.lastLoginAt?.toISOString() || '',
    u.deletedAt?.toISOString() || '',
  ])

  await logAdminAction(c, 'Exported users', {
    filters: body,
    count: users.length,
  })

  return c.json(createExportResponse(headers, rows, 'users-export'))
})

/**
 * POST /admin/export/disputes
 * Export dispute data
 */
exportRoutes.post('/disputes', auditExport('export_data'), async (c) => {
  const body = z.object({
    status: z.enum(['disputed', 'dispute_won', 'dispute_lost', 'all']).default('all'),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    limit: z.number().min(1).max(10000).default(5000),
  }).parse(await c.req.json())

  const where: any = {
    status: body.status === 'all'
      ? { in: ['disputed', 'dispute_won', 'dispute_lost'] }
      : body.status,
  }

  if (body.startDate) {
    where.createdAt = { ...where.createdAt, gte: new Date(body.startDate) }
  }

  if (body.endDate) {
    where.createdAt = { ...where.createdAt, lte: new Date(body.endDate) }
  }

  const disputes = await db.payment.findMany({
    where,
    select: {
      id: true,
      creatorId: true,
      amountCents: true,
      currency: true,
      status: true,
      stripeDisputeId: true,
      paystackDisputeId: true,
      createdAt: true,
      subscription: {
        select: {
          creator: {
            select: {
              email: true,
              profile: { select: { username: true } },
            },
          },
          subscriber: {
            select: { email: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: body.limit,
  })

  const headers = [
    'Payment ID',
    'Creator ID',
    'Creator Email',
    'Creator Username',
    'Subscriber Email',
    'Amount (cents)',
    'Currency',
    'Status',
    'Stripe Dispute ID',
    'Paystack Dispute ID',
    'Created At',
  ]

  const rows = disputes.map(d => [
    d.id,
    d.creatorId,
    d.subscription?.creator?.email || '',
    d.subscription?.creator?.profile?.username || '',
    d.subscription?.subscriber?.email || '',
    d.amountCents,
    d.currency,
    d.status,
    d.stripeDisputeId || '',
    d.paystackDisputeId || '',
    d.createdAt.toISOString(),
  ])

  await logAdminAction(c, 'Exported disputes', {
    filters: body,
    count: disputes.length,
  })

  return c.json(createExportResponse(headers, rows, 'disputes-export'))
})

export default exportRoutes
