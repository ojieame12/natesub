import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createHash, randomBytes } from 'crypto'
import { Prisma } from '@prisma/client'
import { db } from '../db/client.js'
import { redis } from '../db/redis.js'
import { requireAuth } from '../middleware/auth.js'
import { sendRequestEmail } from '../services/email.js'
import { createCheckoutSession } from '../services/stripe.js'
import { env } from '../config/env.js'

const requests = new Hono()

// Hash token for storage
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// Generate secure token
function generateToken(): string {
  return randomBytes(24).toString('base64url')
}

// Rate limit key
function getRateLimitKey(creatorId: string, recipientEmail: string): string {
  return `request_rate:${creatorId}:${recipientEmail}`
}

// ============================================
// PUBLIC ROUTES (for recipients)
// IMPORTANT: These must be defined BEFORE /:id routes
// to prevent '/r/:token' from being caught by '/:id'
// ============================================

// View request (public)
requests.get(
  '/r/:token',
  zValidator('param', z.object({ token: z.string() })),
  async (c) => {
    const { token } = c.req.valid('param')
    const tokenHash = hashToken(token)

    const request = await db.request.findUnique({
      where: { publicTokenHash: tokenHash },
      include: {
        creator: {
          include: {
            profile: {
              select: {
                displayName: true,
                avatarUrl: true,
                username: true,
              },
            },
          },
        },
      },
    })

    if (!request) {
      return c.json({ error: 'Request not found' }, 404)
    }

    if (request.tokenExpiresAt && request.tokenExpiresAt < new Date()) {
      return c.json({ error: 'This request has expired' }, 410)
    }

    if (request.status === 'accepted' || request.status === 'declined') {
      return c.json({ error: 'This request has already been responded to' }, 410)
    }

    return c.json({
      request: {
        id: request.id,
        creator: {
          displayName: request.creator.profile?.displayName,
          avatarUrl: request.creator.profile?.avatarUrl,
          username: request.creator.profile?.username,
        },
        recipientName: request.recipientName,
        amount: request.amountCents / 100,
        currency: request.currency,
        isRecurring: request.isRecurring,
        message: request.message,
        voiceUrl: request.voiceUrl,
        customPerks: request.customPerks,
        relationship: request.relationship,
      },
    })
  }
)

// Accept request (creates checkout)
requests.post(
  '/r/:token/accept',
  zValidator('param', z.object({ token: z.string() })),
  zValidator('json', z.object({
    email: z.string().email(),
  })),
  async (c) => {
    const { token } = c.req.valid('param')
    const { email } = c.req.valid('json')
    const tokenHash = hashToken(token)

    const request = await db.request.findUnique({
      where: { publicTokenHash: tokenHash },
      include: {
        creator: {
          include: { profile: true },
        },
      },
    })

    if (!request) {
      return c.json({ error: 'Request not found' }, 404)
    }

    if (request.tokenExpiresAt && request.tokenExpiresAt < new Date()) {
      return c.json({ error: 'This request has expired' }, 410)
    }

    // Allow 'sent' or 'pending_payment' (retry after abandoned checkout)
    if (request.status !== 'sent' && request.status !== 'pending_payment') {
      return c.json({ error: 'This request has already been responded to' }, 410)
    }

    if (!request.creator.profile?.stripeAccountId) {
      return c.json({ error: 'Creator has not set up payments' }, 400)
    }

    try {
      // Create checkout session with request tracking
      const session = await createCheckoutSession({
        creatorId: request.creatorId,
        requestId: request.id,  // Track which request this checkout is for
        amount: request.amountCents,
        currency: request.currency,
        interval: request.isRecurring ? 'month' : 'one_time',
        successUrl: `${env.APP_URL}/r/${token}/success`,
        cancelUrl: `${env.APP_URL}/r/${token}?canceled=true`,
        subscriberEmail: email,
      })

      // Update request to pending_payment status
      // Status will be set to 'accepted' by webhook when payment succeeds
      await db.request.update({
        where: { id: request.id },
        data: {
          status: 'pending_payment',
          stripeCheckoutSessionId: session.id,
          // Don't set respondedAt yet - that happens on actual acceptance
        },
      })

      // NOTE: Activity is NOT logged here - it will be logged by the webhook
      // when checkout.session.completed fires, to avoid false accepts

      return c.json({
        success: true,
        checkoutUrl: session.url,
      })
    } catch (error) {
      console.error('Accept request error:', error)
      return c.json({ error: 'Failed to create checkout' }, 500)
    }
  }
)

// Decline request
requests.post(
  '/r/:token/decline',
  zValidator('param', z.object({ token: z.string() })),
  async (c) => {
    const { token } = c.req.valid('param')
    const tokenHash = hashToken(token)

    const request = await db.request.findUnique({
      where: { publicTokenHash: tokenHash },
    })

    if (!request) {
      return c.json({ error: 'Request not found' }, 404)
    }

    if (request.status !== 'sent') {
      return c.json({ error: 'This request has already been responded to' }, 410)
    }

    await db.request.update({
      where: { id: request.id },
      data: {
        status: 'declined',
        respondedAt: new Date(),
      },
    })

    // Create activity
    await db.activity.create({
      data: {
        userId: request.creatorId,
        type: 'request_declined',
        payload: {
          requestId: request.id,
          recipientName: request.recipientName,
        },
      },
    })

    return c.json({ success: true })
  }
)

