import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/client.js'
import { optionalAuth } from '../middleware/auth.js'
import { publicRateLimit } from '../middleware/rateLimit.js'
import { centsToDisplayAmount } from '../utils/currency.js'
import { isStripeCrossBorderSupported } from '../utils/constants.js'

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
        countryCode: true, // For cross-border detection
        isPublic: true, // Privacy setting
        // Check payment readiness without exposing IDs
        stripeAccountId: true,
        paystackSubaccountCode: true,
        payoutStatus: true,
        platformDebitCents: true,
        platformSubscriptionStatus: true, // Service providers need active subscription
      },
    })

    if (!profile) {
      return c.json({ error: 'User not found' }, 404)
    }

    const isOwner = Boolean(viewerId && viewerId === profile.userId)

    // Enforce privacy setting - only show profile if public or viewer is the owner
    if (profile.isPublic === false && !isOwner) {
      return c.json({ error: 'This profile is private' }, 403)
    }

    // Infer payment provider for older/newer profiles where the field may be null.
    // Stripe/Paystack connection records live on the profile, so presence of IDs is authoritative.
    const inferredPaymentProvider =
      profile.paymentProvider ||
      (profile.stripeAccountId ? 'stripe' : profile.paystackSubaccountCode ? 'paystack' : null)

    // Check if payments are ready (has provider connected AND is active)
    const hasPaymentProvider =
      (inferredPaymentProvider === 'stripe' && profile.stripeAccountId) ||
      (inferredPaymentProvider === 'paystack' && profile.paystackSubaccountCode)

    // Service providers must have active/trialing platform subscription
    const validSubStatuses = ['trialing', 'active']
    const hasValidSubscription = profile.purpose !== 'service' ||
      validSubStatuses.includes(profile.platformSubscriptionStatus || '')

    // Service providers blocked only if debit exceeds cap ($30)
    const PLATFORM_DEBIT_CAP_CENTS = 3000
    const underDebitCap = profile.purpose !== 'service' ||
      (profile.platformDebitCents || 0) < PLATFORM_DEBIT_CAP_CENTS

    const paymentsReady = hasPaymentProvider && profile.payoutStatus === 'active' && underDebitCap && hasValidSubscription

    // Check if viewer is subscribed to this creator (if logged in)
    let viewerSubscription: {
      isActive: boolean
      tierName: string | null
      amount: number
      currency: string
      since: string
      currentPeriodEnd: string | null
    } | null = null

    if (viewerId && !isOwner) {
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

    // Check if this is a cross-border Stripe account (e.g., Nigeria)
    // Cross-border accounts collect payments in USD, payouts convert to local currency
    const isCrossBorder = inferredPaymentProvider === 'stripe' &&
      isStripeCrossBorderSupported(profile.countryCode)

    // Convert cents to display amount, handling zero-decimal currencies
    // Include profile ID for analytics, template for rendering, feeMode for fee display
    // Cross-border accounts: display prices in USD (what subscribers pay)
    const profileCurrency = profile.currency || 'USD'
    const displayCurrency = isCrossBorder ? 'USD' : profileCurrency

    const publicProfile = {
      id: profile.id, // For analytics tracking
      username: profile.username,
      displayName: profile.displayName,
      bio: profile.bio,
      avatarUrl: profile.avatarUrl,
      voiceIntroUrl: profile.voiceIntroUrl,
      purpose: profile.purpose,
      pricingModel: profile.pricingModel,
      singleAmount: profile.singleAmount ? centsToDisplayAmount(profile.singleAmount, displayCurrency) : null,
      tiers: profile.tiers ? (profile.tiers as any[]).map(t => ({
        ...t,
        amount: centsToDisplayAmount(t.amount, displayCurrency),
      })) : null,
      perks: profile.perks,
      impactItems: profile.impactItems,
      currency: displayCurrency, // Use checkout currency (USD for cross-border)
      shareUrl: profile.shareUrl,
      paymentProvider: inferredPaymentProvider,
      // Normalize legacy 'liquid' template to 'midnight' for frontend consistency
      template: (profile.template === 'liquid' ? 'midnight' : profile.template) || 'boundary',
      feeMode: profile.feeMode || 'pass_to_subscriber', // Default behavior
      paymentsReady,
      crossBorder: isCrossBorder, // Flag for frontend to show cross-border info
    }

    return c.json({
      profile: publicProfile,
      viewerSubscription, // null if not logged in or not subscribed
      isOwner,
    })
  }
)

export default users
