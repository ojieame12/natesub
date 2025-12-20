/**
 * Admin API Keys Management
 *
 * Provides CRUD operations for database-backed API keys.
 * Replaces environment variable approach with proper key management:
 * - Keys stored as SHA-256 hashes (actual key shown only once at creation)
 * - Scoped access (full, readonly)
 * - Expiration and revocation support
 * - Usage tracking with last used timestamp and IP
 *
 * All endpoints require super_admin role.
 */

import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { createHash, randomBytes } from 'crypto'
import { db } from '../../db/client.js'
import { requireRole, logAdminAction } from '../../middleware/adminAuth.js'

const apiKeys = new Hono()

// All API key management requires super_admin
apiKeys.use('*', requireRole('super_admin'))

/**
 * Generate a secure API key
 * Format: sk_adm_<32 random chars>
 */
function generateApiKey(): string {
  const randomPart = randomBytes(24).toString('base64url')
  return `sk_adm_${randomPart}`
}

/**
 * Hash an API key using SHA-256
 */
function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/**
 * Get prefix from API key (first 12 chars including sk_adm_)
 */
function getKeyPrefix(key: string): string {
  return key.slice(0, 12)
}

/**
 * POST /admin/api-keys
 * Create a new API key
 *
 * Body: { name: string, scope?: 'full' | 'readonly', expiresInDays?: number }
 * Returns: { key: string, id: string, ... } - key is shown ONLY once
 */
apiKeys.post('/', async (c) => {
  const body = await c.req.json()
  const { name, scope = 'full', expiresInDays } = body

  if (!name || typeof name !== 'string' || name.length < 2) {
    throw new HTTPException(400, { message: 'Name is required (min 2 characters)' })
  }

  if (scope !== 'full' && scope !== 'readonly') {
    throw new HTTPException(400, { message: 'Scope must be "full" or "readonly"' })
  }

  const adminUserId = c.get('adminUserId')
  if (!adminUserId) {
    // API key auth - we don't have a user ID
    throw new HTTPException(400, {
      message: 'API key creation requires session authentication. Use the admin dashboard.'
    })
  }

  // Generate the key
  const plainKey = generateApiKey()
  const keyHash = hashApiKey(plainKey)
  const keyPrefix = getKeyPrefix(plainKey)

  // Calculate expiration if specified
  let expiresAt: Date | null = null
  if (expiresInDays && expiresInDays > 0) {
    expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + expiresInDays)
  }

  // Create the key record
  const apiKey = await db.adminApiKey.create({
    data: {
      name,
      keyHash,
      keyPrefix,
      scope,
      createdById: adminUserId,
      expiresAt,
    },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scope: true,
      expiresAt: true,
      createdAt: true,
      createdBy: {
        select: { email: true }
      }
    }
  })

  // Log the action
  await logAdminAction(c, 'Created API key', {
    keyId: apiKey.id,
    keyName: name,
    keyPrefix,
    scope,
    expiresAt: expiresAt?.toISOString() || null,
  })

  return c.json({
    success: true,
    message: 'API key created. Save this key - it will not be shown again.',
    key: plainKey, // Only time the full key is shown
    apiKey: {
      ...apiKey,
      createdByEmail: apiKey.createdBy.email,
    }
  })
})

/**
 * GET /admin/api-keys
 * List all API keys (shows prefix only, never the full key)
 */
apiKeys.get('/', async (c) => {
  const keys = await db.adminApiKey.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scope: true,
      lastUsedAt: true,
      lastUsedIp: true,
      expiresAt: true,
      revokedAt: true,
      revokedById: true,
      createdAt: true,
      createdBy: {
        select: { id: true, email: true }
      }
    }
  })

  // Add status field
  const keysWithStatus = keys.map(key => {
    let status: 'active' | 'expired' | 'revoked' = 'active'
    if (key.revokedAt) {
      status = 'revoked'
    } else if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
      status = 'expired'
    }
    return {
      ...key,
      status,
      createdByEmail: key.createdBy.email,
    }
  })

  return c.json({
    keys: keysWithStatus,
    total: keys.length,
    active: keysWithStatus.filter(k => k.status === 'active').length,
  })
})

/**
 * GET /admin/api-keys/:id
 * Get details for a specific API key
 */
