// My Subscriptions Routes - Subscriber-facing subscription management
// These routes let users view and manage subscriptions THEY have to service providers

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { SubscriptionStatus } from '@prisma/client'
import { db } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { publicRateLimit } from '../middleware/rateLimit.js'
import { createSubscriberPortalSession, cancelSubscription, reactivateSubscription } from '../services/stripe.js'
import { sendCancellationConfirmationEmail } from '../services/email.js'
import { logSubscriptionEvent } from '../services/systemLog.js'
import { env } from '../config/env.js'
import { centsToDisplayAmount } from '../utils/currency.js'
import { validateCancelToken, validatePortalToken, validateExpressDashboardToken } from '../utils/cancelToken.js'
import { createExpressDashboardLink } from '../services/stripe.js'

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
      subscriptions: items.map(s => {
        const isPastDue = s.status === 'past_due'
        const provider = s.stripeSubscriptionId ? 'stripe' : 'paystack'
        const canUpdatePayment = provider === 'stripe' && !!s.stripeCustomerId

        return {
          id: s.id,
          provider: {
            id: s.creator.id,
            displayName: s.creator.profile?.displayName || s.creator.email,
            avatarUrl: s.creator.profile?.avatarUrl,
            username: s.creator.profile?.username,
          },
          tierName: s.tierName,
          amount: centsToDisplayAmount(s.amount, s.currency),
          currency: s.currency,
          interval: s.interval,
          status: s.status,
          startedAt: s.startedAt,
          currentPeriodEnd: s.currentPeriodEnd,
          cancelAtPeriodEnd: s.cancelAtPeriodEnd,
          // Rich fields for UI parity with public flow
          hasStripe: !!s.stripeSubscriptionId,
          isPastDue,
          pastDueMessage: isPastDue
            ? 'Your last payment failed. Please update your payment method to continue.'
            : null,
          updatePaymentMethod: canUpdatePayment ? 'portal' : provider === 'paystack' ? 'resubscribe' : 'none',
          paymentProvider: provider,
        }
      }),
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
          select: {
            id: true,
            grossCents: true,
            amountCents: true,
            subscriberFeeCents: true,
            currency: true,
            status: true,
            occurredAt: true,
          },
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
        amount: centsToDisplayAmount(subscription.amount, subscription.currency),
        currency: subscription.currency,
        interval: subscription.interval,
        status: subscription.status,
        startedAt: subscription.startedAt,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        hasStripe: !!subscription.stripeSubscriptionId,
        payments: subscription.payments.map(p => ({
          id: p.id,
          // Show subscriber what they actually paid (gross amount)
          amount: centsToDisplayAmount(
            p.grossCents ?? (p.amountCents + (p.subscriberFeeCents ?? 0)),
            p.currency
          ),
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
        : `${env.APP_URL}/my-subscriptions`

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

// Cancel reason enum - for analytics parity with public/OTP portals
const CancelReasonSchema = z.enum([
  'too_expensive',
  'not_enough_value',
  'taking_break',
  'found_alternative',
  'technical_issues',
  'other',
])

// Cancel my subscription
// Subscribers can cancel subscriptions they have
mySubscriptions.post(
  '/:id/cancel',
  requireAuth,
  zValidator('param', z.object({ id: z.string().uuid() })),
  zValidator('json', z.object({
    immediate: z.boolean().default(false),
    reason: CancelReasonSchema.optional(),
    comment: z.string().max(500).optional(),
  }).optional()),
  async (c) => {
    const userId = c.get('userId')
    const { id } = c.req.valid('param')
    const body = c.req.valid('json')
    const immediate = body?.immediate || false
    const reason = body?.reason
    const comment = body?.comment?.replace(/[<>]/g, '').trim() || null

    const subscription = await db.subscription.findFirst({
      where: {
        id,
        subscriberId: userId,
      },
      include: {
        subscriber: {
          select: { email: true },
        },
        creator: {
          select: {
            profile: {
              select: { displayName: true, username: true },
            },
          },
        },
      },
    })

    if (!subscription) {
      return c.json({ error: 'Subscription not found' }, 404)
    }

    if (subscription.status === 'canceled') {
      return c.json({ error: 'Subscription is already canceled' }, 400)
    }

    // Helper to send confirmation email after successful cancel
    const sendConfirmation = async () => {
      if (subscription.subscriber?.email && subscription.creator.profile?.displayName) {
        const accessUntil = subscription.currentPeriodEnd || new Date()
        const resubscribeUrl = subscription.creator.profile.username
          ? `${env.PUBLIC_PAGE_URL}/${subscription.creator.profile.username}`
          : env.PUBLIC_PAGE_URL

        sendCancellationConfirmationEmail(
          subscription.subscriber.email,
          subscription.subscriber.email.split('@')[0], // Use email prefix as name
          subscription.creator.profile.displayName,
          accessUntil,
          resubscribeUrl
        ).catch((err) => console.error('[my-subscriptions] Failed to send cancel confirmation:', err))
      }
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

        // Record cancel feedback for analytics (if provided)
        if (reason) {
          await db.activity.create({
            data: {
              userId: subscription.creatorId,
              type: 'subscription_cancel_feedback',
              payload: {
                subscriptionId: subscription.id,
                subscriberId: userId,
                reason,
                comment,
                source: 'in_app',
              },
            },
          })
        }

        // Log cancellation event for audit trail
        await logSubscriptionEvent({
          event: 'cancel',
          subscriptionId: subscription.id,
          subscriberId: userId,
          creatorId: subscription.creatorId,
          provider: 'stripe',
          source: 'in_app',
          reason,
        })

        // Send confirmation email (non-blocking)
        await sendConfirmation()

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

    // Record cancel feedback for analytics (if provided)
    if (reason) {
      await db.activity.create({
        data: {
          userId: subscription.creatorId,
          type: 'subscription_cancel_feedback',
          payload: {
            subscriptionId: subscription.id,
            subscriberId: userId,
            reason,
            comment,
            source: 'in_app',
          },
        },
      })
    }

    // Log cancellation event for audit trail
    await logSubscriptionEvent({
      event: 'cancel',
      subscriptionId: subscription.id,
      subscriberId: userId,
      creatorId: subscription.creatorId,
      provider: 'paystack',
      source: 'in_app',
      reason,
    })

    // Send confirmation email (non-blocking)
    await sendConfirmation()

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

        // Log reactivation event for audit trail
        await logSubscriptionEvent({
          event: 'reactivate',
          subscriptionId: subscription.id,
          subscriberId: userId,
          creatorId: subscription.creatorId,
          provider: 'stripe',
          source: 'in_app',
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

    // Log reactivation event for audit trail
    await logSubscriptionEvent({
      event: 'reactivate',
      subscriptionId: subscription.id,
      subscriberId: userId,
      creatorId: subscription.creatorId,
      provider: 'paystack',
      source: 'in_app',
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

// ============================================
// PUBLIC CANCEL ENDPOINT (No Auth Required)
// ============================================
// Visa-compliant 1-click cancellation via signed token
// Used in pre-billing reminder emails

// GET /unsubscribe/:token - Display cancel confirmation page info
mySubscriptions.get(
  '/unsubscribe/:token',
  publicRateLimit,
  async (c) => {
    const { token } = c.req.param()

    const decoded = validateCancelToken(token)
    if (!decoded) {
      return c.json({
        error: 'Invalid or expired cancellation link',
        code: 'INVALID_TOKEN',
      }, 400)
    }

    // Find the subscription
    const subscription = await db.subscription.findUnique({
      where: { id: decoded.subscriptionId },
      include: {
        creator: {
          select: {
            profile: {
              select: {
                displayName: true,
                username: true,
              },
            },
          },
        },
      },
    })

    if (!subscription) {
      return c.json({
        error: 'Subscription not found',
        code: 'NOT_FOUND',
      }, 404)
    }

    // Return subscription info for confirmation page
    return c.json({
      subscription: {
        id: subscription.id,
        providerName: subscription.creator.profile?.displayName || 'Unknown',
        providerUsername: subscription.creator.profile?.username,
        amount: centsToDisplayAmount(subscription.amount, subscription.currency),
        currency: subscription.currency,
        interval: subscription.interval,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        alreadyCanceled: subscription.status === 'canceled' || subscription.cancelAtPeriodEnd,
      },
    })
  }
)

// POST /unsubscribe/:token - Execute the cancellation
mySubscriptions.post(
  '/unsubscribe/:token',
  publicRateLimit,
  async (c) => {
    const { token } = c.req.param()

    const decoded = validateCancelToken(token)
    if (!decoded) {
      return c.json({
        error: 'Invalid or expired cancellation link',
        code: 'INVALID_TOKEN',
      }, 400)
    }

    // Find the subscription with subscriber info for confirmation email
    const subscription = await db.subscription.findUnique({
      where: { id: decoded.subscriptionId },
      include: {
        subscriber: {
          select: { email: true },
        },
        creator: {
          select: {
            profile: {
              select: {
                displayName: true,
                username: true,
              },
            },
          },
        },
      },
    })

    if (!subscription) {
      return c.json({
        error: 'Subscription not found',
        code: 'NOT_FOUND',
      }, 404)
    }

    // Already canceled?
    if (subscription.status === 'canceled') {
      return c.json({
        success: true,
        alreadyCanceled: true,
        message: 'This subscription was already canceled.',
        subscription: {
          id: subscription.id,
          status: 'canceled',
          canceledAt: subscription.canceledAt?.toISOString() || null,
        },
      })
    }

    // Already set to cancel at period end?
    if (subscription.cancelAtPeriodEnd) {
      return c.json({
        success: true,
        alreadyCanceled: true,
        message: `Your subscription will end on ${subscription.currentPeriodEnd?.toLocaleDateString() || 'the end of the billing period'}.`,
        subscription: {
          id: subscription.id,
          status: subscription.status,
          cancelAtPeriodEnd: true,
          currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() || null,
        },
      })
    }

    try {
      // Cancel at period end (not immediate) - Visa-compliant
      // Subscriber keeps access until current period ends
      if (subscription.stripeSubscriptionId) {
        const result = await cancelSubscription(subscription.stripeSubscriptionId, true)

        await db.subscription.update({
          where: { id: subscription.id },
          data: {
            status: result.status === 'canceled' ? 'canceled' : subscription.status,
            cancelAtPeriodEnd: result.cancelAtPeriodEnd,
            canceledAt: result.canceledAt,
          },
        })

        // Log the cancellation source
        await db.activity.create({
          data: {
            userId: subscription.creatorId,
            type: 'subscription_canceled_via_email',
            payload: {
              subscriptionId: subscription.id,
              subscriberId: subscription.subscriberId,
              source: 'email_link',
              cancelAtPeriodEnd: true,
            },
          },
        })

        // Send cancellation confirmation email (non-blocking)
        if (subscription.subscriber?.email && subscription.creator.profile?.displayName) {
          const accessUntil = subscription.currentPeriodEnd || new Date()
          const resubscribeUrl = subscription.creator.profile.username
            ? `${env.PUBLIC_PAGE_URL}/${subscription.creator.profile.username}`
            : env.PUBLIC_PAGE_URL

          sendCancellationConfirmationEmail(
            subscription.subscriber.email,
            subscription.subscriber.email.split('@')[0],
            subscription.creator.profile.displayName,
            accessUntil,
            resubscribeUrl
          ).catch((err) => console.error('[my-subscriptions] Failed to send cancel confirmation:', err))
        }

        return c.json({
          success: true,
          message: `Your subscription to ${subscription.creator.profile?.displayName || 'this creator'} has been canceled. You'll have access until ${subscription.currentPeriodEnd?.toLocaleDateString() || 'the end of your billing period'}.`,
          subscription: {
            id: subscription.id,
            status: result.status,
            cancelAtPeriodEnd: result.cancelAtPeriodEnd,
            currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() || null,
          },
        })
      }

      // For non-Stripe subscriptions (Paystack)
      await db.subscription.update({
        where: { id: subscription.id },
        data: {
          cancelAtPeriodEnd: true,
          canceledAt: new Date(),
        },
      })

      // Log the cancellation
      await db.activity.create({
        data: {
          userId: subscription.creatorId,
          type: 'subscription_canceled_via_email',
          payload: {
            subscriptionId: subscription.id,
            subscriberId: subscription.subscriberId,
            source: 'email_link',
            cancelAtPeriodEnd: true,
          },
        },
      })

      // Send cancellation confirmation email (non-blocking)
      if (subscription.subscriber?.email && subscription.creator.profile?.displayName) {
        const accessUntil = subscription.currentPeriodEnd || new Date()
        const resubscribeUrl = subscription.creator.profile.username
          ? `${env.PUBLIC_PAGE_URL}/${subscription.creator.profile.username}`
          : env.PUBLIC_PAGE_URL

        sendCancellationConfirmationEmail(
          subscription.subscriber.email,
          subscription.subscriber.email.split('@')[0],
          subscription.creator.profile.displayName,
          accessUntil,
          resubscribeUrl
        ).catch((err) => console.error('[my-subscriptions] Failed to send cancel confirmation:', err))
      }

      return c.json({
        success: true,
        message: `Your subscription to ${subscription.creator.profile?.displayName || 'this creator'} has been canceled. You'll have access until ${subscription.currentPeriodEnd?.toLocaleDateString() || 'the end of your billing period'}.`,
        subscription: {
          id: subscription.id,
          status: subscription.status,
          cancelAtPeriodEnd: true,
          currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() || null,
        },
      })
    } catch (err: any) {
      console.error(`[my-subscriptions] Public cancel failed:`, err)
      return c.json({
        error: 'Failed to cancel subscription. Please try again or contact support.',
        code: 'CANCEL_FAILED',
      }, 500)
    }
  }
)

// ============================================
// PUBLIC PORTAL ENDPOINT (No Auth Required)
// ============================================
// Direct access to Stripe Customer Portal via signed token
// Used in subscription confirmation emails for frictionless management

// GET /manage/:token - Redirect directly to Stripe Customer Portal
mySubscriptions.get(
  '/manage/:token',
  publicRateLimit,
  async (c) => {
    const { token } = c.req.param()

    const decoded = validatePortalToken(token)
    if (!decoded) {
      // Invalid token - redirect to app with error
      return c.redirect(`${env.APP_URL}?error=invalid_manage_link`)
    }

    const { stripeCustomerId, subscriptionId } = decoded

    // Look up subscription for return URL context
    const subscription = await db.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        creator: {
          select: {
            profile: { select: { username: true } },
          },
        },
      },
    })

    // Determine return URL (creator's page or app homepage)
    const returnUrl = subscription?.creator.profile?.username
      ? `${env.APP_URL}/${subscription.creator.profile.username}`
      : env.APP_URL

    try {
      // Create Stripe Customer Portal session and redirect
      const { url } = await createSubscriberPortalSession(stripeCustomerId, returnUrl)
      return c.redirect(url)
    } catch (err: any) {
      console.error(`[my-subscriptions] Failed to create portal session for token:`, err)
      // Redirect to app with error
      return c.redirect(`${env.APP_URL}?error=portal_unavailable`)
    }
  }
)

// ============================================
// PUBLIC EXPRESS DASHBOARD ENDPOINT (No Auth Required)
// ============================================
// Direct access to Stripe Express Dashboard via signed token
// Used in creator notification emails (new subscriber, payout, etc.)

// GET /express-dashboard/:token - Redirect directly to Stripe Express Dashboard
mySubscriptions.get(
  '/express-dashboard/:token',
  publicRateLimit,
  async (c) => {
    const { token } = c.req.param()

    const decoded = validateExpressDashboardToken(token)
    if (!decoded) {
      // Invalid token - redirect to app with error
      return c.redirect(`${env.APP_URL}?error=invalid_dashboard_link`)
    }

    const { stripeAccountId } = decoded

    try {
      // Create fresh Stripe Express login link and redirect
      const url = await createExpressDashboardLink(stripeAccountId)
      return c.redirect(url)
    } catch (err: any) {
      console.error(`[my-subscriptions] Failed to create Express dashboard link:`, err)
      // Redirect to app with error
      return c.redirect(`${env.APP_URL}?error=dashboard_unavailable`)
    }
  }
)

export default mySubscriptions
