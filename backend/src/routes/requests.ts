import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { createHash, randomBytes } from 'crypto'
import { Prisma } from '@prisma/client'
import { db } from '../db/client.js'
import { redis } from '../db/redis.js'
import { requireAuth } from '../middleware/auth.js'
import { publicRateLimit } from '../middleware/rateLimit.js'
import { sendRequestEmail } from '../services/email.js'
import { createCheckoutSession, stripe } from '../services/stripe.js'
import { initializePaystackCheckout, generateReference } from '../services/paystack.js'
import { scheduleRequestReminders, scheduleRequestUnpaidReminder } from '../jobs/reminders.js'
import { calculateServiceFee, type FeeMode } from '../services/fees.js'
import { encrypt } from '../utils/encryption.js'
import { centsToDisplayAmount } from '../utils/currency.js'
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
  publicRateLimit,  // Prevent abuse
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

    // Schedule unpaid reminder (they've opened it, cancel unopened reminders)
    // Run in background so it doesn't slow down response
    scheduleRequestUnpaidReminder(request.id).catch((err) => {
      console.error(`[requests] Failed to schedule unpaid reminder for ${request.id}:`, err.message)
    })

    return c.json({
      request: {
        id: request.id,
        creator: {
          displayName: request.creator.profile?.displayName,
          avatarUrl: request.creator.profile?.avatarUrl,
          username: request.creator.profile?.username,
        },
        recipientName: request.recipientName,
        // Privacy: Don't return email, just boolean flag
        hasRecipientEmail: !!request.recipientEmail,
        amount: request.amountCents, // Return raw cents for precise currency handling
        currency: request.currency,
        isRecurring: request.isRecurring,
        message: request.message,
        voiceUrl: request.voiceUrl,
        customPerks: request.customPerks,
        relationship: request.relationship,
        purpose: request.purpose,
        dueDate: request.dueDate,
      },
    })
  }
)

