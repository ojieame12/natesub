/**
 * Admin Stripe Controller
 *
 * Stripe Connect visibility and management routes.
 * Includes: accounts, transfers, balance, events, payouts.
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/client.js'
import { stripe } from '../../services/stripe.js'
import { adminSensitiveRateLimit } from '../../middleware/rateLimit.js'
import { requireRole, requireFreshSession } from '../../middleware/adminAuth.js'

const stripeRoutes = new Hono()

// ============================================
// STRIPE CONNECT ACCOUNTS
// ============================================

/**
 * GET /admin/stripe/accounts
 * List all Stripe Connect accounts with their status
 */
stripeRoutes.get('/accounts', async (c) => {
  const query = z.object({
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(50),
    status: z.enum(['all', 'active', 'pending', 'restricted', 'disabled']).default('all')
  }).parse(c.req.query())

  const skip = (query.page - 1) * query.limit

  const profiles = await db.profile.findMany({
    where: {
      stripeAccountId: { not: null },
      ...(query.status !== 'all' && { payoutStatus: query.status })
    },
    skip,
    take: query.limit,
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { email: true, createdAt: true } }
    }
  })

  const accountsWithStripeData = await Promise.all(
    profiles.map(async (p) => {
      try {
        const account = await stripe.accounts.retrieve(p.stripeAccountId!)
        return {
          userId: p.userId,
          email: p.user.email,
          username: p.username,
          displayName: p.displayName,
          country: p.country,
          currency: p.currency,
          localPayoutStatus: p.payoutStatus,
          createdAt: p.createdAt,
          stripeAccountId: p.stripeAccountId,
          stripeStatus: {
            chargesEnabled: account.charges_enabled,
            payoutsEnabled: account.payouts_enabled,
            detailsSubmitted: account.details_submitted,
            type: account.type,
            country: account.country,
            defaultCurrency: account.default_currency,
            capabilities: account.capabilities,
            requirements: {
              currentlyDue: account.requirements?.currently_due || [],
              eventuallyDue: account.requirements?.eventually_due || [],
              pastDue: account.requirements?.past_due || [],
              pendingVerification: account.requirements?.pending_verification || [],
              disabledReason: account.requirements?.disabled_reason
            }
          }
        }
      } catch (err: any) {
        return {
          userId: p.userId,
          email: p.user.email,
          username: p.username,
          displayName: p.displayName,
          country: p.country,
          currency: p.currency,
          localPayoutStatus: p.payoutStatus,
          createdAt: p.createdAt,
          stripeAccountId: p.stripeAccountId,
          stripeStatus: null,
          stripeError: err.message
        }
      }
    })
  )

  const total = await db.profile.count({
    where: {
      stripeAccountId: { not: null },
      ...(query.status !== 'all' && { payoutStatus: query.status })
    }
  })

  return c.json({
    accounts: accountsWithStripeData,
    total,
    page: query.page,
    totalPages: Math.ceil(total / query.limit)
  })
})

/**
 * GET /admin/stripe/accounts/:accountId
 * Get detailed Stripe account info
 */
