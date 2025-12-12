import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '../db/client.js'
import { requireAuth } from '../middleware/auth.js'
import { sendWelcomeEmail } from '../services/email.js'
import { RESERVED_USERNAMES } from '../utils/constants.js'
import {
  getPlatformFeePercent,
  getProcessingFeePercent,
  PLATFORM_SUBSCRIPTION_PRICE_CENTS,
  requiresPlatformSubscription,
  type UserPurpose,
} from '../services/pricing.js'

const profile = new Hono()

// Tier schema
const tierSchema = z.object({
  id: z.string(),
  name: z.string(),
  amount: z.number().positive(),
  perks: z.array(z.string()),
  isPopular: z.boolean().optional(),
})

// Perk schema
const perkSchema = z.object({
  id: z.string(),
  title: z.string(),
  enabled: z.boolean(),
})

// Impact item schema
const impactItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
})

// Profile create/update schema
const profileSchema = z.object({
  username: z.string().min(3).max(20).regex(/^[a-z0-9_]+$/),
  displayName: z.string().min(2).max(50),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional().nullable(),
  voiceIntroUrl: z.string().url().optional().nullable(),
  country: z.string(),
  countryCode: z.string().length(2),
  currency: z.string().length(3).default('USD'),
  purpose: z.enum(['tips', 'support', 'allowance', 'fan_club', 'exclusive_content', 'service', 'other']),
  pricingModel: z.enum(['single', 'tiers']),
  singleAmount: z.number().positive().optional().nullable(),
  tiers: z.array(tierSchema).optional().nullable(),
  perks: z.array(perkSchema).optional().nullable(),
  impactItems: z.array(impactItemSchema).optional().nullable(),
  paymentProvider: z.enum(['stripe', 'flutterwave', 'bank']).optional().nullable(),
  template: z.enum(['boundary', 'minimal', 'editorial']).optional(),
})

// Get own profile
profile.get('/', requireAuth, async (c) => {
  const userId = c.get('userId')

  const userProfile = await db.profile.findUnique({
    where: { userId },
  })

  if (!userProfile) {
    return c.json({ profile: null })
  }

  return c.json({ profile: userProfile })
})

// Create or update profile
profile.put(
  '/',
  requireAuth,
  zValidator('json', profileSchema),
  async (c) => {
    const userId = c.get('userId')
    const data = c.req.valid('json')

    // Check if username is reserved
    if (RESERVED_USERNAMES.includes(data.username.toLowerCase())) {
      return c.json({ error: 'This username is not available' }, 400)
    }

    // Check if username is taken by someone else
    const existingProfile = await db.profile.findUnique({
      where: { username: data.username },
    })

    if (existingProfile && existingProfile.userId !== userId) {
      return c.json({ error: 'This username is already taken' }, 400)
    }

    // Get user email for welcome email
    const user = await db.user.findUnique({ where: { id: userId } })

    // Check if this is a new profile
    const currentProfile = await db.profile.findUnique({ where: { userId } })
    const isNewProfile = !currentProfile

    // Convert amounts to cents for storage
    // Use Prisma.JsonNull for null JSON values, or the actual value
    const tiersData = data.tiers
      ? data.tiers.map(t => ({ ...t, amount: Math.round(t.amount * 100) }))
      : Prisma.JsonNull
    const perksData = data.perks || Prisma.JsonNull
    const impactItemsData = data.impactItems || Prisma.JsonNull

    const profileData = {
      userId,
      username: data.username.toLowerCase(),
      displayName: data.displayName,
      bio: data.bio || null,
      avatarUrl: data.avatarUrl || null,
      voiceIntroUrl: data.voiceIntroUrl || null,
      country: data.country,
      countryCode: data.countryCode.toUpperCase(),
      currency: data.currency.toUpperCase(),
      purpose: data.purpose,
      pricingModel: data.pricingModel,
      singleAmount: data.singleAmount ? Math.round(data.singleAmount * 100) : null,
      tiers: tiersData,
      perks: perksData,
      impactItems: impactItemsData,
      paymentProvider: data.paymentProvider || null,
      template: data.template || 'boundary',
      shareUrl: `https://natepay.co/${data.username.toLowerCase()}`,
    }

    // Upsert profile
    const updatedProfile = await db.profile.upsert({
      where: { userId },
      create: profileData,
      update: profileData,
    })

    // Send welcome email for new profiles
    if (isNewProfile && user) {
      await sendWelcomeEmail(user.email, data.displayName)
    }

    return c.json({ profile: updatedProfile })
  }
)

// Get onboarding status
profile.get('/onboarding-status', requireAuth, async (c) => {
  const userId = c.get('userId')

  const userProfile = await db.profile.findUnique({
    where: { userId },
  })

  // Define onboarding steps and their completion status
  const steps = {
    profile: {
      completed: !!userProfile,
      fields: {
        username: !!userProfile?.username,
        displayName: !!userProfile?.displayName,
        country: !!userProfile?.country,
        purpose: !!userProfile?.purpose,
        pricing: !!userProfile?.pricingModel && (
          userProfile.pricingModel === 'single'
            ? !!userProfile.singleAmount
            : !!(userProfile.tiers as any[])?.length
        ),
      },
    },
    payments: {
      completed: userProfile?.payoutStatus === 'active',
      status: userProfile?.payoutStatus || 'not_started',
      stripeAccountId: userProfile?.stripeAccountId || null,
    },
  }

  // Calculate overall progress
  const profileFields = Object.values(steps.profile.fields)
  const profileProgress = profileFields.filter(Boolean).length / profileFields.length
  const paymentsProgress = steps.payments.completed ? 1 : (steps.payments.stripeAccountId ? 0.5 : 0)

  const overallProgress = (profileProgress * 0.6) + (paymentsProgress * 0.4) // 60% profile, 40% payments

  return c.json({
    steps,
    progress: {
      profile: Math.round(profileProgress * 100),
      payments: Math.round(paymentsProgress * 100),
      overall: Math.round(overallProgress * 100),
    },
    isComplete: steps.profile.completed && steps.payments.completed,
    canAcceptPayments: steps.payments.completed,
    nextStep: !steps.profile.completed
      ? 'profile'
      : !steps.payments.completed
        ? 'payments'
        : null,
  })
})

