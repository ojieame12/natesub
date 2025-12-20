/**
 * Admin User Management Controller
 *
 * Manages admin users: promote, demote, list admins.
 * Only super_admin can modify admin roles.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { HTTPException } from 'hono/http-exception'
import { requireRole, logAdminAction, requireFreshSession } from '../../middleware/adminAuth.js'
import { adminSensitiveRateLimit } from '../../middleware/rateLimit.js'
import type { UserRole } from '@prisma/client'

const admins = new Hono()

// All admin management requires super_admin
admins.use('*', requireRole('super_admin'))

/**
 * GET /admin/admins
 * List all users with admin or super_admin role
 */
admins.get('/', async (c) => {
  const adminUsers = await db.user.findMany({
    where: {
      role: { in: ['admin', 'super_admin'] },
      deletedAt: null,
    },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      lastLoginAt: true,
      adminGrantedBy: true,
      adminGrantedAt: true,
      profile: {
        select: {
          displayName: true,
          username: true,
        }
      }
    },
    orderBy: [
      { role: 'desc' }, // super_admin first
      { adminGrantedAt: 'desc' },
    ],
  })

  // Get the email of the granter for each admin
  const grantedByIds = adminUsers
    .map(u => u.adminGrantedBy)
    .filter((id): id is string => id !== null)

  const granters = await db.user.findMany({
    where: { id: { in: grantedByIds } },
    select: { id: true, email: true },
  })
  const granterMap = new Map(granters.map(g => [g.id, g.email]))

  return c.json({
    admins: adminUsers.map(user => ({
      id: user.id,
      email: user.email,
      role: user.role,
      displayName: user.profile?.displayName,
      username: user.profile?.username,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      adminGrantedAt: user.adminGrantedAt,
      adminGrantedByEmail: user.adminGrantedBy ? granterMap.get(user.adminGrantedBy) : null,
    })),
    total: adminUsers.length,
    superAdminCount: adminUsers.filter(u => u.role === 'super_admin').length,
    adminCount: adminUsers.filter(u => u.role === 'admin').length,
  })
})

/**
 * POST /admin/users/:id/promote
 * Promote a user to admin or super_admin
 * Requires: super_admin, fresh session
 */
admins.post('/users/:id/promote', adminSensitiveRateLimit, requireFreshSession, async (c) => {
  const { id } = c.req.param()
  const body = z.object({
    role: z.enum(['admin', 'super_admin']),
    reason: z.string().min(1).max(500).optional(),
  }).parse(await c.req.json())

  const adminUserId = c.get('adminUserId')
  if (!adminUserId) {
    throw new HTTPException(401, { message: 'Session authentication required' })
  }

  // Cannot promote yourself
  if (id === adminUserId) {
    throw new HTTPException(400, { message: 'Cannot modify your own role' })
  }

  // Find the target user
  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, deletedAt: true },
  })

  if (!user) {
    throw new HTTPException(404, { message: 'User not found' })
  }

  if (user.deletedAt) {
    throw new HTTPException(400, { message: 'Cannot promote a deleted user' })
  }

  // Check if already at this role or higher
  const roleHierarchy: Record<UserRole, number> = {
    user: 0,
    admin: 1,
    super_admin: 2,
  }

  if (roleHierarchy[user.role] >= roleHierarchy[body.role]) {
    throw new HTTPException(400, {
      message: `User is already ${user.role}. Cannot promote to ${body.role}.`
    })
  }

  // Perform the promotion
  await db.user.update({
    where: { id },
    data: {
      role: body.role,
      adminGrantedBy: adminUserId,
      adminGrantedAt: new Date(),
      // Clear any previous revocation
      adminRevokedBy: null,
      adminRevokedAt: null,
    },
  })

  // Log the action
  await logAdminAction(c, `Promoted user to ${body.role}`, {
    targetUserId: id,
    targetEmail: user.email,
    previousRole: user.role,
    newRole: body.role,
    reason: body.reason,
  })

  return c.json({
    success: true,
    message: `${user.email} promoted to ${body.role}`,
    user: {
      id: user.id,
      email: user.email,
      previousRole: user.role,
      newRole: body.role,
    }
  })
})

/**
 * POST /admin/users/:id/demote
 * Demote an admin to regular user
 * Requires: super_admin, fresh session
 */
admins.post('/users/:id/demote', adminSensitiveRateLimit, requireFreshSession, async (c) => {
  const { id } = c.req.param()
  const body = z.object({
    reason: z.string().min(1).max(500),
  }).parse(await c.req.json())

  const adminUserId = c.get('adminUserId')
  if (!adminUserId) {
    throw new HTTPException(401, { message: 'Session authentication required' })
  }

  // Cannot demote yourself
  if (id === adminUserId) {
    throw new HTTPException(400, { message: 'Cannot modify your own role' })
  }

  // Find the target user
  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true },
  })

  if (!user) {
    throw new HTTPException(404, { message: 'User not found' })
  }

  if (user.role === 'user') {
    throw new HTTPException(400, { message: 'User is not an admin' })
  }

  // Perform the demotion
  await db.user.update({
    where: { id },
    data: {
      role: 'user',
      adminRevokedBy: adminUserId,
      adminRevokedAt: new Date(),
    },
  })

  // Log the action
  await logAdminAction(c, 'Demoted admin to user', {
    targetUserId: id,
    targetEmail: user.email,
    previousRole: user.role,
    newRole: 'user',
    reason: body.reason,
  })

  return c.json({
    success: true,
    message: `${user.email} demoted to regular user`,
    user: {
      id: user.id,
      email: user.email,
      previousRole: user.role,
      newRole: 'user',
    }
  })
})

/**
 * GET /admin/admins/audit
 * Get audit trail of admin role changes
 */
admins.get('/audit', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200)
  const offset = parseInt(c.req.query('offset') || '0')

  const logs = await db.systemLog.findMany({
    where: {
      OR: [
        { message: { contains: 'Promoted user to' } },
        { message: { contains: 'Demoted admin to' } },
      ]
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
    select: {
      id: true,
      type: true,
      message: true,
      metadata: true,
      createdAt: true,
    }
  })

  const total = await db.systemLog.count({
    where: {
      OR: [
        { message: { contains: 'Promoted user to' } },
        { message: { contains: 'Demoted admin to' } },
      ]
    }
  })

  return c.json({
    audit: logs,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + logs.length < total,
    }
  })
})

/**
 * GET /admin/users/:id/admin-history
 * Get admin role history for a specific user
 */
admins.get('/users/:id/admin-history', async (c) => {
  const { id } = c.req.param()

  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      role: true,
      adminGrantedBy: true,
      adminGrantedAt: true,
      adminRevokedBy: true,
      adminRevokedAt: true,
    }
  })

  if (!user) {
    throw new HTTPException(404, { message: 'User not found' })
  }

  // Get the full history from system logs
  const logs = await db.systemLog.findMany({
    where: {
      OR: [
        { metadata: { path: ['targetUserId'], equals: id } },
      ],
      message: {
        contains: 'user to',  // Matches both "Promoted user to" and "Demoted admin to user"
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      message: true,
      metadata: true,
      createdAt: true,
    }
  })

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      currentRole: user.role,
    },
    currentGrant: user.adminGrantedAt ? {
      grantedBy: user.adminGrantedBy,
      grantedAt: user.adminGrantedAt,
    } : null,
    lastRevocation: user.adminRevokedAt ? {
      revokedBy: user.adminRevokedBy,
      revokedAt: user.adminRevokedAt,
    } : null,
    history: logs,
  })
})

export default admins
