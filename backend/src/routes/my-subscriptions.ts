// My Subscriptions Routes - Subscriber-facing subscription management
// These routes let users view and manage subscriptions THEY have to service providers

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { SubscriptionStatus } from '@prisma/client'
import { db } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { createSubscriberPortalSession, cancelSubscription, reactivateSubscription } from '../services/stripe.js'
import { env } from '../config/env.js'

const mySubscriptions = new Hono()

// Get subscriptions I have (things I'm subscribed to)
// Supports cursor-based pagination with ?cursor=<id>&limit=<n>
mySubscriptions.get(
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
        subscriberId: userId, // Key difference: subscriptions I HAVE, not subscriptions TO me
        ...(statusFilter && { status: statusFilter }),
      },
      include: {
        creator: {
          select: {
            id: true,
            email: true,
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
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor && {
        cursor: { id: cursor },
        skip: 1,
      }),
    })

    // Check if there's a next page
    const hasMore = subs.length > limit
    const items = hasMore ? subs.slice(0, limit) : subs
    const nextCursor = hasMore ? items[items.length - 1].id : null

    return c.json({
      subscriptions: items.map(s => ({
        id: s.id,
        provider: {
          id: s.creator.id,
          displayName: s.creator.profile?.displayName || s.creator.email,
          avatarUrl: s.creator.profile?.avatarUrl,
          username: s.creator.profile?.username,
        },
        tierName: s.tierName,
        amount: s.amount / 100, // Convert from cents
        currency: s.currency,
        interval: s.interval,
        status: s.status,
        startedAt: s.startedAt,
        currentPeriodEnd: s.currentPeriodEnd,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        // Include whether this subscription has Stripe (for portal access)
        hasStripe: !!s.stripeSubscriptionId,
      })),
      nextCursor,
      hasMore,
    })
  }
)

// Get single subscription detail
mySubscriptions.get(
  '/:id',
  requireAuth,
  zValidator('param', z.object({ id: z.string().uuid() })),
  async (c) => {
    const userId = c.get('userId')
    const { id } = c.req.valid('param')

    const subscription = await db.subscription.findFirst({
      where: {
        id,
        subscriberId: userId, // Must be my subscription
      },
      include: {
        creator: {
          select: {
            id: true,
            email: true,
            profile: {
              select: {
                displayName: true,
                avatarUrl: true,
                username: true,
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
        provider: {
          id: subscription.creator.id,
          displayName: subscription.creator.profile?.displayName || subscription.creator.email,
          avatarUrl: subscription.creator.profile?.avatarUrl,
          username: subscription.creator.profile?.username,
        },
        tierName: subscription.tierName,
        amount: subscription.amount / 100,
        currency: subscription.currency,
        interval: subscription.interval,
        status: subscription.status,
        startedAt: subscription.startedAt,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        hasStripe: !!subscription.stripeSubscriptionId,
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

// Get customer portal URL for self-service management
// This lets subscribers update payment methods, view invoices, and cancel
mySubscriptions.post(
  '/:id/portal',
  requireAuth,
  zValidator('param', z.object({ id: z.string().uuid() })),
  async (c) => {
    const userId = c.get('userId')
    const { id } = c.req.valid('param')

    const subscription = await db.subscription.findFirst({
      where: {
        id,
        subscriberId: userId,
      },
      include: {
        creator: {
          select: {
            profile: { select: { username: true } },
          },
        },
      },
    })

    if (!subscription) {
      return c.json({ error: 'Subscription not found' }, 404)
    }

    // Portal is only available for Stripe subscriptions
    if (!subscription.stripeCustomerId) {
      return c.json({ error: 'Self-service portal is not available for this subscription' }, 400)
    }

    try {
      const returnUrl = subscription.creator.profile?.username
        ? `${env.APP_URL}/${subscription.creator.profile.username}`
        : `${env.APP_URL}/subscriptions`

      const { url } = await createSubscriberPortalSession(
        subscription.stripeCustomerId,
        returnUrl
      )

      return c.json({ url })
    } catch (err: any) {
      console.error(`[my-subscriptions] Failed to create portal session:`, err)
      return c.json({ error: 'Failed to create portal session' }, 500)
    }
  }
)

// Cancel my subscription
// Subscribers can cancel subscriptions they have
mySubscriptions.post(
  '/:id/cancel',
  requireAuth,
  zValidator('param', z.object({ id: z.string().uuid() })),
  zValidator('json', z.object({
    immediate: z.boolean().default(false),
  }).optional()),
  async (c) => {
    const userId = c.get('userId')
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const immediate = body?.immediate || false

    const subscription = await db.subscription.findFirst({
      where: {
        id,
        subscriberId: userId,
      },
    })

    if (!subscription) {
      return c.json({ error: 'Subscription not found' }, 404)
    }

    if (subscription.status === 'canceled') {
      return c.json({ error: 'Subscription is already canceled' }, 400)
    }

    // Cancel in Stripe if it's a Stripe subscription
    if (subscription.stripeSubscriptionId) {
      try {
        const result = await cancelSubscription(subscription.stripeSubscriptionId, !immediate)

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
        console.error(`[my-subscriptions] Failed to cancel Stripe subscription:`, err)
        return c.json({ error: 'Failed to cancel subscription' }, 500)
      }
    }

    // For non-Stripe subscriptions (Paystack), update local status
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

// Reactivate my subscription (undo cancel at period end)
mySubscriptions.post(
  '/:id/reactivate',
  requireAuth,
  zValidator('param', z.object({ id: z.string().uuid() })),
  async (c) => {
    const userId = c.get('userId')
    const { id } = c.req.valid('param')

    const subscription = await db.subscription.findFirst({
      where: {
        id,
        subscriberId: userId,
      },
    })

    if (!subscription) {
      return c.json({ error: 'Subscription not found' }, 404)
    }

    if (!subscription.cancelAtPeriodEnd) {
      return c.json({ error: 'Subscription is not set to cancel' }, 400)
    }

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
        console.error(`[my-subscriptions] Failed to reactivate Stripe subscription:`, err)
        return c.json({ error: 'Failed to reactivate subscription' }, 500)
      }
    }

    // For non-Stripe subscriptions, update local status
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

export default mySubscriptions