// Notification preferences schema
const notificationPrefsSchema = z.object({
  push: z.boolean(),
  email: z.boolean(),
  subscriberAlerts: z.boolean(),
  paymentAlerts: z.boolean(),
})

// Settings update schema (partial updates)
const settingsSchema = z.object({
  notificationPrefs: notificationPrefsSchema.optional(),
  isPublic: z.boolean().optional(),
})

// Update settings (notification prefs, visibility)
profile.patch(
  '/settings',
  requireAuth,
  zValidator('json', settingsSchema),
  async (c) => {
    const userId = c.get('userId')
    const data = c.req.valid('json')

    // Ensure profile exists
    const existingProfile = await db.profile.findUnique({ where: { userId } })
    if (!existingProfile) {
      return c.json({ error: 'Profile not found. Complete onboarding first.' }, 404)
    }

    // Build update object
    const updateData: any = {}
    if (data.notificationPrefs !== undefined) {
      updateData.notificationPrefs = data.notificationPrefs
    }
    if (data.isPublic !== undefined) {
      updateData.isPublic = data.isPublic
    }

    const updatedProfile = await db.profile.update({
      where: { userId },
      data: updateData,
    })

    return c.json({
      success: true,
      settings: {
        notificationPrefs: updatedProfile.notificationPrefs,
        isPublic: updatedProfile.isPublic,
      },
    })
  }
)

// Get settings
profile.get('/settings', requireAuth, async (c) => {
  const userId = c.get('userId')

  const userProfile = await db.profile.findUnique({
    where: { userId },
    select: {
      notificationPrefs: true,
      isPublic: true,
    },
  })

  // Return defaults if profile doesn't exist
  const defaultPrefs = {
    push: true,
    email: true,
    subscriberAlerts: true,
    paymentAlerts: true,
  }

  return c.json({
    notificationPrefs: userProfile?.notificationPrefs || defaultPrefs,
    isPublic: userProfile?.isPublic ?? true,
  })
})

// Check username availability
profile.get(
  '/check-username/:username',
  zValidator('param', z.object({
    username: z.string().min(3).max(20),
  })),
  async (c) => {
    const { username } = c.req.valid('param')
    const normalizedUsername = username.toLowerCase()

    // Check reserved
    if (RESERVED_USERNAMES.includes(normalizedUsername)) {
      return c.json({ available: false, reason: 'reserved' })
    }

    // Check format
    if (!/^[a-z0-9_]+$/.test(normalizedUsername)) {
      return c.json({ available: false, reason: 'invalid_format' })
    }

    // Check taken
    const existing = await db.profile.findUnique({
      where: { username: normalizedUsername },
    })

    if (existing) {
      return c.json({ available: false, reason: 'taken' })
    }

    return c.json({ available: true })
  }
)

// Get pricing info for current user
// Returns fee schedule based on user's purpose (personal vs service)
profile.get('/pricing', requireAuth, async (c) => {
  const userId = c.get('userId')

  const userProfile = await db.profile.findUnique({
    where: { userId },
    select: { purpose: true },
  })

  const purpose = userProfile?.purpose as UserPurpose | null
  const platformFeeBps = getPlatformFeePercent(purpose) * 100 // Convert to basis points
  const processingFeeBps = getProcessingFeePercent() * 100

  return c.json({
    plan: requiresPlatformSubscription(purpose) ? 'service' : 'personal',
    fees: {
      platformFeeBps, // e.g., 800 = 8%, 1000 = 10%
      processingFeeBps, // e.g., 200 = 2%
      totalFeeBps: platformFeeBps + processingFeeBps,
      platformFeePercent: getPlatformFeePercent(purpose),
      processingFeePercent: getProcessingFeePercent(),
      totalFeePercent: getPlatformFeePercent(purpose) + getProcessingFeePercent(),
    },
    subscription: requiresPlatformSubscription(purpose) ? {
      priceCents: PLATFORM_SUBSCRIPTION_PRICE_CENTS,
      interval: 'month',
      currency: 'USD',
    } : null,
  })
})

// Get pricing info for a specific plan (public endpoint for comparison)
profile.get('/pricing/:plan', async (c) => {
  const plan = c.req.param('plan') as 'personal' | 'service'

  if (!['personal', 'service'].includes(plan)) {
    return c.json({ error: 'Invalid plan. Must be "personal" or "service"' }, 400)
  }

  const purpose: UserPurpose = plan === 'service' ? 'service' : 'personal'
  const platformFeeBps = getPlatformFeePercent(purpose) * 100
  const processingFeeBps = getProcessingFeePercent() * 100

  return c.json({
    plan,
    fees: {
      platformFeeBps,
      processingFeeBps,
      totalFeeBps: platformFeeBps + processingFeeBps,
      platformFeePercent: getPlatformFeePercent(purpose),
      processingFeePercent: getProcessingFeePercent(),
      totalFeePercent: getPlatformFeePercent(purpose) + getProcessingFeePercent(),
    },
    subscription: plan === 'service' ? {
      priceCents: PLATFORM_SUBSCRIPTION_PRICE_CENTS,
      interval: 'month',
      currency: 'USD',
    } : null,
  })
})

export default profile
