import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { SubscriptionStatus } from '@prisma/client'
import { db } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { cancelSubscription as cancelStripeSubscription, reactivateSubscription } from '../services/stripe.js'
import { centsToDisplayAmount } from '../utils/currency.js'

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
        amount: centsToDisplayAmount(s.amount, s.currency),
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
        amount: centsToDisplayAmount(subscription.amount, subscription.currency),
        currency: subscription.currency,
        interval: subscription.interval,
        status: subscription.status,
        startedAt: subscription.startedAt,
        currentPeriodEnd: subscription.currentPeriodEnd,
        ltvCents: subscription.ltvCents,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        payments: subscription.payments.map(p => ({
          id: p.id,
          amount: centsToDisplayAmount(p.amountCents, p.currency),
          currency: p.currency,
          status: p.status,
          occurredAt: p.occurredAt,
        })),
      },
    })
  }
)

// Cancel subscription (service provider cancels a subscriber)
// POST instead of DELETE to allow body with options
subscriptions.post(
  '/:id/cancel',
  requireAuth,
  zValidator('param', z.object({ id: z.string().uuid() })),
  zValidator('json', z.object({
    immediate: z.boolean().default(false), // If true, cancel immediately; otherwise at period end
  }).optional()),
  async (c) => {
    const userId = c.get('userId')
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const immediate = body?.immediate || false

    // Find subscription - service provider can cancel their subscribers
    const subscription = await db.subscription.findFirst({
      where: {
        id,
        creatorId: userId,
      },
    })

    if (!subscription) {
      return c.json({ error: 'Subscription not found' }, 404)
    }

    // Can't cancel already canceled subscriptions
    if (subscription.status === 'canceled') {
      return c.json({ error: 'Subscription is already canceled' }, 400)
    }

    // Cancel in Stripe if it's a Stripe subscription
    if (subscription.stripeSubscriptionId) {
      try {
        const result = await cancelStripeSubscription(subscription.stripeSubscriptionId, !immediate)

        // Update local subscription based on Stripe result
        await db.subscription.update({
          where: { id },
          data: {
            status: result.status === 'canceled' ? 'canceled' : subscription.status,
            cancelAtPeriodEnd: result.cancelAtPeriodEnd,
            canceledAt: result.canceledAt,
          },
        })

        return c.json({
          success: true,
          subscription: {
            id: subscription.id,
            status: result.status,
            cancelAtPeriodEnd: result.cancelAtPeriodEnd,
            canceledAt: result.canceledAt?.toISOString() || null,
          },
        })
      } catch (err: any) {
        console.error(`[subscriptions] Failed to cancel Stripe subscription:`, err)
        return c.json({ error: 'Failed to cancel subscription' }, 500)
      }
    }

    // For Paystack subscriptions (recurring via authorization code), just update local status
    // The recurring charge job will check status before attempting to charge
    await db.subscription.update({
      where: { id },
      data: {
        status: immediate ? 'canceled' : subscription.status,
        cancelAtPeriodEnd: !immediate,
        canceledAt: immediate ? new Date() : null,
      },
    })

    return c.json({
      success: true,
      subscription: {
        id: subscription.id,
        status: immediate ? 'canceled' : subscription.status,
        cancelAtPeriodEnd: !immediate,
        canceledAt: immediate ? new Date().toISOString() : null,
      },
    })
  }
)

// Reactivate subscription (undo cancel at period end)
subscriptions.post(
  '/:id/reactivate',
  requireAuth,
  zValidator('param', z.object({ id: z.string().uuid() })),
  async (c) => {
    const userId = c.get('userId')
    const { id } = c.req.valid('param')

    // Find subscription - service provider can reactivate their subscribers
    const subscription = await db.subscription.findFirst({
      where: {
        id,
        creatorId: userId,
      },
    })

    if (!subscription) {
      return c.json({ error: 'Subscription not found' }, 404)
    }

    // Can only reactivate subscriptions set to cancel at period end
    if (!subscription.cancelAtPeriodEnd) {
      return c.json({ error: 'Subscription is not set to cancel' }, 400)
    }

    // Already fully canceled subscriptions cannot be reactivated
    if (subscription.status === 'canceled') {
      return c.json({ error: 'Cannot reactivate a canceled subscription' }, 400)
    }

    // Reactivate in Stripe if it's a Stripe subscription
    if (subscription.stripeSubscriptionId) {
      try {
        const result = await reactivateSubscription(subscription.stripeSubscriptionId)

        await db.subscription.update({
          where: { id },
          data: {
            cancelAtPeriodEnd: false,
            canceledAt: null,
          },
        })

        return c.json({
          success: true,
          subscription: {
            id: subscription.id,
            status: result.status,
            cancelAtPeriodEnd: false,
          },
        })
      } catch (err: any) {
        console.error(`[subscriptions] Failed to reactivate Stripe subscription:`, err)
        return c.json({ error: 'Failed to reactivate subscription' }, 500)
      }
    }

    // For Paystack subscriptions, just update local status
    await db.subscription.update({
      where: { id },
      data: {
        cancelAtPeriodEnd: false,
        canceledAt: null,
      },
    })

    return c.json({
      success: true,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        cancelAtPeriodEnd: false,
      },
    })
  }
)

export default subscriptions
