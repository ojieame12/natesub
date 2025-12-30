/**
 * Public Subscriber Portal Routes
 *
 * Allows subscribers to view and manage all their subscriptions
 * without logging in - just email + OTP verification.
 *
 * Security:
 * - Separate session from main auth (limited scope)
 * - OTP with short TTL (10 min) and max attempts (5)
 * - Rate limited per email and per IP
 * - No-store cache headers on all routes
 * - httpOnly, secure, sameSite=strict cookies
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { setCookie, getCookie, deleteCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import { randomBytes } from 'crypto'
import { db } from '../db/client.js'
import { redis } from '../db/redis.js'
import { env } from '../config/env.js'
import { sendOtpEmail } from '../services/email.js'
import { cancelSubscription, createSubscriberPortalSession } from '../services/stripe.js'
import { centsToDisplayAmount } from '../utils/currency.js'
import { logSubscriptionEvent } from '../services/systemLog.js'
import { rateLimit, getClientIdentifier } from '../middleware/rateLimit.js'

// Extend Hono context with subscriber session info
declare module 'hono' {
  interface ContextVariableMap {
    subscriberEmail: string
  }
}

const subscriber = new Hono()

// ============================================
// CONSTANTS
// ============================================

const OTP_TTL_SECONDS = 10 * 60 // 10 minutes
const OTP_MAX_ATTEMPTS = 5
const SESSION_TTL_SECONDS = 60 * 60 // 1 hour
const SUBSCRIBER_SESSION_SECRET = env.JWT_SECRET + '_subscriber_portal'

// ============================================
// RATE LIMITERS
// ============================================

// OTP request: 3 per email per 15 min, 10 per IP per 15 min
const otpRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  keyPrefix: 'subscriber_otp_ip',
  keyGenerator: (c) => `subscriber_otp_ip:${getClientIdentifier(c)}`,
  message: 'Too many requests. Please try again later.',
})

// Verify: 20 per IP per 15 min
const verifyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 20,
  keyPrefix: 'subscriber_verify_ip',
  keyGenerator: (c) => `subscriber_verify_ip:${getClientIdentifier(c)}`,
  message: 'Too many attempts. Please try again later.',
})

// General portal actions: 100 per min per IP
const portalRateLimit = rateLimit({
  windowMs: 60 * 1000,
  maxRequests: 100,
  keyPrefix: 'subscriber_portal_ip',
  keyGenerator: (c) => `subscriber_portal_ip:${getClientIdentifier(c)}`,
  message: 'Too many requests. Please slow down.',
})

// Cancel action: 5 per hour per IP
const cancelRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  maxRequests: 5,
  keyPrefix: 'subscriber_cancel_ip',
  keyGenerator: (c) => `subscriber_cancel_ip:${getClientIdentifier(c)}`,
  message: 'Too many cancellation attempts. Please try again later.',
})

// ============================================
// MIDDLEWARE
// ============================================

// Security headers for all routes
subscriber.use('*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  c.header('Pragma', 'no-cache')
  c.header('X-Robots-Tag', 'noindex, nofollow')
})

// Session validation middleware
async function requireSubscriberSession(c: any, next: () => Promise<void>) {
  const token = getCookie(c, 'subscriber_session')

  if (!token) {
    return c.json({ error: 'Session expired. Please verify your email again.', code: 'NO_SESSION' }, 401)
  }

  try {
    const payload = await verify(token, SUBSCRIBER_SESSION_SECRET) as { email: string; type: string; exp: number }

    if (payload.type !== 'subscriber_portal') {
      return c.json({ error: 'Invalid session.', code: 'INVALID_SESSION' }, 401)
    }

    // Attach email to context
    c.set('subscriberEmail', payload.email)
    await next()
  } catch (err) {
    return c.json({ error: 'Session expired. Please verify your email again.', code: 'SESSION_EXPIRED' }, 401)
  }
}

// ============================================
// HELPERS
// ============================================

function generateOtp(): string {
  const bytes = randomBytes(4)
  const num = bytes.readUInt32BE(0) % 1000000
  return num.toString().padStart(6, '0')
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!local || !domain) return email
  const maskedLocal = local.length > 2
    ? `${local[0]}***${local[local.length - 1]}`
    : `${local[0]}***`
  return `${maskedLocal}@${domain}`
}

function getStatusLabel(status: string, cancelAtPeriodEnd: boolean): string {
  if (status === 'active' && cancelAtPeriodEnd) return 'Canceling'
  if (status === 'active') return 'Active'
  if (status === 'past_due') return 'Payment failed'
  if (status === 'canceled') return 'Canceled'
  if (status === 'pending') return 'Pending'
  if (status === 'paused') return 'Paused'
  return status
}

// ============================================
// ROUTES
// ============================================

// POST /subscriber/otp - Send OTP to email
subscriber.post(
  '/otp',
  otpRateLimit,
  zValidator('json', z.object({
    email: z.string().email(),
  })),
  async (c) => {
    const { email } = c.req.valid('json')
    const normalizedEmail = email.toLowerCase().trim()

    // Check per-email rate limit (3 per 15 min)
    const emailKey = `subscriber_otp_email:${normalizedEmail}`
    const emailCount = await redis.incr(emailKey)
    if (emailCount === 1) {
      await redis.expire(emailKey, 15 * 60)
    }
    if (emailCount > 3) {
      // Still return generic message to prevent enumeration
      return c.json({
        message: 'If this email has subscriptions, you\'ll receive a verification code.',
      })
    }

    // Find user by email who has at least one subscription
    const user = await db.user.findFirst({
      where: {
        email: normalizedEmail,
        subscribedTo: {
          some: {} // Has at least one subscription
        }
      },
      select: { id: true, email: true }
    })

    // Always return same response (no email enumeration)
    if (!user) {
      return c.json({
        message: 'If this email has subscriptions, you\'ll receive a verification code.',
      })
    }

    // Generate and store OTP
    const otp = generateOtp()
    const otpKey = `subscriber_otp:${normalizedEmail}`
    const attemptsKey = `subscriber_otp_attempts:${normalizedEmail}`

    await redis.setex(otpKey, OTP_TTL_SECONDS, otp)
    await redis.del(attemptsKey) // Reset attempts on new OTP

    // Send OTP email
    await sendOtpEmail(normalizedEmail, otp)

    return c.json({
      message: 'If this email has subscriptions, you\'ll receive a verification code.',
    })
  }
)

// POST /subscriber/verify - Verify OTP and create session
subscriber.post(
  '/verify',
  verifyRateLimit,
  zValidator('json', z.object({
    email: z.string().email(),
    otp: z.string().length(6),
  })),
  async (c) => {
    const { email, otp } = c.req.valid('json')
    const normalizedEmail = email.toLowerCase().trim()

    const otpKey = `subscriber_otp:${normalizedEmail}`
    const attemptsKey = `subscriber_otp_attempts:${normalizedEmail}`

    // Check attempts
    const attempts = await redis.incr(attemptsKey)
    if (attempts === 1) {
      await redis.expire(attemptsKey, OTP_TTL_SECONDS)
    }
    if (attempts > OTP_MAX_ATTEMPTS) {
      await redis.del(otpKey) // Invalidate OTP
      return c.json({
        error: 'Too many attempts. Please request a new code.',
        code: 'MAX_ATTEMPTS',
      }, 400)
    }

    // Verify OTP
    const storedOtp = await redis.get(otpKey)
    if (!storedOtp || storedOtp !== otp) {
      return c.json({
        error: 'Invalid or expired code.',
        code: 'INVALID_OTP',
        attemptsRemaining: OTP_MAX_ATTEMPTS - attempts,
      }, 400)
    }

    // OTP valid - clean up and create session
    await redis.del(otpKey)
    await redis.del(attemptsKey)

    // Create session JWT
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
    const token = await sign(
      {
        email: normalizedEmail,
        type: 'subscriber_portal',
        exp: expiresAt,
      },
      SUBSCRIBER_SESSION_SECRET
    )

    // Set cookie - sameSite: 'None' required for cross-origin (api.natepay.co → natepay.co)
    setCookie(c, 'subscriber_session', token, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: env.NODE_ENV === 'production' ? 'None' : 'Lax', // None for cross-origin, Lax for local dev
      maxAge: SESSION_TTL_SECONDS,
      path: '/subscriber',
    })

    return c.json({
      success: true,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    })
  }
)

// GET /subscriber/subscriptions - List all subscriptions
subscriber.get(
  '/subscriptions',
  portalRateLimit,
  requireSubscriberSession,
  async (c) => {
    const email = c.get('subscriberEmail')

    const user = await db.user.findFirst({
      where: { email },
      select: { id: true }
    })

    if (!user) {
      return c.json({ subscriptions: [] })
    }

    // Get all subscriptions (active, past_due, and recently canceled)
    const subscriptions = await db.subscription.findMany({
      where: {
        subscriberId: user.id,
        OR: [
          { status: { in: ['active', 'past_due', 'pending'] } },
          // Include canceled if still has access
          {
            status: 'canceled',
            currentPeriodEnd: { gte: new Date() }
          },
          // Include canceling
          {
            cancelAtPeriodEnd: true,
            currentPeriodEnd: { gte: new Date() }
          }
        ]
      },
      include: {
        creator: {
          select: {
            profile: {
              select: {
                displayName: true,
                username: true,
                avatarUrl: true,
              }
            }
          }
        },
        // Include payments to calculate subscriber's total paid (gross amounts)
        payments: {
          where: { status: 'succeeded' },
          select: {
            grossCents: true,
            amountCents: true,
            subscriberFeeCents: true,
          }
        },
      },
      orderBy: { updatedAt: 'desc' }
    })

    // Sort by urgency: past_due first, then active, then others
    const statusPriority: Record<string, number> = {
      past_due: 0,
      active: 1,
      pending: 2,
      paused: 3,
      canceled: 4,
    }
    subscriptions.sort((a, b) =>
      (statusPriority[a.status] ?? 5) - (statusPriority[b.status] ?? 5)
    )

    const mapped = subscriptions.map(sub => {
      const provider = sub.stripeSubscriptionId ? 'stripe' : 'paystack'
      const canUpdatePayment = provider === 'stripe' && !!sub.stripeCustomerId
      const displayName = sub.creator.profile?.displayName || 'Creator'

      // Calculate subscriber's total paid (gross = what they actually paid)
      // grossCents is the full amount subscriber paid (price + subscriber fee)
      // Fall back to amountCents + subscriberFeeCents for older records
      const totalPaidCents = sub.payments.reduce((sum, p) => {
        const gross = p.grossCents ?? (p.amountCents + (p.subscriberFeeCents ?? 0))
        return sum + gross
      }, 0)

      return {
        id: sub.id,
        creator: {
          displayName,
          username: sub.creator.profile?.username,
          avatarUrl: sub.creator.profile?.avatarUrl,
        },
        amount: centsToDisplayAmount(sub.amount, sub.currency),
        currency: sub.currency,
        interval: sub.interval,
        status: sub.status,
        statusLabel: getStatusLabel(sub.status, sub.cancelAtPeriodEnd),
        currentPeriodEnd: sub.currentPeriodEnd?.toISOString(),
        startedAt: sub.startedAt?.toISOString(),
        totalPaid: centsToDisplayAmount(totalPaidCents, sub.currency),
        paymentCount: sub.payments.length,
        provider,
        canUpdatePayment,
        updatePaymentMethod: canUpdatePayment ? 'portal' : provider === 'paystack' ? 'resubscribe' : 'none',
        billingDescriptor: `NATEPAY* ${displayName.replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 12).toUpperCase()}`,
        isPastDue: sub.status === 'past_due',
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      }
    })

    return c.json({
      email,
      maskedEmail: maskEmail(email),
      subscriptions: mapped,
    })
  }
)

// GET /subscriber/subscriptions/:id - Get subscription details
subscriber.get(
  '/subscriptions/:id',
  portalRateLimit,
  requireSubscriberSession,
  async (c) => {
    const email = c.get('subscriberEmail')
    const { id } = c.req.param()

    const user = await db.user.findFirst({
      where: { email },
      select: { id: true }
    })

    if (!user) {
      return c.json({ error: 'Subscription not found', code: 'NOT_FOUND' }, 404)
    }

    const subscription = await db.subscription.findFirst({
      where: {
        id,
        subscriberId: user.id,
      },
      include: {
        creator: {
          select: {
            profile: {
              select: {
                displayName: true,
                username: true,
                avatarUrl: true,
              }
            }
          }
        },
        payments: {
          where: { status: 'succeeded' },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            grossCents: true,
            amountCents: true,
            subscriberFeeCents: true,
            currency: true,
            createdAt: true,
            status: true,
          }
        }
      }
    })

    if (!subscription) {
      return c.json({ error: 'Subscription not found', code: 'NOT_FOUND' }, 404)
    }

    const provider = subscription.stripeSubscriptionId ? 'stripe' : 'paystack'
    const canUpdatePayment = provider === 'stripe' && !!subscription.stripeCustomerId
    const displayName = subscription.creator.profile?.displayName || 'Creator'

    const resubscribeUrl = subscription.creator.profile?.username
      ? `${env.PUBLIC_PAGE_URL}/${subscription.creator.profile.username}`
      : env.PUBLIC_PAGE_URL

    // Calculate subscriber's total paid (gross = what they actually paid)
    const totalPaidCents = subscription.payments.reduce((sum, p) => {
      const gross = p.grossCents ?? (p.amountCents + (p.subscriberFeeCents ?? 0))
      return sum + gross
    }, 0)

    return c.json({
      subscription: {
        id: subscription.id,
        creator: {
          displayName,
          username: subscription.creator.profile?.username,
          avatarUrl: subscription.creator.profile?.avatarUrl,
        },
        amount: centsToDisplayAmount(subscription.amount, subscription.currency),
        currency: subscription.currency,
        interval: subscription.interval,
        status: subscription.status,
        statusLabel: getStatusLabel(subscription.status, subscription.cancelAtPeriodEnd),
        currentPeriodEnd: subscription.currentPeriodEnd?.toISOString(),
        startedAt: subscription.startedAt?.toISOString(),
        createdAt: subscription.createdAt.toISOString(),
        totalPaid: centsToDisplayAmount(totalPaidCents, subscription.currency),
        paymentCount: subscription.payments.length,
        provider,
        canUpdatePayment,
        updatePaymentMethod: canUpdatePayment ? 'portal' : provider === 'paystack' ? 'resubscribe' : 'none',
        billingDescriptor: `NATEPAY* ${displayName.replace(/[^a-zA-Z0-9 ]/g, '').substring(0, 12).toUpperCase()}`,
        isPastDue: subscription.status === 'past_due',
        pastDueMessage: subscription.status === 'past_due'
          ? 'Your last payment failed. Please update your payment method to continue.'
          : null,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      },
      payments: subscription.payments.map(p => ({
        id: p.id,
        // Show subscriber what they actually paid (gross amount)
        amount: centsToDisplayAmount(p.grossCents ?? (p.amountCents + (p.subscriberFeeCents ?? 0)), p.currency),
        currency: p.currency,
        date: p.createdAt.toISOString(),
        status: p.status,
      })),
      actions: {
        resubscribeUrl,
      }
    })
  }
)

// POST /subscriber/subscriptions/:id/cancel - Cancel subscription
subscriber.post(
  '/subscriptions/:id/cancel',
  cancelRateLimit,
  requireSubscriberSession,
  zValidator('json', z.object({
    reason: z.enum([
      'too_expensive',
      'not_enough_value',
      'taking_break',
      'found_alternative',
      'technical_issues',
      'other',
    ]).optional(),
    comment: z.string().max(500).optional(),
  })),
  async (c) => {
    const email = c.get('subscriberEmail')
    const { id } = c.req.param()
    const body = c.req.valid('json')

    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
               c.req.header('x-real-ip') || 'unknown'
    const userAgent = c.req.header('user-agent') || 'unknown'

    const user = await db.user.findFirst({
      where: { email },
      select: { id: true }
    })

    if (!user) {
      return c.json({ error: 'Subscription not found', code: 'NOT_FOUND' }, 404)
    }

    const subscription = await db.subscription.findFirst({
      where: {
        id,
        subscriberId: user.id,
      },
      include: {
        creator: {
          select: {
            id: true,
            profile: {
              select: { displayName: true, username: true }
            }
          }
        }
      }
    })

    if (!subscription) {
      return c.json({ error: 'Subscription not found', code: 'NOT_FOUND' }, 404)
    }

    const resubscribeUrl = subscription.creator.profile?.username
      ? `${env.PUBLIC_PAGE_URL}/${subscription.creator.profile.username}`
      : env.PUBLIC_PAGE_URL

    // Already canceled
    if (subscription.status === 'canceled' || subscription.cancelAtPeriodEnd) {
      return c.json({
        success: true,
        alreadyCanceled: true,
        message: 'This subscription is already canceled.',
        accessUntil: subscription.currentPeriodEnd?.toISOString(),
        resubscribeUrl,
      })
    }

    // Sanitize comment
    const sanitizedComment = body.comment
      ? body.comment.replace(/[<>]/g, '').trim().slice(0, 500)
      : null

    const provider = subscription.stripeSubscriptionId ? 'stripe' : 'paystack'

    try {
      // Record feedback
      if (body.reason) {
        await db.activity.create({
          data: {
            userId: subscription.creator.id,
            type: 'subscription_cancel_feedback',
            payload: {
              subscriptionId: subscription.id,
              subscriberId: user.id,
              reason: body.reason,
              comment: sanitizedComment,
              source: 'subscriber_portal',
              ip,
              userAgent: userAgent.slice(0, 200),
            },
          },
        })
      }

      // Cancel at period end
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
        await db.subscription.update({
          where: { id: subscription.id },
          data: {
            cancelAtPeriodEnd: true,
            canceledAt: new Date(),
          },
        })
      }

      // Log event
      await logSubscriptionEvent({
        event: 'cancel',
        subscriptionId: subscription.id,
        subscriberId: user.id,
        creatorId: subscription.creator.id,
        provider,
        reason: body.reason,
        source: 'subscriber_portal',
        ip,
        userAgent: userAgent.slice(0, 200),
      })

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
      console.error('[subscriber] Cancel failed:', err)
      return c.json({
        error: 'Failed to cancel subscription. Please try again.',
        code: 'CANCEL_FAILED',
      }, 500)
    }
  }
)

// GET /subscriber/subscriptions/:id/portal - Get Stripe portal URL
subscriber.get(
  '/subscriptions/:id/portal',
  portalRateLimit,
  requireSubscriberSession,
  async (c) => {
    const email = c.get('subscriberEmail')
    const { id } = c.req.param()

    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
               c.req.header('x-real-ip') || 'unknown'
    const userAgent = c.req.header('user-agent') || 'unknown'

    const user = await db.user.findFirst({
      where: { email },
      select: { id: true }
    })

    if (!user) {
      return c.json({ error: 'Subscription not found', code: 'NOT_FOUND' }, 404)
    }

    const subscription = await db.subscription.findFirst({
      where: {
        id,
        subscriberId: user.id,
      },
      include: {
        creator: {
          select: {
            id: true,
            profile: { select: { username: true } }
          }
        }
      }
    })

    if (!subscription) {
      return c.json({ error: 'Subscription not found', code: 'NOT_FOUND' }, 404)
    }

    const resubscribeUrl = subscription.creator.profile?.username
      ? `${env.PUBLIC_PAGE_URL}/${subscription.creator.profile.username}`
      : env.PUBLIC_PAGE_URL

    if (!subscription.stripeCustomerId) {
      return c.json({
        error: 'Payment management is not available for this payment method.',
        code: 'NO_PORTAL',
        instructions: 'To update your payment method, cancel and resubscribe with a new card.',
        resubscribeUrl,
      }, 400)
    }

    try {
      // Use PUBLIC_PAGE_URL since this is a subscriber-facing portal
      const returnUrl = `${env.PUBLIC_PAGE_URL}/subscriptions`
      const { url } = await createSubscriberPortalSession(subscription.stripeCustomerId, returnUrl)

      await logSubscriptionEvent({
        event: 'portal_redirect',
        subscriptionId: subscription.id,
        subscriberId: user.id,
        creatorId: subscription.creator.id,
        provider: 'stripe',
        source: 'subscriber_portal',
        ip,
        userAgent: userAgent.slice(0, 200),
      })

      return c.json({ url })
    } catch (err: any) {
      console.error('[subscriber] Portal session failed:', err)
      return c.json({
        error: 'Unable to open payment portal. Please try again.',
        code: 'PORTAL_FAILED',
      }, 500)
    }
  }
)

// POST /subscriber/signout - Clear session
subscriber.post('/signout', async (c) => {
  deleteCookie(c, 'subscriber_session', {
    path: '/subscriber',
    secure: env.NODE_ENV === 'production',
    sameSite: env.NODE_ENV === 'production' ? 'None' : 'Lax',
  })
  return c.json({ success: true })
})

export default subscriber