stripeRoutes.get('/accounts/:accountId', async (c) => {
  const { accountId } = c.req.param()

  try {
    const account = await stripe.accounts.retrieve(accountId)

    const profile = await db.profile.findFirst({
      where: { stripeAccountId: accountId },
      include: { user: { select: { email: true } } }
    })

    const balance = await stripe.balance.retrieve({ stripeAccount: accountId })
    const payouts = await stripe.payouts.list({ limit: 10 }, { stripeAccount: accountId })

    return c.json({
      local: profile ? {
        userId: profile.userId,
        email: profile.user.email,
        username: profile.username,
        displayName: profile.displayName,
        country: profile.country,
        currency: profile.currency,
        payoutStatus: profile.payoutStatus
      } : null,
      stripe: {
        id: account.id,
        type: account.type,
        country: account.country,
        defaultCurrency: account.default_currency,
        email: account.email,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
        created: account.created ? new Date(account.created * 1000).toISOString() : null,
        capabilities: account.capabilities,
        requirements: account.requirements,
        settings: {
          payoutSchedule: account.settings?.payouts?.schedule,
          statementDescriptor: account.settings?.payments?.statement_descriptor
        }
      },
      balance: {
        available: balance.available.map(b => ({ amount: b.amount, currency: b.currency })),
        pending: balance.pending.map(b => ({ amount: b.amount, currency: b.currency })),
        instantAvailable: balance.instant_available?.map(b => ({ amount: b.amount, currency: b.currency }))
      },
      recentPayouts: payouts.data.map(p => ({
        id: p.id,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        arrivalDate: new Date(p.arrival_date * 1000).toISOString(),
        created: new Date(p.created * 1000).toISOString(),
        method: p.method,
        type: p.type,
        failureCode: p.failure_code,
        failureMessage: p.failure_message
      }))
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// ============================================
// TRANSFERS & BALANCE
// ============================================

/**
 * GET /admin/stripe/transfers
 * List recent transfers to connected accounts
 */
stripeRoutes.get('/transfers', async (c) => {
  const query = z.object({
    limit: z.coerce.number().default(50),
    startingAfter: z.string().optional()
  }).parse(c.req.query())

  try {
    const transfers = await stripe.transfers.list({
      limit: query.limit,
      ...(query.startingAfter && { starting_after: query.startingAfter })
    })

    const destinationIds = [...new Set(transfers.data.map(t => t.destination as string))]
    const profiles = await db.profile.findMany({
      where: { stripeAccountId: { in: destinationIds } },
      select: { stripeAccountId: true, username: true, displayName: true, user: { select: { email: true } } }
    })
    const profileMap = new Map(profiles.map(p => [p.stripeAccountId, p]))

    return c.json({
      transfers: transfers.data.map(t => {
        const profile = profileMap.get(t.destination as string)
        return {
          id: t.id,
          amount: t.amount,
          currency: t.currency,
          created: new Date(t.created * 1000).toISOString(),
          destination: t.destination,
          destinationPayment: t.destination_payment,
          reversed: t.reversed,
          sourceTransaction: t.source_transaction,
          creator: profile ? {
            username: profile.username,
            displayName: profile.displayName,
            email: profile.user.email
          } : null
        }
      }),
      hasMore: transfers.has_more,
      nextCursor: transfers.data.length > 0 ? transfers.data[transfers.data.length - 1].id : null
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

/**
 * GET /admin/stripe/balance
 * Get platform Stripe balance
 */
stripeRoutes.get('/balance', async (c) => {
  try {
    const balance = await stripe.balance.retrieve()

    return c.json({
      available: balance.available.map(b => ({ amount: b.amount, currency: b.currency })),
      pending: balance.pending.map(b => ({ amount: b.amount, currency: b.currency })),
      connectReserved: balance.connect_reserved?.map(b => ({ amount: b.amount, currency: b.currency })),
      instantAvailable: balance.instant_available?.map(b => ({ amount: b.amount, currency: b.currency }))
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// ============================================
// EVENTS & CUSTOMERS
// ============================================

/**
 * GET /admin/stripe/events
 * List recent Stripe webhook events
 */
stripeRoutes.get('/events', async (c) => {
  const query = z.object({
    limit: z.coerce.number().default(50),
    type: z.string().optional(),
    startingAfter: z.string().optional()
  }).parse(c.req.query())

  try {
    const events = await stripe.events.list({
      limit: query.limit,
      ...(query.type && { type: query.type }),
      ...(query.startingAfter && { starting_after: query.startingAfter })
    })

    return c.json({
      events: events.data.map(e => ({
        id: e.id,
        type: e.type,
        created: new Date(e.created * 1000).toISOString(),
        livemode: e.livemode,
        pendingWebhooks: e.pending_webhooks,
        request: e.request,
        data: {
          objectType: (e.data.object as any)?.object,
          objectId: (e.data.object as any)?.id,
          amount: (e.data.object as any)?.amount,
          currency: (e.data.object as any)?.currency,
          status: (e.data.object as any)?.status,
          customer: (e.data.object as any)?.customer
        }
      })),
      hasMore: events.has_more,
      nextCursor: events.data.length > 0 ? events.data[events.data.length - 1].id : null
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

/**
 * GET /admin/stripe/customers/:customerId
 * Get Stripe customer details
 */
stripeRoutes.get('/customers/:customerId', async (c) => {
  const { customerId } = c.req.param()

  try {
    const customer = await stripe.customers.retrieve(customerId, {
      expand: ['subscriptions', 'sources', 'invoice_settings.default_payment_method']
    }) as any

    const subscription = await db.subscription.findFirst({
      where: { stripeCustomerId: customerId },
      include: {
        subscriber: { select: { email: true } },
        creator: { select: { email: true, profile: { select: { username: true } } } }
      }
    })

    return c.json({
      local: subscription ? {
        subscriptionId: subscription.id,
        subscriberEmail: subscription.subscriber?.email,
        creatorEmail: subscription.creator.email,
        creatorUsername: subscription.creator.profile?.username,
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd
      } : null,
      stripe: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        created: new Date(customer.created * 1000).toISOString(),
        currency: customer.currency,
        defaultPaymentMethod: customer.invoice_settings?.default_payment_method ? {
          id: customer.invoice_settings.default_payment_method.id,
          type: customer.invoice_settings.default_payment_method.type,
          card: customer.invoice_settings.default_payment_method.card ? {
            brand: customer.invoice_settings.default_payment_method.card.brand,
            last4: customer.invoice_settings.default_payment_method.card.last4,
            expMonth: customer.invoice_settings.default_payment_method.card.exp_month,
            expYear: customer.invoice_settings.default_payment_method.card.exp_year
          } : null
        } : null,
        subscriptions: customer.subscriptions?.data?.map((s: any) => ({
          id: s.id,
          status: s.status,
          currentPeriodEnd: new Date(s.current_period_end * 1000).toISOString(),
          cancelAtPeriodEnd: s.cancel_at_period_end,
          plan: s.items?.data?.[0]?.price ? {
            amount: s.items.data[0].price.unit_amount,
            currency: s.items.data[0].price.currency,
            interval: s.items.data[0].price.recurring?.interval
          } : null
        })) || []
      }
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// ============================================
// PAYOUT MANAGEMENT
// ============================================

/**
 * POST /admin/stripe/accounts/:accountId/payout
 * Trigger immediate payout to a connected account
 * Requires: super_admin
 */
stripeRoutes.post('/accounts/:accountId/payout', adminSensitiveRateLimit, requireRole('super_admin'), requireFreshSession, async (c) => {
  const { accountId } = c.req.param()
  const body = z.object({
    amount: z.number().optional(),
    currency: z.string().default('usd')
  }).parse(await c.req.json().catch(() => ({})))

  try {
    const balance = await stripe.balance.retrieve({ stripeAccount: accountId })
    const available = balance.available.find(b => b.currency === body.currency)

    if (!available || available.amount <= 0) {
      return c.json({ error: 'No available balance to payout' }, 400)
    }

    const amount = body.amount || available.amount

    const payout = await stripe.payouts.create({
      amount,
      currency: body.currency,
      method: 'standard'
    }, { stripeAccount: accountId })

    const profile = await db.profile.findFirst({
      where: { stripeAccountId: accountId }
    })
    if (profile) {
      await db.activity.create({
        data: {
          userId: profile.userId,
          type: 'admin_payout_triggered',
          payload: {
            payoutId: payout.id,
            amount: payout.amount,
            currency: payout.currency,
            adminId: c.get('adminUserId'),
            adminEmail: c.get('adminEmail')
          }
        }
      })
    }

    return c.json({
      success: true,
      payout: {
        id: payout.id,
        amount: payout.amount,
        currency: payout.currency,
        status: payout.status,
        arrivalDate: new Date(payout.arrival_date * 1000).toISOString()
      }
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

/**
 * POST /admin/stripe/accounts/:accountId/disable-payouts
 * Disable payouts for a connected account
 * Requires: super_admin
 */
stripeRoutes.post('/accounts/:accountId/disable-payouts', adminSensitiveRateLimit, requireRole('super_admin'), requireFreshSession, async (c) => {
  const { accountId } = c.req.param()
  const body = z.object({
    reason: z.string()
  }).parse(await c.req.json())

  try {
    await stripe.accounts.update(accountId, {
      settings: {
        payouts: { schedule: { interval: 'manual' as const } }
      }
    })

    await db.profile.updateMany({
      where: { stripeAccountId: accountId },
      data: { payoutStatus: 'disabled' }
    })

    const profile = await db.profile.findFirst({
      where: { stripeAccountId: accountId }
    })
    if (profile) {
      await db.activity.create({
        data: {
          userId: profile.userId,
          type: 'admin_payouts_disabled',
          payload: {
            reason: body.reason,
            adminId: c.get('adminUserId'),
            adminEmail: c.get('adminEmail')
          }
        }
      })
    }

    return c.json({ success: true, message: 'Payouts disabled for account' })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

/**
 * POST /admin/stripe/accounts/:accountId/enable-payouts
 * Re-enable payouts for a connected account
 * Requires: super_admin
 */
stripeRoutes.post('/accounts/:accountId/enable-payouts', adminSensitiveRateLimit, requireRole('super_admin'), requireFreshSession, async (c) => {
  const { accountId } = c.req.param()

  try {
    await stripe.accounts.update(accountId, {
      settings: {
        payouts: { schedule: { interval: 'daily' as const } }
      }
    })

    await db.profile.updateMany({
      where: { stripeAccountId: accountId },
      data: { payoutStatus: 'active' }
    })

    const profile = await db.profile.findFirst({
      where: { stripeAccountId: accountId }
    })
    if (profile) {
      await db.activity.create({
        data: {
          userId: profile.userId,
          type: 'admin_payouts_enabled',
          payload: {
            adminId: c.get('adminUserId'),
            adminEmail: c.get('adminEmail')
          }
        }
      })
    }

    return c.json({ success: true, message: 'Payouts enabled for account' })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

export default stripeRoutes
