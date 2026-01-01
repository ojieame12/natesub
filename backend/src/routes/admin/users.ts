/**
 * Admin Users Controller
 *
 * User management routes for admin dashboard.
 * Includes: list, view, block, unblock, delete, test cleanup, and creator creation.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { createSubaccount, type PaystackCountry } from '../../services/paystack.js'
import { sendCreatorAccountCreatedEmail } from '../../services/email.js'
import { RESERVED_USERNAMES } from '../../utils/constants.js'
import { displayAmountToCents } from '../../utils/currency.js'
import { env } from '../../config/env.js'
import { adminSensitiveRateLimit } from '../../middleware/rateLimit.js'
import { requireRole, requireFreshSession, logAdminAction } from '../../middleware/adminAuth.js'
import { auditSensitiveRead } from '../../middleware/auditLog.js'
import { deleteUser } from '../../services/userDeletion.js'
import { paginationWithSearchSchema, getPaginationOffsets, formatLegacyPaginatedResponse } from '../../utils/pagination.js'
import { buildUserWhere } from '../../utils/prismaFilters.js'

const users = new Hono()

// Country to currency mapping for Paystack countries
const COUNTRY_CURRENCY_MAP: Record<PaystackCountry, { currency: string; countryName: string }> = {
  NG: { currency: 'NGN', countryName: 'Nigeria' },
  KE: { currency: 'KES', countryName: 'Kenya' },
  ZA: { currency: 'ZAR', countryName: 'South Africa' },
}

// ============================================
// USER LIST & DETAILS
// ============================================

/**
 * GET /admin/users
 * List users with pagination and filtering
 */
users.get('/', auditSensitiveRead('user_list'), async (c) => {
  const query = z.object({
    ...paginationWithSearchSchema.shape,
    status: z.enum(['all', 'active', 'blocked', 'deleted']).default('all')
  }).parse(c.req.query())

  const { skip, take } = getPaginationOffsets(query)

  // Build base where clause with search
  const where = buildUserWhere({ search: query.search })

  // Status filtering - uses custom semantics (deletedAt + profile presence)
  if (query.status === 'active') {
    where.deletedAt = null
  } else if (query.status === 'blocked') {
    where.deletedAt = { not: null }
    where.profile = { isNot: null }
  } else if (query.status === 'deleted') {
    where.deletedAt = { not: null }
    where.profile = null
  }

  const [dbUsers, total] = await Promise.all([
    db.user.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        profile: {
          select: {
            username: true, displayName: true, avatarUrl: true,
            currency: true, country: true, payoutStatus: true, paymentProvider: true
          }
        },
        _count: { select: { subscriptions: true, subscribedTo: true } }
      }
    }),
    db.user.count({ where })
  ])

  const userIds = dbUsers.map(u => u.id)

  // Batch fetch revenue for users on this page
  // Uses database index on (creatorId, status, occurredAt)
  const revenues = await db.payment.groupBy({
    by: ['creatorId'],
    where: { creatorId: { in: userIds }, status: 'succeeded' },
    _sum: { netCents: true }
  })
  const revenueMapObj = new Map(revenues.map(r => [r.creatorId, r._sum.netCents || 0]))

  const getUserStatus = (user: { deletedAt: Date | null; profile: any }) => {
    if (!user.deletedAt) return 'active'
    return user.profile ? 'blocked' : 'deleted'
  }

  const users = dbUsers.map(u => ({
    id: u.id,
    email: u.email,
    profile: u.profile ? {
      username: u.profile.username,
      displayName: u.profile.displayName,
      avatarUrl: u.profile.avatarUrl,
      country: u.profile.country,
      currency: u.profile.currency,
      payoutStatus: u.profile.payoutStatus,
      paymentProvider: u.profile.paymentProvider,
    } : null,
    status: getUserStatus(u),
    subscriberCount: u._count.subscriptions,
    subscribedToCount: u._count.subscribedTo,
    revenueTotal: revenueMapObj.get(u.id) || 0,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt
  }))

  return c.json(formatLegacyPaginatedResponse(users, total, query, 'users'))
})

/**
 * GET /admin/users/:id
 * Get user details with stats
 */
users.get('/:id', auditSensitiveRead('user_details'), async (c) => {
  const { id } = c.req.param()

  const user = await db.user.findUnique({
    where: { id },
    include: {
      profile: true,
      subscriptions: {
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { subscriber: { select: { email: true } } }
      },
      subscribedTo: {
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { creator: { select: { email: true, profile: { select: { username: true } } } } }
      }
    }
  })

  if (!user) return c.json({ error: 'User not found' }, 404)

  const paymentStats = await db.payment.aggregate({
    where: { creatorId: id, status: 'succeeded' },
    _sum: { netCents: true, feeCents: true },
    _count: true
  })

  return c.json({
    user: {
      ...user,
      stats: {
        totalPayments: paymentStats._count,
        totalRevenueCents: paymentStats._sum.netCents || 0,
        totalFeesCents: paymentStats._sum.feeCents || 0
      }
    }
  })
})

