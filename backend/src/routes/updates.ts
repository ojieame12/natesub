import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { updateSendRateLimit } from '../middleware/rateLimit.js'
import { sendUpdateEmail } from '../services/email.js'
import { acquireLock, releaseLock } from '../services/lock.js'
import { updateEmailQueue } from '../lib/queue.js'
import type { UpdateEmailJobData } from '../workers/updateEmailProcessor.js'

const updates = new Hono()

// ============================================
// TYPES
// ============================================

interface NotificationPrefs {
  push?: boolean
  email?: boolean
  subscriberAlerts?: boolean
  paymentAlerts?: boolean
}

interface Tier {
  id: string
  name: string
  amount: number
  perks?: string[]
  isPopular?: boolean
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Validate that audience is a valid tier ID if not a preset
 */
async function validateAudience(audience: string, tiers: Tier[] | null): Promise<boolean> {
  const presets = ['all', 'supporters', 'vip']
  if (presets.includes(audience)) {
    return true
  }
  // Check if it's a valid tier ID
  if (tiers && Array.isArray(tiers)) {
    return tiers.some(t => t.id === audience)
  }
  return false
}

/**
 * Get tier IDs based on audience filter
 */
function getAudienceTierIds(audience: string, tiers: Tier[] | null): string[] | null {
  if (!tiers || !Array.isArray(tiers) || tiers.length === 0) {
    return null // No tier filtering
  }

  const sortedTiers = [...tiers].sort((a, b) => b.amount - a.amount)

  switch (audience) {
    case 'all':
      return null // No filtering
    case 'supporters':
      // All tiers except the lowest (cheapest)
      if (sortedTiers.length <= 1) return null
      return sortedTiers.slice(0, -1).map(t => t.id)
    case 'vip':
      // Only the highest tier
      return [sortedTiers[0].id]
    default:
      // Specific tier ID
      return [audience]
  }
}

/**
 * Check if subscriber has opted in to receive update emails
 */
function shouldReceiveUpdate(notificationPrefs: NotificationPrefs | null): boolean {
  if (!notificationPrefs) return true // Default to sending if no prefs set

  // Check if email notifications are disabled
  if (notificationPrefs.email === false) return false

  // Check if subscriber alerts are disabled
  if (notificationPrefs.subscriberAlerts === false) return false

  return true
}

// ============================================
// ROUTES
// ============================================

// Create update (draft)
updates.post(
  '/',
  requireAuth,
  zValidator('json', z.object({
    title: z.string().max(200).optional(),
    body: z.string().min(1).max(5000),
    photoUrl: z.string().url().optional(),
    audience: z.string().default('all'), // all, supporters, vip, or tier ID
  })),
  async (c) => {
    const userId = c.get('userId')
    const data = c.req.valid('json')

    // Get profile to validate audience against tiers
    const profile = await db.profile.findUnique({
      where: { userId },
      select: { tiers: true },
    })

    const tiers = profile?.tiers as Tier[] | null

    // Validate audience
    if (!await validateAudience(data.audience, tiers)) {
      return c.json({ error: 'Invalid audience. Use "all", "supporters", "vip", or a valid tier ID.' }, 400)
    }

    const update = await db.update.create({
      data: {
        creatorId: userId,
        title: data.title || null,
        body: data.body,
        photoUrl: data.photoUrl || null,
        audience: data.audience,
        status: 'draft',
      },
    })

    return c.json({ update })
  }
)

// Get my updates (with pagination)
updates.get('/', requireAuth, async (c) => {
  const userId = c.get('userId')
  const cursor = c.req.query('cursor')
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100) // Max 100

  const upds = await db.update.findMany({
    where: { creatorId: userId },
    orderBy: { createdAt: 'desc' },
    take: limit + 1, // Fetch one extra to check if there's a next page
    ...(cursor && {
      cursor: { id: cursor },
      skip: 1, // Skip the cursor item itself
    }),
  })

  const hasMore = upds.length > limit
  const items = hasMore ? upds.slice(0, -1) : upds
  const nextCursor = hasMore ? items[items.length - 1]?.id : null

  return c.json({
    updates: items.map(u => ({
      id: u.id,
      title: u.title,
      body: u.body.substring(0, 200) + (u.body.length > 200 ? '...' : ''),
      photoUrl: u.photoUrl,
      audience: u.audience,
      status: u.status,
      recipientCount: u.recipientCount,
      viewCount: u.viewCount,
      sentAt: u.sentAt,
      createdAt: u.createdAt,
    })),
    nextCursor,
    hasMore,
  })
})

