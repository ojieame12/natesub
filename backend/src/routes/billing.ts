// Billing Routes - Platform subscription management for service users
// Handles $5/mo subscription to Nate for service providers

import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth.js'
import { db } from '../db/client.js'
import { env } from '../config/env.js'
import {
  createPlatformCheckout,
  createPortalSession,
  getPlatformSubscriptionStatus,
} from '../services/platformSubscription.js'
import { requiresPlatformSubscription, type UserPurpose } from '../services/pricing.js'

const billing = new Hono()

// GET /billing/status - Get current subscription status
billing.get('/status', requireAuth, async (c) => {
  const userId = c.get('userId')

  // Check if user needs platform subscription
  const profile = await db.profile.findUnique({
    where: { userId },
    select: {
      purpose: true,
      platformDebitCents: true,
    },
  })

  const needsSubscription = requiresPlatformSubscription(profile?.purpose as UserPurpose)

  if (!needsSubscription) {
    return c.json({
      plan: 'personal',
      subscriptionRequired: false,
      subscription: null,
      debit: null,
    })
  }

  const subscription = await getPlatformSubscriptionStatus(userId)

  // Calculate debit info
  const debitCents = profile?.platformDebitCents || 0
  const PLATFORM_DEBIT_CAP_CENTS = 3000 // $30

  return c.json({
    plan: 'service',
    subscriptionRequired: true,
    subscription: {
      status: subscription.status,
      subscriptionId: subscription.subscriptionId,
      currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() || null,
      trialEndsAt: subscription.trialEndsAt?.toISOString() || null,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    },
    // Platform debit info (for service providers with lapsed subscriptions)
    debit: debitCents > 0 ? {
      amountCents: debitCents,
      amountDisplay: `$${(debitCents / 100).toFixed(2)}`,
      willRecoverFromNextPayment: true,
      atCapLimit: debitCents >= PLATFORM_DEBIT_CAP_CENTS,
      message: debitCents >= PLATFORM_DEBIT_CAP_CENTS
        ? 'Platform balance reached maximum. Please update your payment method to continue accepting payments.'
        : 'This balance will be recovered from your next client payment.',
    } : null,
  })
})

// POST /billing/checkout - Create checkout session for platform subscription
billing.post('/checkout', requireAuth, async (c) => {
  const userId = c.get('userId')

  // Get user info
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: { select: { purpose: true } } },
  })

  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }

  // Verify user is a service provider
  if (!requiresPlatformSubscription(user.profile?.purpose as UserPurpose)) {
    return c.json({ error: 'Platform subscription is only for service providers' }, 400)
  }

  try {
    const { url, sessionId } = await createPlatformCheckout(
      userId,
      user.email,
      `${env.APP_URL}/settings/billing?success=true`,
      `${env.APP_URL}/settings/billing`
    )

    return c.json({ url, sessionId })
  } catch (error: any) {
    if (error.message === 'Already subscribed to platform') {
      return c.json({ error: error.message }, 400)
    }
    console.error('[billing] Checkout error:', error)
    return c.json({ error: 'Failed to create checkout session' }, 500)
  }
})

// POST /billing/portal - Create customer portal session for managing subscription
billing.post('/portal', requireAuth, async (c) => {
  const userId = c.get('userId')

  try {
    const { url } = await createPortalSession(
      userId,
      `${env.APP_URL}/settings/billing`
    )

    return c.json({ url })
  } catch (error: any) {
    if (error.message === 'No platform customer found') {
      return c.json({ error: 'No subscription found to manage' }, 400)
    }
    console.error('[billing] Portal error:', error)
    return c.json({ error: 'Failed to create portal session' }, 500)
  }
})

export default billing
