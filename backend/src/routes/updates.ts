import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { sendUpdateEmail } from '../services/email.js'

const updates = new Hono()

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

// Get single update
updates.get(
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

    return c.json({ update })
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
updates.post(
  '/:id/send',
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
      return c.json({ error: 'Update has already been sent' }, 400)
    }

    // Get creator profile
    const profile = await db.profile.findUnique({ where: { userId } })
    if (!profile) {
      return c.json({ error: 'Profile not found' }, 400)
    }

    // Get subscribers based on audience
    let subscriberFilter: any = {
      creatorId: userId,
      status: 'active',
    }

    // Filter by tier if audience is a specific tier
    if (update.audience !== 'all') {
      if (update.audience === 'supporters') {
        // Supporters = any tier except lowest
        // For simplicity, include all for now
      } else if (update.audience === 'vip') {
        // VIP = highest tier only
        if (profile.tiers) {
          const tiers = profile.tiers as any[]
          const sortedTiers = [...tiers].sort((a, b) => b.amount - a.amount)
          if (sortedTiers[0]) {
            subscriberFilter.tierId = sortedTiers[0].id
          }
        }
      } else {
        // Specific tier ID
        subscriberFilter.tierId = update.audience
      }
    }

    const subscriptions = await db.subscription.findMany({
      where: subscriberFilter,
      include: {
        subscriber: {
          select: { email: true },
        },
      },
    })

    // Send emails to all subscribers
    const recipientCount = subscriptions.length
    const creatorName = profile.displayName

    // Send emails (in production, this should be queued)
    for (const sub of subscriptions) {
      try {
        await sendUpdateEmail(
          sub.subscriber.email,
          creatorName,
          update.title,
          update.body
        )
      } catch (error) {
        console.error(`Failed to send update email to ${sub.subscriber.email}:`, error)
      }
    }

    // Update status
    await db.update.update({
      where: { id },
      data: {
        status: 'sent',
        sentAt: new Date(),
        recipientCount,
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
          recipientCount,
          audience: update.audience,
        },
      },
    })

    return c.json({
      success: true,
      recipientCount,
    })
  }
)

export default updates
