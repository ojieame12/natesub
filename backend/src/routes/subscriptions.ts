import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { SubscriptionStatus } from '@prisma/client'
import { db } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'

const subscriptions = new Hono()

// Get my subscribers (people subscribed to me)
// Supports cursor-based pagination with ?cursor=<id>&limit=<n>
subscriptions.get(
  '/',
  requireAuth,
  zValidator('query', z.object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(['all', 'active', 'canceled', 'past_due']).default('active'),
  })),
  async (c) => {
    const userId = c.get('userId')
    const { cursor, limit, status } = c.req.valid('query')

    // Build status filter
    const activeStatuses: SubscriptionStatus[] = ['active', 'past_due']
    const statusFilter = status === 'all'
      ? undefined
      : status === 'active'
        ? { in: activeStatuses }
        : { equals: status as SubscriptionStatus }

    const subs = await db.subscription.findMany({
      where: {
        creatorId: userId,
        ...(statusFilter && { status: statusFilter }),
      },
      include: {
        subscriber: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1, // Fetch one extra to check if there's more
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1, // Skip the cursor item
      }),
    })

    // Check if there's a next page
    const hasMore = subs.length > limit
    const items = hasMore ? subs.slice(0, limit) : subs
    const nextCursor = hasMore ? items[items.length - 1].id : null

    return c.json({
      subscriptions: items.map(s => ({
        id: s.id,
        subscriber: {
          id: s.subscriber.id,
          email: s.subscriber.email,
          displayName: s.subscriber.profile?.displayName || s.subscriber.email,
          avatarUrl: s.subscriber.profile?.avatarUrl,
        },
        tierName: s.tierName,
        amount: s.amount / 100, // Convert from cents
        currency: s.currency,
        interval: s.interval,
        status: s.status,
        startedAt: s.startedAt,
        currentPeriodEnd: s.currentPeriodEnd,
        ltvCents: s.ltvCents,
      })),
      nextCursor,
      hasMore,
    })
  }
)

// Get subscriber detail
subscriptions.get(
  '/:id',
  requireAuth,
  zValidator('param', z.object({ id: z.string().uuid() })),
  async (c) => {
    const userId = c.get('userId')
    const { id } = c.req.valid('param')

    const subscription = await db.subscription.findFirst({
      where: {
        id,
        creatorId: userId,
      },
      include: {
        subscriber: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    })

    if (!subscription) {
      return c.json({ error: 'Subscription not found' }, 404)
    }

    return c.json({
      subscription: {
        id: subscription.id,
        subscriber: {
          id: subscription.subscriber.id,
          email: subscription.subscriber.email,
          displayName: subscription.subscriber.profile?.displayName || subscription.subscriber.email,
          avatarUrl: subscription.subscriber.profile?.avatarUrl,
        },
        tierName: subscription.tierName,
        amount: subscription.amount / 100,
        currency: subscription.currency,
        interval: subscription.interval,
        status: subscription.status,
        startedAt: subscription.startedAt,
        currentPeriodEnd: subscription.currentPeriodEnd,
        ltvCents: subscription.ltvCents,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        payments: subscription.payments.map(p => ({
          id: p.id,
          amount: p.amountCents / 100,
          currency: p.currency,
          status: p.status,
          occurredAt: p.occurredAt,
        })),
      },
    })
  }
)

export default subscriptions
