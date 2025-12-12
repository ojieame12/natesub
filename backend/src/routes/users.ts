import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/client.js'

const users = new Hono()

// Get public profile by username (for vanity URLs)
users.get(
  '/:username',
  zValidator('param', z.object({
    username: z.string().min(3).max(20),
  })),
  async (c) => {
    const { username } = c.req.valid('param')
    const normalizedUsername = username.toLowerCase()

    const profile = await db.profile.findUnique({
      where: { username: normalizedUsername },
      select: {
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
        // Check payment readiness without exposing IDs
        stripeAccountId: true,
        paystackSubaccountCode: true,
        payoutStatus: true,
      },
    })

    if (!profile) {
      return c.json({ error: 'User not found' }, 404)
    }

    // Check if payments are ready (has provider connected AND is active)
    const hasPaymentProvider =
      (profile.paymentProvider === 'stripe' && profile.stripeAccountId) ||
      (profile.paymentProvider === 'paystack' && profile.paystackSubaccountCode)
    const paymentsReady = hasPaymentProvider && profile.payoutStatus === 'active'

    // Convert cents back to dollars for frontend
    // Don't expose sensitive IDs - only the computed paymentsReady flag
    const publicProfile = {
      username: profile.username,
      displayName: profile.displayName,
      bio: profile.bio,
      avatarUrl: profile.avatarUrl,
      voiceIntroUrl: profile.voiceIntroUrl,
      purpose: profile.purpose,
      pricingModel: profile.pricingModel,
      singleAmount: profile.singleAmount ? profile.singleAmount / 100 : null,
      tiers: profile.tiers ? (profile.tiers as any[]).map(t => ({
        ...t,
        amount: t.amount / 100,
      })) : null,
      perks: profile.perks,
      impactItems: profile.impactItems,
      currency: profile.currency,
      shareUrl: profile.shareUrl,
      paymentProvider: profile.paymentProvider,
      paymentsReady,
    }

    return c.json({ profile: publicProfile })
  }
)

export default users
