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
        // Don't expose: userId, stripeAccountId, payoutStatus, etc.
      },
    })

    if (!profile) {
      return c.json({ error: 'User not found' }, 404)
    }

    // Convert cents back to dollars for frontend
    const publicProfile = {
      ...profile,
      singleAmount: profile.singleAmount ? profile.singleAmount / 100 : null,
      tiers: profile.tiers ? (profile.tiers as any[]).map(t => ({
        ...t,
        amount: t.amount / 100,
      })) : null,
    }

    return c.json({ profile: publicProfile })
  }
)

export default users