// Accept request (creates checkout)
requests.post(
  '/r/:token/accept',
  publicRateLimit,  // Prevent abuse - expensive Stripe API calls
  zValidator('param', z.object({ token: z.string() })),
  zValidator('json', z.object({
    email: z.string().email().optional(),
  })),
  async (c) => {
    const { token } = c.req.valid('param')
    const { email: inputEmail } = c.req.valid('json')
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

    const profile = request.creator.profile
    const hasStripe = !!profile?.stripeAccountId
    const hasPaystack = !!profile?.paystackSubaccountCode

    // Check if creator has any payment method set up
    if (!hasStripe && !hasPaystack) {
      return c.json({ error: 'This service provider has not set up payments yet' }, 400)
    }

    // Determine which provider to use:
    // 1. If paymentProvider is explicitly set and that provider is connected, use it
    // 2. If paymentProvider not set (legacy), use whichever is available (prefer Stripe if both)
    // 3. If paymentProvider is set but that provider isn't connected, fall back to what's available
    let usePaystack: boolean
    if (profile?.paymentProvider === 'paystack') {
      usePaystack = hasPaystack // Use Paystack if set and available, else will fail below
    } else if (profile?.paymentProvider === 'stripe') {
      usePaystack = !hasStripe && hasPaystack // Only use Paystack as fallback if Stripe unavailable
    } else {
      // No explicit provider set (legacy data) - use what's available, prefer Stripe
      usePaystack = !hasStripe && hasPaystack
    }

    // Validate the selected provider is actually available
    if (usePaystack && !hasPaystack) {
      return c.json({ error: 'Paystack payments are not configured for this creator' }, 400)
    }
    if (!usePaystack && !hasStripe) {
      return c.json({ error: 'Stripe payments are not configured for this creator' }, 400)
    }

    // Enforce platform debit cap for service providers ($30 max = 6 months) - Stripe only
    const PLATFORM_DEBIT_CAP_CENTS = 3000
    if (!usePaystack && profile?.purpose === 'service' &&
      (profile.platformDebitCents || 0) >= PLATFORM_DEBIT_CAP_CENTS) {
      return c.json({
        error: 'Outstanding platform balance must be cleared before accepting new payments.',
        code: 'PLATFORM_DEBIT_CAP_REACHED',
        debitCents: profile.platformDebitCents,
      }, 402)
    }

    // Use input email OR stored recipient email (Targeted Flow)
    const email = inputEmail || request.recipientEmail

    if (!email) {
      return c.json({ error: 'Email is required' }, 400)
    }

    try {
      // Calculate service fee based on creator's fee mode setting
      const feeCalc = calculateServiceFee(
        request.amountCents,
        request.currency,
        profile?.purpose,
        profile?.feeMode as FeeMode
      )

      // Route to appropriate payment provider
      if (usePaystack) {
        // === PAYSTACK CHECKOUT ===
        const reference = generateReference('REQ')

        const result = await initializePaystackCheckout({
          email,
          amount: feeCalc.grossCents, // What subscriber pays
          currency: request.currency,
          subaccountCode: profile.paystackSubaccountCode!,
          callbackUrl: `${env.PUBLIC_PAGE_URL}/r/${token}/success?provider=paystack`,
          reference,
          metadata: {
            creatorId: request.creatorId,
            requestId: request.id, // CRITICAL: Required for webhook to finalize request
            interval: request.isRecurring ? 'month' : 'one_time',
            creatorAmount: feeCalc.netCents,
            serviceFee: feeCalc.feeCents,
            feeModel: feeCalc.feeModel,
            feeMode: feeCalc.feeMode,
            feeEffectiveRate: feeCalc.effectiveRate,
          },
        })

        // Update request to pending_payment status
        await db.request.update({
          where: { id: request.id },
          data: {
            status: 'pending_payment',
            paystackTransactionRef: reference,
          },
        })

        return c.json({
          success: true,
          checkoutUrl: result.authorization_url,
          provider: 'paystack',
        })
      } else {
        // === STRIPE CHECKOUT ===
        // IDEMPOTENCY: Check for existing valid checkout session
        if (request.stripeCheckoutSessionId) {
          try {
            const existingSession = await stripe.checkout.sessions.retrieve(request.stripeCheckoutSessionId)

            // Session is still usable if it's open and not expired
            if (existingSession.status === 'open' && existingSession.url) {
              console.log(`[requests] Returning existing checkout session for request ${request.id}`)
              return c.json({
                success: true,
                checkoutUrl: existingSession.url,
                cached: true,
                provider: 'stripe',
              })
            }
          } catch (sessionErr: any) {
            console.log(`[requests] Existing session invalid for request ${request.id}, creating new`)
          }
        }

        // Create checkout session with request tracking
        const session = await createCheckoutSession({
          creatorId: request.creatorId,
          requestId: request.id,
          grossAmount: feeCalc.grossCents,
          netAmount: feeCalc.netCents,
          serviceFee: feeCalc.feeCents,
          currency: request.currency,
          interval: request.isRecurring ? 'month' : 'one_time',
          successUrl: `${env.PUBLIC_PAGE_URL}/r/${token}/success`,
          cancelUrl: `${env.PUBLIC_PAGE_URL}/r/${token}?canceled=true`,
          subscriberEmail: email,
          feeMetadata: {
            feeModel: feeCalc.feeModel,
            feeMode: feeCalc.feeMode,
            feeEffectiveRate: feeCalc.effectiveRate,
          },
        })

        // Update request to pending_payment status
        await db.request.update({
          where: { id: request.id },
          data: {
            status: 'pending_payment',
            stripeCheckoutSessionId: session.id,
          },
        })

        return c.json({
          success: true,
          checkoutUrl: session.url,
          provider: 'stripe',
        })
      }
    } catch (error) {
      console.error('Accept request error:', error)
      return c.json({ error: 'Failed to create checkout' }, 500)
    }
  }
)