// ============================================
// USER ACTIONS (Block/Unblock/Delete)
// ============================================

/**
 * POST /admin/users/:id/block
 * Block a user (soft delete with profile retained)
 * Requires: super_admin
 */
users.post('/:id/block', adminSensitiveRateLimit, requireRole('super_admin'), requireFreshSession, async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json().catch(() => ({}))
  const reason = body.reason || 'Blocked by admin'

  await db.user.update({ where: { id }, data: { deletedAt: new Date() } })
  await db.activity.create({
    data: {
      userId: id,
      type: 'admin_block',
      payload: {
        reason,
        blockedAt: new Date().toISOString(),
        adminId: c.get('adminUserId'),
        adminEmail: c.get('adminEmail')
      }
    }
  })

  return c.json({ success: true })
})

/**
 * POST /admin/users/:id/unblock
 * Unblock a user
 * Requires: super_admin
 */
users.post('/:id/unblock', adminSensitiveRateLimit, requireRole('super_admin'), requireFreshSession, async (c) => {
  const { id } = c.req.param()

  await db.user.update({ where: { id }, data: { deletedAt: null } })
  await db.activity.create({
    data: {
      userId: id,
      type: 'admin_unblock',
      payload: {
        unblockedAt: new Date().toISOString(),
        adminId: c.get('adminUserId'),
        adminEmail: c.get('adminEmail')
      }
    }
  })

  return c.json({ success: true })
})

/**
 * DELETE /admin/users/:id
 * Full account deletion with cleanup
 * Requires: super_admin
 */
users.delete('/:id', adminSensitiveRateLimit, requireRole('super_admin'), requireFreshSession, async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json().catch(() => ({}))

  if (body.confirm !== 'DELETE') {
    return c.json({ error: 'Must confirm with { confirm: "DELETE" }' }, 400)
  }

  const user = await db.user.findUnique({
    where: { id },
    include: { profile: { select: { platformSubscriptionId: true } } },
  })

  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }

  const reason = body.reason || 'Deleted by admin'
  const adminContext = {
    adminUserId: c.get('adminUserId') as string,
    adminEmail: c.get('adminEmail') as string,
  }

  const result = await deleteUser(
    id,
    adminContext,
    reason,
    user.email,
    user.profile?.platformSubscriptionId
  )

  return c.json({
    success: result.success,
    message: 'User deleted with full cleanup',
    details: {
      canceledSubscriptions: result.canceledSubscriptions,
      errors: result.errors.length > 0 ? result.errors : undefined,
    },
  })
})

// ============================================
// TEST USER CLEANUP
// ============================================

/**
 * GET /admin/users/test-cleanup/preview
 * Preview test users that would be cleaned up
 */