apiKeys.get('/:id', async (c) => {
  const id = c.req.param('id')

  const key = await db.adminApiKey.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scope: true,
      lastUsedAt: true,
      lastUsedIp: true,
      expiresAt: true,
      revokedAt: true,
      revokedById: true,
      createdAt: true,
      createdBy: {
        select: { id: true, email: true }
      }
    }
  })

  if (!key) {
    throw new HTTPException(404, { message: 'API key not found' })
  }

  let status: 'active' | 'expired' | 'revoked' = 'active'
  if (key.revokedAt) {
    status = 'revoked'
  } else if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
    status = 'expired'
  }

  return c.json({
    ...key,
    status,
    createdByEmail: key.createdBy.email,
  })
})

/**
 * DELETE /admin/api-keys/:id
 * Revoke an API key (soft delete - keeps record for audit)
 */
apiKeys.delete('/:id', async (c) => {
  const id = c.req.param('id')

  const adminUserId = c.get('adminUserId')

  const key = await db.adminApiKey.findUnique({
    where: { id },
    select: { id: true, name: true, keyPrefix: true, revokedAt: true }
  })

  if (!key) {
    throw new HTTPException(404, { message: 'API key not found' })
  }

  if (key.revokedAt) {
    throw new HTTPException(400, { message: 'API key is already revoked' })
  }

  await db.adminApiKey.update({
    where: { id },
    data: {
      revokedAt: new Date(),
      revokedById: adminUserId || null,
    }
  })

  await logAdminAction(c, 'Revoked API key', {
    keyId: id,
    keyName: key.name,
    keyPrefix: key.keyPrefix,
  })

  return c.json({
    success: true,
    message: `API key "${key.name}" has been revoked`,
  })
})

/**
 * GET /admin/api-keys/:id/usage
 * Get usage audit trail for a specific API key
 * Fetches from SystemLog entries related to this key
 */
apiKeys.get('/:id/usage', async (c) => {
  const id = c.req.param('id')
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200)
  const offset = parseInt(c.req.query('offset') || '0')

  const key = await db.adminApiKey.findUnique({
    where: { id },
    select: { id: true, name: true, keyPrefix: true }
  })

  if (!key) {
    throw new HTTPException(404, { message: 'API key not found' })
  }

  // Query system logs for this key's usage
  // The adminAuth middleware logs access with keyPrefix in metadata
  const logs = await db.systemLog.findMany({
    where: {
      type: 'admin_access',
      metadata: {
        path: ['keyPrefix'],
        equals: key.keyPrefix,
      }
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
      type: 'admin_access',
      metadata: {
        path: ['keyPrefix'],
        equals: key.keyPrefix,
      }
    }
  })

  return c.json({
    keyId: id,
    keyName: key.name,
    keyPrefix: key.keyPrefix,
    usage: logs,
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + logs.length < total,
    }
  })
})

/**
 * PATCH /admin/api-keys/:id
 * Update an API key (name, scope, expiration)
 */
apiKeys.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const { name, scope, expiresInDays, clearExpiration } = body

  const key = await db.adminApiKey.findUnique({
    where: { id },
    select: { id: true, name: true, keyPrefix: true, revokedAt: true }
  })

  if (!key) {
    throw new HTTPException(404, { message: 'API key not found' })
  }

  if (key.revokedAt) {
    throw new HTTPException(400, { message: 'Cannot update a revoked key' })
  }

  const updateData: Record<string, unknown> = {}
  const changes: string[] = []

  if (name && typeof name === 'string' && name.length >= 2) {
    updateData.name = name
    changes.push(`name: ${key.name} → ${name}`)
  }

  if (scope && (scope === 'full' || scope === 'readonly')) {
    updateData.scope = scope
    changes.push(`scope: → ${scope}`)
  }

  if (clearExpiration) {
    updateData.expiresAt = null
    changes.push('expiration cleared')
  } else if (expiresInDays && expiresInDays > 0) {
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + expiresInDays)
    updateData.expiresAt = expiresAt
    changes.push(`expiresAt: ${expiresAt.toISOString()}`)
  }

  if (Object.keys(updateData).length === 0) {
    throw new HTTPException(400, { message: 'No valid updates provided' })
  }

  const updated = await db.adminApiKey.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      scope: true,
      expiresAt: true,
    }
  })

  await logAdminAction(c, 'Updated API key', {
    keyId: id,
    keyName: updated.name,
    keyPrefix: key.keyPrefix,
    changes,
  })

  return c.json({
    success: true,
    message: 'API key updated',
    apiKey: updated,
  })
})

export default apiKeys