// ============================================
// AUTHENTICATED ROUTES
// ============================================

// Create request (draft)
requests.post(
  '/',
  requireAuth,
  zValidator('json', z.object({
    recipientName: z.string().min(1).max(100),
    recipientEmail: z.string().email().optional(),
    recipientPhone: z.string().optional(),
    relationship: z.enum(['family', 'friend', 'client', 'fan', 'colleague', 'partner', 'other']),
    amountCents: z.number().int().positive().max(10000000), // Max $100k
    currency: z.string().length(3).default('USD'),
    isRecurring: z.boolean().default(false),
    message: z.string().max(1000).optional(),
    voiceUrl: z.string().url().optional(),
    customPerks: z.array(z.string()).optional(),
  })),
  async (c) => {
    const userId = c.get('userId')
    const data = c.req.valid('json')

    // Must have email or phone
    if (!data.recipientEmail && !data.recipientPhone) {
      return c.json({ error: 'Recipient email or phone is required' }, 400)
    }

    const request = await db.request.create({
      data: {
        creatorId: userId,
        recipientName: data.recipientName,
        recipientEmail: data.recipientEmail || null,
        recipientPhone: data.recipientPhone || null,
        relationship: data.relationship,
        amountCents: data.amountCents,
        currency: data.currency.toUpperCase(),
        isRecurring: data.isRecurring,
        message: data.message || null,
        voiceUrl: data.voiceUrl || null,
        customPerks: data.customPerks || Prisma.JsonNull,
        status: 'draft',
      },
    })

    return c.json({ request })
  }
)

// Get my requests
// Supports cursor-based pagination with ?cursor=<id>&limit=<n>&status=<status>
requests.get(
  '/',
  requireAuth,
  zValidator('query', z.object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['all', 'draft', 'sent', 'pending_payment', 'accepted', 'declined', 'expired']).default('all'),
  })),
  async (c) => {
    const userId = c.get('userId')
    const { cursor, limit, status } = c.req.valid('query')

    const reqs = await db.request.findMany({
      where: {
        creatorId: userId,
        ...(status !== 'all' && { status }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1,
      }),
    })

    // Check if there's a next page
    const hasMore = reqs.length > limit
    const items = hasMore ? reqs.slice(0, limit) : reqs
    const nextCursor = hasMore ? items[items.length - 1].id : null

    return c.json({
      requests: items.map(r => ({
        id: r.id,
        recipientName: r.recipientName,
        recipientEmail: r.recipientEmail,
        relationship: r.relationship,
        amount: r.amountCents / 100,
        currency: r.currency,
        isRecurring: r.isRecurring,
        status: r.status,
        sendMethod: r.sendMethod,
        sentAt: r.sentAt,
        respondedAt: r.respondedAt,
        createdAt: r.createdAt,
      })),
      nextCursor,
      hasMore,
    })
  }
)

// Get single request
requests.get(
  '/:id',
  requireAuth,
  zValidator('param', z.object({ id: z.string().uuid() })),
  async (c) => {
    const userId = c.get('userId')
    const { id } = c.req.valid('param')

    const request = await db.request.findFirst({
      where: { id, creatorId: userId },
    })

    if (!request) {
      return c.json({ error: 'Request not found' }, 404)
    }

    return c.json({ request })
  }
)

// Send request
requests.post(
  '/:id/send',
  requireAuth,
  zValidator('param', z.object({ id: z.string().uuid() })),
  zValidator('json', z.object({
    method: z.enum(['email', 'link']),
  })),
  async (c) => {
    const userId = c.get('userId')
    const { id } = c.req.valid('param')
    const { method } = c.req.valid('json')

    const request = await db.request.findFirst({
      where: { id, creatorId: userId },
    })

    if (!request) {
      return c.json({ error: 'Request not found' }, 404)
    }

    if (request.status !== 'draft') {
      return c.json({ error: 'Request has already been sent' }, 400)
    }

    // Rate limit: max 3 requests per recipient per day
    if (request.recipientEmail) {
      const rateLimitKey = getRateLimitKey(userId, request.recipientEmail)
      const count = await redis.incr(rateLimitKey)
      if (count === 1) {
        await redis.expire(rateLimitKey, 86400) // 24 hours
      }
      if (count > 3) {
        return c.json({ error: 'Too many requests to this recipient. Try again tomorrow.' }, 429)
      }
    }

    // Generate public token
    const token = generateToken()
    const tokenHash = hashToken(token)
    const tokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

    // Update request
    await db.request.update({
      where: { id },
      data: {
        status: 'sent',
        sendMethod: method,
        publicTokenHash: tokenHash,
        tokenExpiresAt,
        sentAt: new Date(),
      },
    })

    // Get creator profile for name
    const profile = await db.profile.findUnique({ where: { userId } })
    const creatorName = profile?.displayName || 'Someone'

    // Build request link
    const requestLink = `${env.APP_URL}/r/${token}`

    // Send email if method is email
    if (method === 'email' && request.recipientEmail) {
      await sendRequestEmail(
        request.recipientEmail,
        creatorName,
        request.message,
        requestLink
      )
    }

    // Create activity
    await db.activity.create({
      data: {
        userId,
        type: 'request_sent',
        payload: {
          requestId: id,
          recipientName: request.recipientName,
          amount: request.amountCents,
          method,
        },
      },
    })

    return c.json({
      success: true,
      requestLink,
      method,
    })
  }
)

export default requests