// Decline request
requests.post(
  '/r/:token/decline',
  publicRateLimit,  // Prevent abuse
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
    // Phone validation: E.164 format recommended, allow 10-20 digits with optional +
    recipientPhone: z.string().regex(/^\+?[0-9]{10,20}$/, 'Invalid phone format').optional(),
    relationship: z.enum(['family', 'friend', 'client', 'fan', 'colleague', 'partner', 'other']),
    amountCents: z.number().int().positive().max(10000000), // Max $100k
    currency: z.string().length(3),  // Required - use creator's currency
    isRecurring: z.boolean().default(false),
    message: z.string().max(1000).optional(),
    voiceUrl: z.string().url().optional(),
    customPerks: z.array(z.string().max(100)).max(10).optional(),
    purpose: z.string().max(100).optional(),  // What the request is for
    dueDate: z.string().datetime().optional(), // ISO date string for invoices
  })),
  async (c) => {
    const userId = c.get('userId')
    const data = c.req.valid('json')
    const requestCurrency = data.currency.toUpperCase()

    // Validate currency against creator's profile
    const profile = await db.profile.findUnique({
      where: { userId },
      select: { currency: true, paymentProvider: true, stripeAccountId: true, paystackSubaccountCode: true },
    })

    if (!profile) {
      return c.json({ error: 'Profile not found. Complete onboarding first.' }, 404)
    }

    // Enforce currency matches profile (prevents currency mismatch issues at checkout)
    if (requestCurrency !== profile.currency) {
      return c.json({
        error: `Currency mismatch. Your profile is set to ${profile.currency}, but request uses ${requestCurrency}.`,
      }, 400)
    }

    // Validate payment provider is configured
    const hasStripe = !!profile.stripeAccountId
    const hasPaystack = !!profile.paystackSubaccountCode
    if (!hasStripe && !hasPaystack) {
      return c.json({ error: 'Set up payments before creating requests.' }, 400)
    }

    const request = await db.request.create({
      data: {
        creatorId: userId,
        recipientName: data.recipientName,
        recipientEmail: data.recipientEmail || null,
        recipientPhone: data.recipientPhone || null,
        relationship: data.relationship,
        amountCents: data.amountCents,
        currency: requestCurrency,
        isRecurring: data.isRecurring,
        message: data.message || null,
        voiceUrl: data.voiceUrl || null,
        customPerks: data.customPerks || Prisma.JsonNull,
        purpose: data.purpose || null,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
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
        amount: centsToDisplayAmount(r.amountCents, r.currency),
        currency: r.currency,
        isRecurring: r.isRecurring,
        purpose: r.purpose,
        dueDate: r.dueDate,
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

    // Get creator profile for name
    const profile = await db.profile.findUnique({ where: { userId } })
    const creatorName = profile?.displayName || 'Someone'

    // Build request link using PUBLIC_PAGE_URL for consistency with reminder emails
    const requestLink = `${env.PUBLIC_PAGE_URL}/r/${token}`

    // RETRY-SAFE: Send email BEFORE updating status
    // If email fails, status stays 'draft' and user can retry
    if (method === 'email' && request.recipientEmail) {
      await sendRequestEmail(
        request.recipientEmail,
        creatorName,
        request.message,
        requestLink
      )
    }

    // Update request AFTER successful email (or immediately for link method)
    // Store both hash (for lookup) and encrypted raw token (for reminder links)
    await db.request.update({
      where: { id },
      data: {
        status: 'sent',
        sendMethod: method,
        publicToken: encrypt(token),      // Store encrypted for reminder links
        publicTokenHash: tokenHash,       // Store hashed for lookup
        tokenExpiresAt,
        sentAt: new Date(),
      },
    })

    // Schedule follow-up reminders (24h, 72h, expiring, invoice due dates)
    await scheduleRequestReminders(id)

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

// Resend request (regenerate token, optionally resend email)
requests.post(
  '/:id/resend',
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

    // Only allow resending if still pending (sent status)
    // Don't resend completed, declined, or expired requests
    if (request.status !== 'sent') {
      return c.json({ error: 'Can only resend pending requests' }, 400)
    }

    // Rate limit resends: max 3 per request per day
    const resendRateLimitKey = `resend:${id}:${new Date().toISOString().slice(0, 10)}`
    const resendCount = await redis.incr(resendRateLimitKey)
    if (resendCount === 1) {
      await redis.expire(resendRateLimitKey, 86400)
    }
    if (resendCount > 3) {
      return c.json({ error: 'Too many resends for this request today' }, 429)
    }

    // Generate new public token
    const token = generateToken()
    const tokenHash = hashToken(token)
    const tokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

    // Get creator profile for name
    const profile = await db.profile.findUnique({ where: { userId } })
    const creatorName = profile?.displayName || 'Someone'

    // Build request link
    const requestLink = `${env.PUBLIC_PAGE_URL}/r/${token}`

    // Send email if method is email and recipient has email
    if (method === 'email' && request.recipientEmail) {
      await sendRequestEmail(
        request.recipientEmail,
        creatorName,
        request.message,
        requestLink
      )
    }

    // Update request with new token (extends expiry)
    await db.request.update({
      where: { id },
      data: {
        publicToken: encrypt(token),
        publicTokenHash: tokenHash,
        tokenExpiresAt,
      },
    })

    // Create activity
    await db.activity.create({
      data: {
        userId,
        type: 'request_resent',
        payload: {
          requestId: id,
          recipientName: request.recipientName,
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