// Get single update with delivery stats
updates.get(
  '/:id',
  requireAuth,
  zValidator('param', z.object({ id: z.string().uuid() })),
  async (c) => {
    const userId = c.get('userId')
    const { id } = c.req.valid('param')

    const update = await db.update.findFirst({
      where: { id, creatorId: userId },
      include: {
        _count: {
          select: {
            deliveries: true,
          },
        },
      },
    })

    if (!update) {
      return c.json({ error: 'Update not found' }, 404)
    }

    // Get delivery stats if sent
    let deliveryStats = null
    if (update.status === 'sent') {
      const stats = await db.updateDelivery.groupBy({
        by: ['status'],
        where: { updateId: id },
        _count: true,
      })
      deliveryStats = {
        total: update._count.deliveries,
        sent: stats.find(s => s.status === 'sent')?._count || 0,
        failed: stats.find(s => s.status === 'failed')?._count || 0,
        opened: stats.find(s => s.status === 'opened')?._count || 0,
      }
    }

    return c.json({
      update: {
        ...update,
        deliveryStats,
      },
    })
  }
)

// Update draft
updates.put(
  '/:id',
  requireAuth,
  zValidator('param', z.object({ id: z.string().uuid() })),
  zValidator('json', z.object({
    title: z.string().max(200).optional(),
    body: z.string().min(1).max(5000).optional(),
    photoUrl: z.string().url().optional().nullable(),
    audience: z.string().optional(),
  })),
  async (c) => {
    const userId = c.get('userId')
    const { id } = c.req.valid('param')
    const data = c.req.valid('json')

    const update = await db.update.findFirst({
      where: { id, creatorId: userId },
    })

    if (!update) {
      return c.json({ error: 'Update not found' }, 404)
    }

    if (update.status !== 'draft') {
      return c.json({ error: 'Cannot edit a sent update' }, 400)
    }

    // Validate audience if being changed
    if (data.audience) {
      const profile = await db.profile.findUnique({
        where: { userId },
        select: { tiers: true },
      })
      const tiers = profile?.tiers as Tier[] | null

      if (!await validateAudience(data.audience, tiers)) {
        return c.json({ error: 'Invalid audience. Use "all", "supporters", "vip", or a valid tier ID.' }, 400)
      }
    }

    const updated = await db.update.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.body !== undefined && { body: data.body }),
        ...(data.photoUrl !== undefined && { photoUrl: data.photoUrl }),
        ...(data.audience !== undefined && { audience: data.audience }),
      },
    })

    return c.json({ update: updated })
  }
)

// Delete draft
updates.delete(
  '/:id',
  requireAuth,
  zValidator('param', z.object({ id: z.string().uuid() })),
  async (c) => {
    const userId = c.get('userId')
    const { id } = c.req.valid('param')

    const update = await db.update.findFirst({
      where: { id, creatorId: userId },
    })

    if (!update) {
      return c.json({ error: 'Update not found' }, 404)
    }

    if (update.status !== 'draft') {
      return c.json({ error: 'Cannot delete a sent update' }, 400)
    }

    await db.update.delete({ where: { id } })

    return c.json({ success: true })
  }
)

