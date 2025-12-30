/**
 * Public Subscription Management Routes
 *
 * Token-based access for subscribers to manage their subscriptions
 * without needing to log in. Used from email links.
 *
 * Security considerations:
 * - All routes set Cache-Control: no-store to prevent PII caching
 * - Tokens are validated with HMAC signature + expiration
 * - Cancel actions are idempotent
 * - Rate limited to 500 req/hour per IP
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/client.js'
import { publicRateLimit } from '../middleware/rateLimit.js'
import { validateManageToken } from '../utils/cancelToken.js'
import { cancelSubscription } from '../services/stripe.js'
import { createSubscriberPortalSession } from '../services/stripe.js'
import { sendCancellationConfirmationEmail } from '../services/email.js'
import { logSubscriptionEvent } from '../services/systemLog.js'
import { env } from '../config/env.js'
import { centsToDisplayAmount } from '../utils/currency.js'

const subscriptionManage = new Hono()

// Middleware to prevent caching of PII
subscriptionManage.use('*', async (c, next) => {
  await next()
  // Prevent CDN/browser caching of personal subscription data
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  c.header('Pragma', 'no-cache')
})

// Cancel reason enum - validated before use
const CancelReasonSchema = z.enum([
  'too_expensive',
  'not_enough_value',
  'taking_break',
  'found_alternative',
  'technical_issues',
  'other',
])

// Sanitize user-provided text to prevent injection
function sanitizeText(text: string): string {
  return text
    .replace(/[<>]/g, '') // Remove HTML-like chars
    .trim()
    .slice(0, 500) // Enforce max length
}

// GET /subscription/manage/:token - Get subscription details for management page
subscriptionManage.get(
  '/:token',
  publicRateLimit,
  async (c) => {
    const { token } = c.req.param()

    const decoded = validateManageToken(token)
    if (!decoded) {
      return c.json({
        error: 'Invalid or expired link',
        code: 'INVALID_TOKEN',
      }, 400)
    }

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
                avatarUrl: true,
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

    // Get accurate total supported using aggregation (grossCents = what subscriber paid)
    // This matches the subscriber portal calculation for consistency
    const paymentAggregate = await db.payment.aggregate({
      where: {
        subscriptionId: decoded.subscriptionId,
        status: 'succeeded',
      },
      _sum: {
        grossCents: true,
        amountCents: true,
        subscriberFeeCents: true,
      },
      _count: true,
    })

    // grossCents is the full amount subscriber paid (price + subscriber fee)
    // Fall back to amountCents + subscriberFeeCents for older records without grossCents
    const totalSupportedCents = paymentAggregate._sum.grossCents
      ?? ((paymentAggregate._sum.amountCents ?? 0) + (paymentAggregate._sum.subscriberFeeCents ?? 0))
    const totalPaymentCount = paymentAggregate._count

    // Fetch only last 5 payments for display (UI only shows recent history)
    const recentPayments = await db.payment.findMany({
      where: {
        subscriptionId: decoded.subscriptionId,
        status: 'succeeded',
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        grossCents: true,
        amountCents: true,
        subscriberFeeCents: true,
        currency: true,
        createdAt: true,
        type: true,
      },
    })

    // Mask email for privacy (j***n@example.com)
    const email = subscription.subscriber?.email || ''
    const [localPart, domain] = email.split('@')
    const maskedEmail = localPart && domain
      ? `${localPart[0]}***${localPart.slice(-1)}@${domain}`
      : email

    // Determine provider and capabilities
    const provider = subscription.stripeSubscriptionId ? 'stripe' : 'paystack'
    const canUpdatePayment = provider === 'stripe' && !!subscription.stripeCustomerId

    // Build resubscribe URL for canceled/canceling states
    // Use PUBLIC_PAGE_URL for creator pages (may differ from app URL)
    const resubscribeUrl = subscription.creator.profile?.username
      ? `${env.PUBLIC_PAGE_URL}/${subscription.creator.profile.username}`
      : env.PUBLIC_PAGE_URL

    // Check for past_due status (payment failed)
    const isPastDue = subscription.status === 'past_due'

    // Build billing info for "don't recognize charge" disputes
    // Must match actual Stripe descriptor format: "NATEPAY* CREATORNAME"
    const cleanName = (subscription.creator.profile?.displayName || 'Creator')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .toUpperCase()
      .substring(0, 12) // Leave room for "NATEPAY* " prefix
    const billingDescriptor = `NATEPAY* ${cleanName}`

    // Log view event for analytics
    logSubscriptionEvent({
      event: 'view_manage',
      subscriptionId: subscription.id,
      subscriberId: subscription.subscriberId || undefined,
      creatorId: subscription.creatorId,
      provider,
      source: 'manage_page',
    })

    return c.json({
      subscription: {
        id: subscription.id,
        status: subscription.status,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        amount: centsToDisplayAmount(subscription.amount, subscription.currency),
        currency: subscription.currency,
        interval: subscription.interval,
        currentPeriodEnd: subscription.currentPeriodEnd?.toISOString(),
        startedAt: subscription.startedAt?.toISOString(),
        createdAt: subscription.createdAt.toISOString(),
        // Provider info
        provider,
        // Payment update capabilities
        canUpdatePayment,
        updatePaymentMethod: canUpdatePayment
          ? 'portal' // Can use Stripe portal
          : provider === 'paystack'
            ? 'resubscribe' // Paystack requires cancel + resubscribe
            : 'none',
        // Billing info to help recognize charges
        billingDescriptor,
        // Alert states
        isPastDue,
        pastDueMessage: isPastDue
          ? 'Your last payment failed. Please update your payment method to continue your subscription.'
          : null,
      },
      creator: {
        displayName: subscription.creator.profile?.displayName || 'Creator',
        username: subscription.creator.profile?.username,
        avatarUrl: subscription.creator.profile?.avatarUrl,
      },
      subscriber: {
        maskedEmail,
      },
      stats: {
        // Show gross amount (what subscriber actually paid, including fees)
        totalSupported: centsToDisplayAmount(totalSupportedCents, subscription.currency),
        memberSince: subscription.startedAt || subscription.createdAt,
        paymentCount: totalPaymentCount,
      },
      // Show last 5 payments with gross amounts (what subscriber paid)
      payments: recentPayments.map(p => ({
        id: p.id,
        // Show subscriber what they actually paid (gross amount)
        amount: centsToDisplayAmount(
          p.grossCents ?? (p.amountCents + (p.subscriberFeeCents ?? 0)),
          p.currency
        ),
        currency: p.currency,
        date: p.createdAt.toISOString(),
        type: p.type,
      })),
      // Action URLs
      actions: {
        resubscribeUrl,
        // Only include portal URL hint if Stripe is available
        canOpenPortal: canUpdatePayment,
      },
    })
  }
)

// POST /subscription/manage/:token/cancel - Cancel with reason
subscriptionManage.post(
  '/:token/cancel',
  publicRateLimit,
  zValidator('json', z.object({
    reason: CancelReasonSchema.optional(),
    comment: z.string().max(500).optional(),
  })),
  async (c) => {
    const { token } = c.req.param()
    const body = c.req.valid('json')

    // Collect audit metadata
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
               c.req.header('x-real-ip') ||
               'unknown'
    const userAgent = c.req.header('user-agent') || 'unknown'

    const decoded = validateManageToken(token)
    if (!decoded) {
      return c.json({
        error: 'Invalid or expired link',
        code: 'INVALID_TOKEN',
      }, 400)
    }

    const subscription = await db.subscription.findUnique({
      where: { id: decoded.subscriptionId },
      include: {
        subscriber: { select: { email: true } },
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
      return c.json({
        error: 'Subscription not found',
        code: 'NOT_FOUND',
      }, 404)
    }

    // Build resubscribe URL for response
    // Use PUBLIC_PAGE_URL for creator pages (may differ from app URL)
    const resubscribeUrl = subscription.creator.profile?.username
      ? `${env.PUBLIC_PAGE_URL}/${subscription.creator.profile.username}`
      : env.PUBLIC_PAGE_URL

    // Already canceled? Return idempotent success with resubscribe option
    if (subscription.status === 'canceled') {
      return c.json({
        success: true,
        alreadyCanceled: true,
        message: 'This subscription was already canceled.',
        accessUntil: subscription.currentPeriodEnd?.toISOString(),
        resubscribeUrl,
      })
    }

    // Already set to cancel? Return idempotent success
    if (subscription.cancelAtPeriodEnd) {
      return c.json({
        success: true,
        alreadyCanceled: true,
        message: 'Your subscription is already set to cancel.',
        accessUntil: subscription.currentPeriodEnd?.toISOString(),
        resubscribeUrl,
      })
    }

    try {
      // Sanitize user-provided comment
      const sanitizedComment = body.comment ? sanitizeText(body.comment) : null

      // Record cancel feedback for analytics (with audit trail)
      if (body.reason) {
        await db.activity.create({
          data: {
            userId: subscription.creatorId,
            type: 'subscription_cancel_feedback',
            payload: {
              subscriptionId: subscription.id,
              subscriberId: subscription.subscriberId,
              reason: body.reason,
              comment: sanitizedComment,
              source: 'manage_page',
              // Audit metadata
              ip,
              userAgent: userAgent.slice(0, 200), // Truncate long UAs
            },
          },
        })
      }

      // Cancel at period end (not immediately) - subscriber keeps access
      const provider = subscription.stripeSubscriptionId ? 'stripe' : 'paystack'

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
      } else {
        // Paystack or other - update locally
        await db.subscription.update({
          where: { id: subscription.id },
          data: {
            cancelAtPeriodEnd: true,
            canceledAt: new Date(),
          },
        })
      }

      // Log the cancellation with full audit trail
      await logSubscriptionEvent({
        event: 'cancel',
        subscriptionId: subscription.id,
        subscriberId: subscription.subscriberId || undefined,
        creatorId: subscription.creatorId,
        provider,
        reason: body.reason,
        source: 'manage_page',
        ip,
        userAgent: userAgent.slice(0, 200),
      })

      await db.activity.create({
        data: {
          userId: subscription.creatorId,
          type: 'subscription_canceled_via_manage_page',
          payload: {
            subscriptionId: subscription.id,
            subscriberId: subscription.subscriberId,
            reason: body.reason || null,
            comment: sanitizedComment,
            source: 'manage_page',
            provider,
            ip,
            userAgent: userAgent.slice(0, 200),
          },
        },
      })

      // Send confirmation email
      if (subscription.subscriber?.email && subscription.creator.profile?.displayName) {
        const accessUntil = subscription.currentPeriodEnd || new Date()

        sendCancellationConfirmationEmail(
          subscription.subscriber.email,
          subscription.subscriber.email.split('@')[0],
          subscription.creator.profile.displayName,
          accessUntil,
          resubscribeUrl
        ).catch((err) => console.error('[manage] Failed to send cancel confirmation:', err))
      }

      // Format access date nicely
      const accessDate = subscription.currentPeriodEnd
        ? subscription.currentPeriodEnd.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })
        : 'the end of your billing period'

      return c.json({
        success: true,
        message: `Your subscription has been canceled. You'll have access until ${accessDate}.`,
        accessUntil: subscription.currentPeriodEnd?.toISOString(),
        resubscribeUrl,
      })
    } catch (err: any) {
      console.error('[manage] Cancel failed:', err)
      return c.json({
        error: 'Failed to cancel subscription. Please try again or contact support.',
        code: 'CANCEL_FAILED',
        supportUrl: `${env.APP_URL}/support`,
      }, 500)
    }
  }
)

// GET /subscription/manage/:token/portal - Redirect to Stripe portal for payment update
subscriptionManage.get(
  '/:token/portal',
  publicRateLimit,
  async (c) => {
    const { token } = c.req.param()

    // Collect audit metadata
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
               c.req.header('x-real-ip') ||
               'unknown'
    const userAgent = c.req.header('user-agent') || 'unknown'

    const decoded = validateManageToken(token)
    if (!decoded) {
      return c.json({
        error: 'Invalid or expired link',
        code: 'INVALID_TOKEN',
      }, 400)
    }

    const subscription = await db.subscription.findUnique({
      where: { id: decoded.subscriptionId },
      include: {
        creator: {
          select: {
            profile: { select: { username: true } },
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

    // Build resubscribe URL for Paystack fallback
    // Use PUBLIC_PAGE_URL for creator pages (may differ from app URL)
    const resubscribeUrl = subscription.creator.profile?.username
      ? `${env.PUBLIC_PAGE_URL}/${subscription.creator.profile.username}`
      : env.PUBLIC_PAGE_URL

    // Paystack doesn't have a customer portal - provide alternative
    if (!subscription.stripeCustomerId) {
      return c.json({
        error: 'Payment management is not available for this payment method.',
        code: 'NO_PORTAL',
        // Provide alternative instructions for Paystack users
        instructions: 'To update your payment method, please cancel your current subscription and resubscribe with a new card.',
        resubscribeUrl,
        supportUrl: `${env.APP_URL}/support`,
      }, 400)
    }

    try {
      const returnUrl = `${env.APP_URL}/subscription/manage/${token}`
      const { url } = await createSubscriberPortalSession(subscription.stripeCustomerId, returnUrl)

      // Log portal redirect for analytics
      await logSubscriptionEvent({
        event: 'portal_redirect',
        subscriptionId: subscription.id,
        subscriberId: subscription.subscriberId || undefined,
        creatorId: subscription.creatorId,
        provider: 'stripe',
        source: 'manage_page',
        ip,
        userAgent: userAgent.slice(0, 200),
      })

      return c.json({ url })
    } catch (err: any) {
      console.error('[manage] Portal session failed:', err)

      // Return helpful fallback with support link
      return c.json({
        error: 'Unable to open payment portal. Please try again in a moment.',
        code: 'PORTAL_FAILED',
        // Provide fallback options
        supportUrl: `${env.APP_URL}/support`,
        retryable: true,
      }, 500)
    }
  }
)

export default subscriptionManage
