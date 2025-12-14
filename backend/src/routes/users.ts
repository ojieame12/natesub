import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/client.js'
import { optionalAuth } from '../middleware/auth.js'
import { publicRateLimit } from '../middleware/rateLimit.js'
import { centsToDisplayAmount } from '../utils/currency.js'

const users = new Hono()

// Get public profile by username (for vanity URLs)
// Optionally includes viewer's subscription status if authenticated
users.get(
  '/:username',
  publicRateLimit,
  optionalAuth,
  zValidator('param', z.object({
    username: z.string().min(3).max(20),
  })),
  async (c) => {
    const { username } = c.req.valid('param')
    const normalizedUsername = username.toLowerCase()
    const viewerId = c.get('userId') // Optional - set by optionalAuth if logged in

    const profile = await db.profile.findUnique({
      where: { username: normalizedUsername },
      select: {
        id: true, // Profile ID for analytics
        userId: true, // Need this to check subscriptions
        username: true,
        displayName: true,
        bio: true,
        avatarUrl: true,
        voiceIntroUrl: true,
        purpose: true,
        pricingModel: true,
        singleAmount: true,
        tiers: true,
        perks: true,
        impactItems: true,
        currency: true,
        shareUrl: true,
        paymentProvider: true,
        template: true, // For rendering correct template
        feeMode: true, // For fee breakdown display
        // Check payment readiness without exposing IDs
        stripeAccountId: true,
        paystackSubaccountCode: true,
        payoutStatus: true,
        platformDebitCents: true,
      },
    })

    if (!profile) {
      return c.json({ error: 'User not found' }, 404)
    }

    // Check if payments are ready (has provider connected AND is active)
    const hasPaymentProvider =
      (profile.paymentProvider === 'stripe' && profile.stripeAccountId) ||
      (profile.paymentProvider === 'paystack' && profile.paystackSubaccountCode)

    // Service providers blocked only if debit exceeds cap ($30)
    const PLATFORM_DEBIT_CAP_CENTS = 3000
    const underDebitCap = profile.purpose !== 'service' ||
      (profile.platformDebitCents || 0) < PLATFORM_DEBIT_CAP_CENTS

    const paymentsReady = hasPaymentProvider && profile.payoutStatus === 'active' && underDebitCap

    // Check if viewer is subscribed to this creator (if logged in)
    let viewerSubscription: {
      isActive: boolean
      tierName: string | null
      amount: number
      currency: string
      since: string
      currentPeriodEnd: string | null
    } | null = null

    if (viewerId && viewerId !== profile.userId) {
      // Don't check if viewing own profile
      // Only check for recurring subscriptions (not one-time payments)
      const subscription = await db.subscription.findFirst({
        where: {
          subscriberId: viewerId,
          creatorId: profile.userId,
          status: 'active',
          interval: 'month', // Only recurring subscriptions count as "subscribed"
        },
        select: {
          tierName: true,
          amount: true,
          currency: true,
          createdAt: true,
          currentPeriodEnd: true,
        },
        orderBy: { createdAt: 'desc' },
      })

      if (subscription) {
        viewerSubscription = {
          isActive: true,
          tierName: subscription.tierName,
          amount: centsToDisplayAmount(subscription.amount, subscription.currency),
          currency: subscription.currency,
          since: subscription.createdAt.toISOString(),
          currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() || null,
        }
      }
    }

    // Convert cents to display amount, handling zero-decimal currencies
    // Include profile ID for analytics, template for rendering, feeMode for fee display
    const currency = profile.currency || 'USD'
    const publicProfile = {
      id: profile.id, // For analytics tracking
      username: profile.username,
      displayName: profile.displayName,
      bio: profile.bio,
      avatarUrl: profile.avatarUrl,
      voiceIntroUrl: profile.voiceIntroUrl,
      purpose: profile.purpose,
      pricingModel: profile.pricingModel,
      singleAmount: profile.singleAmount ? centsToDisplayAmount(profile.singleAmount, currency) : null,
      tiers: profile.tiers ? (profile.tiers as any[]).map(t => ({
        ...t,
        amount: centsToDisplayAmount(t.amount, currency),
      })) : null,
      perks: profile.perks,
      impactItems: profile.impactItems,
      currency: currency,
      shareUrl: profile.shareUrl,
      paymentProvider: profile.paymentProvider,
      template: profile.template || 'boundary', // Default to boundary
      feeMode: profile.feeMode || 'pass_to_subscriber', // Default behavior
      paymentsReady,
    }

    return c.json({
      profile: publicProfile,
      viewerSubscription, // null if not logged in or not subscribed
    })
  }
)

export default users