// Send update to subscribers
// Rate limited: 5 updates per day per creator
updates.post(
  '/:id/send',
  requireAuth,
  updateSendRateLimit,
  zValidator('param', z.object({ id: z.string().uuid() })),
  async (c) => {
    const userId = c.get('userId')
    const { id } = c.req.valid('param')

    // Acquire lock to prevent double-send
    const lockKey = `update:send:${id}`
    const lockToken = await acquireLock(lockKey, 60000) // 1 minute TTL

    if (!lockToken) {
      return c.json({ error: 'Update is already being sent. Please wait.' }, 409)
    }

    try {
      // Re-fetch update inside lock to prevent TOCTOU
      const update = await db.update.findFirst({
        where: { id, creatorId: userId },
      })

      if (!update) {
        return c.json({ error: 'Update not found' }, 404)
      }

      if (update.status !== 'draft') {
        return c.json({ error: 'Update has already been sent' }, 400)
      }

      // Get creator profile
      const profile = await db.profile.findUnique({
        where: { userId },
        select: {
          displayName: true,
          username: true,
          tiers: true,
        },
      })

      if (!profile) {
        return c.json({ error: 'Profile not found' }, 400)
      }

      const tiers = profile.tiers as Tier[] | null

      // Build subscriber filter based on audience
      const audienceTierIds = getAudienceTierIds(update.audience, tiers)

      // Get active subscriptions with subscriber preferences
      const subscriptions = await db.subscription.findMany({
        where: {
          creatorId: userId,
          status: 'active',
          ...(audienceTierIds && { tierId: { in: audienceTierIds } }),
        },
        include: {
          subscriber: {
            select: {
              id: true,
              email: true,
              profile: {
                select: {
                  notificationPrefs: true,
                },
              },
            },
          },
        },
      })

      // Filter subscribers based on notification preferences
      const eligibleSubscribers = subscriptions.filter(sub => {
        const prefs = sub.subscriber.profile?.notificationPrefs as NotificationPrefs | null
        return shouldReceiveUpdate(prefs)
      })

      const creatorName = profile.displayName
      const creatorUsername = profile.username

      // Create delivery records for all eligible subscribers
      if (eligibleSubscribers.length > 0) {
        await db.updateDelivery.createMany({
          data: eligibleSubscribers.map(sub => ({
            updateId: id,
            subscriberId: sub.subscriber.id,
            status: 'pending',
            channel: 'email',
          })),
          skipDuplicates: true,
        })
      }

      // Mark update as sent immediately (emails sent in background)
      await db.update.update({
        where: { id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          recipientCount: eligibleSubscribers.length,
        },
      })

      // Create activity
      await db.activity.create({
        data: {
          userId,
          type: 'update_sent',
          payload: {
            updateId: id,
            title: update.title,
            recipientCount: eligibleSubscribers.length,
            audience: update.audience,
          },
        },
      })

      // Enqueue emails via BullMQ for reliable delivery with retries
      // This is more reliable than fire-and-forget: server crash = retried jobs
      const deliveries = await db.updateDelivery.findMany({
        where: {
          updateId: id,
          subscriberId: { in: eligibleSubscribers.map(s => s.subscriber.id) },
        },
        select: {
          id: true,
          subscriberId: true,
        },
      })

      // Create a map for quick lookup
      const deliveryMap = new Map(deliveries.map(d => [d.subscriberId, d.id]))

      // Enqueue each email as a separate job for individual retry handling
      for (const sub of eligibleSubscribers) {
        const deliveryId = deliveryMap.get(sub.subscriber.id)
        if (!deliveryId) continue

        const jobData: UpdateEmailJobData = {
          updateId: id,
          deliveryId,
          subscriberEmail: sub.subscriber.email,
          creatorName,
          creatorUsername,
          title: update.title,
          body: update.body,
          photoUrl: update.photoUrl,
        }

        // Use a unique job ID for idempotency (prevents duplicate sends on retry)
        await updateEmailQueue.add('update-email', jobData)
      }

      console.log(`[updates] Enqueued ${eligibleSubscribers.length} email jobs for update ${id}`)

      return c.json({
        success: true,
        recipientCount: eligibleSubscribers.length,
        skippedCount: subscriptions.length - eligibleSubscribers.length,
      })
    } finally {
      await releaseLock(lockKey, lockToken)
    }
  }
)