users.get('/test-cleanup/preview', async (c) => {
  const testUsers = await db.user.findMany({
    where: {
      OR: [
        { email: { endsWith: '@test.com' } },
        { email: { endsWith: '@example.com' } },
        { email: { startsWith: 'test@' } },
        { email: { startsWith: 'demo@' } },
        { email: { contains: '+test' } },
        { email: { contains: 'testuser' } },
      ],
      deletedAt: null,
    },
    select: {
      id: true,
      email: true,
      createdAt: true,
      profile: {
        select: { username: true, displayName: true },
      },
      _count: {
        select: { subscriptions: true, subscribedTo: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return c.json({
    count: testUsers.length,
    users: testUsers,
    patterns: [
      '*@test.com',
      '*@example.com',
      'test@*',
      'demo@*',
      '*+test*',
      '*testuser*',
    ],
  })
})

/**
 * POST /admin/users/test-cleanup/delete
 * Bulk delete test users
 * Requires: super_admin
 */
users.post('/test-cleanup/delete', adminSensitiveRateLimit, requireRole('super_admin'), async (c) => {
  const body = z.object({
    confirm: z.boolean(),
    dryRun: z.boolean().default(false),
  }).parse(await c.req.json())

  if (!body.confirm) {
    return c.json({ error: 'Must confirm deletion with { confirm: true }' }, 400)
  }

  const testUsers = await db.user.findMany({
    where: {
      OR: [
        { email: { endsWith: '@test.com' } },
        { email: { endsWith: '@example.com' } },
        { email: { startsWith: 'test@' } },
        { email: { startsWith: 'demo@' } },
        { email: { contains: '+test' } },
        { email: { contains: 'testuser' } },
      ],
      deletedAt: null,
    },
    select: { id: true, email: true },
  })

  if (body.dryRun) {
    return c.json({
      dryRun: true,
      wouldDelete: testUsers.length,
      users: testUsers.map(u => u.email),
    })
  }

  let deleted = 0
  const errors: string[] = []

  for (const user of testUsers) {
    try {
      await db.subscription.updateMany({
        where: { OR: [{ creatorId: user.id }, { subscriberId: user.id }] },
        data: { status: 'canceled', canceledAt: new Date() },
      })
      await db.session.deleteMany({ where: { userId: user.id } })
      await db.profile.deleteMany({ where: { userId: user.id } })
      await db.user.update({
        where: { id: user.id },
        data: {
          deletedAt: new Date(),
          email: `deleted_${user.id}@deleted.natepay.co`,
        },
      })
      deleted++
    } catch (err) {
      errors.push(`${user.email}: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  await db.activity.create({
    data: {
      userId: testUsers[0]?.id || 'system',
      type: 'admin_bulk_cleanup',
      payload: {
        deletedCount: deleted,
        errors: errors.length,
        performedAt: new Date().toISOString(),
        adminId: c.get('adminUserId'),
        adminEmail: c.get('adminEmail'),
      },
    },
  })

  return c.json({
    success: true,
    deleted,
    errors: errors.length > 0 ? errors : undefined,
  })
})

// ============================================
// CREATOR CREATION
// ============================================

/**
 * POST /admin/users/create-creator
 * Create a fully-functional creator account
 * Requires: super_admin
 */
users.post('/create-creator', adminSensitiveRateLimit, requireRole('super_admin'), async (c) => {
  const body = z.object({
    email: z.string().email(),
    displayName: z.string().min(2).max(50),
    username: z.string().min(3).max(20).regex(/^[a-z0-9_]+$/i, 'Username can only contain letters, numbers, and underscores'),
    country: z.enum(['NG', 'KE', 'ZA']),
    bankCode: z.string().min(1),
    accountNumber: z.string().min(9).max(20),
    accountName: z.string().min(1).max(100).optional(),
    amount: z.number().positive(),
  }).parse(await c.req.json())

  const username = body.username.toLowerCase()
  const countryInfo = COUNTRY_CURRENCY_MAP[body.country]

  if (RESERVED_USERNAMES.includes(username)) {
    return c.json({ error: 'This username is reserved' }, 400)
  }

  const amountCents = displayAmountToCents(body.amount, countryInfo.currency)

  try {
    // Use transaction with all checks inside to prevent race conditions
    // The unique constraints on email and username will catch any concurrent conflicts
    const result = await db.$transaction(async (tx) => {
      // Check username uniqueness inside transaction
      const existingUsername = await tx.profile.findUnique({ where: { username } })
      if (existingUsername) {
        throw new Error('USERNAME_TAKEN')
      }

      // Check email uniqueness inside transaction
      const existingEmail = await tx.user.findUnique({ where: { email: body.email.toLowerCase() } })
      if (existingEmail) {
        throw new Error('EMAIL_EXISTS')
      }

      const user = await tx.user.create({
        data: {
          email: body.email.toLowerCase(),
          onboardingStep: 7,
        },
      })

      const profile = await tx.profile.create({
        data: {
          userId: user.id,
          username,
          displayName: body.displayName,
          country: countryInfo.countryName,
          countryCode: body.country,
          currency: countryInfo.currency,
          purpose: 'support',
          pricingModel: 'single',
          singleAmount: amountCents,
          feeMode: 'split',
          paymentProvider: 'paystack',
          payoutStatus: 'pending',
        },
      })

      return { user, profile }
    })

    try {
      await createSubaccount({
        userId: result.user.id,
        businessName: body.displayName,
        bankCode: body.bankCode,
        accountNumber: body.accountNumber,
        email: body.email.toLowerCase(),
        purpose: 'personal',
      })
    } catch (err: any) {
      await db.user.delete({ where: { id: result.user.id } })
      throw new Error(`Paystack error: ${err.message}`)
    }

    const paymentLink = `${env.PUBLIC_PAGE_URL}/${username}`

    sendCreatorAccountCreatedEmail(
      body.email.toLowerCase(),
      body.displayName,
      username,
      paymentLink,
      body.amount,
      countryInfo.currency
    ).catch((err) => {
      console.error('[admin] Failed to send creator account email:', err)
    })

    await logAdminAction(c, 'create_creator', {
      createdUserId: result.user.id,
      email: body.email.toLowerCase(),
      username,
      country: body.country,
    })

    return c.json({
      success: true,
      user: {
        id: result.user.id,
        email: result.user.email,
        username,
        displayName: body.displayName,
        paymentLink,
      },
      message: `Creator account created successfully. Payment link: ${paymentLink}`,
    })
  } catch (err: any) {
    // Handle custom validation errors from transaction
    if (err.message === 'USERNAME_TAKEN') {
      return c.json({ error: 'Username is already taken' }, 400)
    }
    if (err.message === 'EMAIL_EXISTS') {
      return c.json({ error: 'An account with this email already exists' }, 400)
    }

    console.error('[admin] Failed to create creator:', err)
    return c.json({ error: 'Failed to create creator account' }, 500)
  }
})

export default users