// Retry failed deliveries (for manual retry)
updates.post(
  '/:id/retry-failed',
  requireAuth,
  zValidator('param', z.object({ id: z.string().uuid() })),
  async (c) => {
    const userId = c.get('userId')
    const { id } = c.req.valid('param')

    const update = await db.update.findFirst({
      where: { id, creatorId: userId },
    })

    if (!update) {
      return c.json({ error: 'Update not found' }, 404)
    }

    if (update.status !== 'sent') {
      return c.json({ error: 'Update has not been sent yet' }, 400)
    }

    // Get failed deliveries
    const failedDeliveries = await db.updateDelivery.findMany({
      where: {
        updateId: id,
        status: 'failed',
      },
      include: {
        subscriber: {
          select: {
            email: true,
          },
        },
      },
    })

    if (failedDeliveries.length === 0) {
      return c.json({ success: true, retriedCount: 0, message: 'No failed deliveries to retry' })
    }

    // Get creator profile
    const profile = await db.profile.findUnique({
      where: { userId },
      select: { displayName: true, username: true },
    })

    if (!profile) {
      return c.json({ error: 'Profile not found' }, 400)
    }

    let retriedCount = 0
    let successCount = 0

    for (const delivery of failedDeliveries) {
      retriedCount++
      try {
        await sendUpdateEmail(
          delivery.subscriber.email,
          profile.displayName,
          update.title,
          update.body,
          {
            photoUrl: update.photoUrl,
            creatorUsername: profile.username,
            deliveryId: delivery.id,  // Pass delivery ID for tracking pixel
          }
        )

        await db.updateDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'sent',
            sentAt: new Date(),
            error: null,
          },
        })

        successCount++
      } catch (error: any) {
        console.error(`Retry failed for ${delivery.subscriber.email}:`, error.message)

        await db.updateDelivery.update({
          where: { id: delivery.id },
          data: {
            error: `Retry failed: ${error.message?.substring(0, 500) || 'Unknown error'}`,
          },
        })
      }
    }

    return c.json({
      success: true,
      retriedCount,
      successCount,
      failedCount: retriedCount - successCount,
    })
  }
)

// Track email open (tracking pixel)
// GET /updates/track/:deliveryId
// Returns a 1x1 transparent GIF and records the open
updates.get(
  '/track/:deliveryId',
  zValidator('param', z.object({ deliveryId: z.string().uuid() })),
  async (c) => {
    const { deliveryId } = c.req.valid('param')

    // 1x1 transparent GIF
    const TRANSPARENT_GIF = Buffer.from(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      'base64'
    )

    try {
      // Find the delivery record
      const delivery = await db.updateDelivery.findUnique({
        where: { id: deliveryId },
        select: { id: true, openedAt: true, updateId: true },
      })

      if (delivery && !delivery.openedAt) {
        // Update delivery record with opened timestamp
        await db.updateDelivery.update({
          where: { id: deliveryId },
          data: {
            status: 'opened',
            openedAt: new Date(),
          },
        })

        // Increment viewCount on the Update
        await db.update.update({
          where: { id: delivery.updateId },
          data: {
            viewCount: { increment: 1 },
          },
        })
      }
    } catch (err) {
      // Silently ignore errors - don't break email display
      console.error('[updates] Track pixel error:', err)
    }

    // Always return the GIF regardless of tracking success
    return new Response(TRANSPARENT_GIF, {
      status: 200,
      headers: {
        'Content-Type': 'image/gif',
        'Content-Length': String(TRANSPARENT_GIF.length),
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    })
  }
)

export default updates
