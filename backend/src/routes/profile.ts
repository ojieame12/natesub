import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '../db/client.js'
import { env } from '../config/env.js'
import { requireAuth } from '../middleware/auth.js'
import { publicStrictRateLimit, publicRateLimit } from '../middleware/rateLimit.js'
import { sendWelcomeEmail } from '../services/email.js'
import { cancelOnboardingReminders } from '../jobs/reminders.js'
import { RESERVED_USERNAMES } from '../utils/constants.js'
import { displayAmountToCents } from '../utils/currency.js'
import {
  getPlatformFeePercent,
  getProcessingFeePercent,
  PLATFORM_SUBSCRIPTION_PRICE_CENTS,
  requiresPlatformSubscription,
  type UserPurpose,
} from '../services/pricing.js'
import { startPlatformTrial } from '../services/platformSubscription.js'

const profile = new Hono()

// Tier schema
const tierSchema = z.object({
  id: z.string().max(50),
  name: z.string().min(1).max(50),
  amount: z.number().positive().max(100000), // Max $100k per tier
  perks: z.array(z.string().max(200)).max(20),
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

// URL validator - only accepts http(s) URLs
// Data URLs are rejected to prevent DB bloat and enforce proper upload flow
const httpsUrl = z.string().refine(
  (val) => {
    if (!val) return true
    try {
      const url = new URL(val)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  },
  { message: 'Must be a valid HTTP(S) URL' }
)

// Profile create/update schema
const templateSchema = z.enum(['boundary', 'midnight', 'liquid', 'minimal', 'editorial'])

const profileSchema = z.object({
  username: z.string().min(3).max(20).regex(/^[a-z0-9_]+$/),
  displayName: z.string().min(2).max(50),
  bio: z.string().max(500).optional().nullable(),
  avatarUrl: httpsUrl.optional().nullable(),
  voiceIntroUrl: httpsUrl.optional().nullable(),
  country: z.string(),
  countryCode: z.string().length(2),
  currency: z.string().length(3).default('USD'),
  purpose: z.enum(['tips', 'support', 'allowance', 'fan_club', 'exclusive_content', 'service', 'other']),
  pricingModel: z.enum(['single', 'tiers']),
  singleAmount: z.number().positive().max(100000).optional().nullable(), // Max $100k
  tiers: z.array(tierSchema).optional().nullable(),
  perks: z.array(perkSchema).optional().nullable(),
  impactItems: z.array(impactItemSchema).optional().nullable(),
  paymentProvider: z.enum(['stripe', 'paystack', 'flutterwave']).optional().nullable(),
  template: templateSchema.optional(),
  feeMode: z.enum(['absorb', 'pass_to_subscriber']).optional(),
  // Address fields
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  zip: z.string().optional().nullable(),
})

const profilePatchSchema = profileSchema
  .partial()
  .extend({
    // Allow explicitly clearing JSON fields with null
    tiers: z.array(tierSchema).optional().nullable(),
    perks: z.array(perkSchema).optional().nullable(),
    impactItems: z.array(impactItemSchema).optional().nullable(),
    template: templateSchema.optional(),
  })

type TemplateId = z.infer<typeof templateSchema>

function normalizeTemplate(template: TemplateId | null | undefined): Exclude<TemplateId, 'liquid'> | null {
  if (!template) return null
  if (template === 'liquid') return 'midnight'
  return template
}

// Get own profile
profile.get('/', requireAuth, async (c) => {
  const userId = c.get('userId')

  const userProfile = await db.profile.findUnique({
    where: { userId },
  })

  if (!userProfile) {
    return c.json({ profile: null })
  }

  return c.json({
    profile: {
      ...userProfile,
      template: normalizeTemplate(userProfile.template as any) || 'boundary',
    },
  })
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

    // Normalize currency for consistent handling
    const currency = data.currency.toUpperCase()

    // Convert amounts to cents for storage (handles zero-decimal currencies like JPY, KRW)
    // Use Prisma.JsonNull for null JSON values, or the actual value
    const tiersData = data.tiers
      ? data.tiers.map(t => ({ ...t, amount: displayAmountToCents(t.amount, currency) }))
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
      currency,
      purpose: data.purpose,
      pricingModel: data.pricingModel,
      singleAmount: data.singleAmount ? displayAmountToCents(data.singleAmount, currency) : null,
      tiers: tiersData,
      perks: perksData,
      impactItems: impactItemsData,
      paymentProvider: data.paymentProvider || null,
      template: normalizeTemplate(data.template) || 'boundary',
      feeMode: data.feeMode || 'pass_to_subscriber', // Default: subscriber pays fee
      shareUrl: `${env.PUBLIC_PAGE_URL || 'https://natepay.co'}/${data.username.toLowerCase()}`,
      address: data.address || null,
      city: data.city || null,
      state: data.state || null,
      zip: data.zip || null,
    }

    // Upsert profile
    const updatedProfile = await db.profile.upsert({
      where: { userId },
      create: profileData,
      update: profileData,
    })

    // Send welcome email for new profiles and clean up onboarding state
    if (isNewProfile && user) {
      await sendWelcomeEmail(user.email, data.displayName)
      // Cancel any pending onboarding reminders (legacy: only scheduled for users without profiles)
      await cancelOnboardingReminders(userId)
    }

    // Auto-start platform trial for service users
    // This makes their page "live" immediately without requiring separate subscription checkout
    // The startPlatformTrial function is idempotent - skips if already subscribed
    if (data.purpose === 'service' && user) {
      try {
        const trialId = await startPlatformTrial(userId, user.email)
        if (trialId) {
          console.log(`[profile] Started platform trial ${trialId} for service user ${userId}`)
        }
      } catch (err) {
        // Log but don't fail profile creation - they can subscribe later
        console.error(`[profile] Failed to start platform trial for ${userId}:`, err)
      }
    }

    return c.json({ profile: updatedProfile })
  }
)

// Partially update profile (used for Templates/Edit Page/Address updates)
profile.patch(
  '/',
  requireAuth,
  zValidator('json', profilePatchSchema),
  async (c) => {
    const userId = c.get('userId')
    const data = c.req.valid('json')

    // Ensure profile exists (profile creation must go through PUT /profile)
    const existingProfile = await db.profile.findUnique({ where: { userId } })
    if (!existingProfile) {
      return c.json({ error: 'Profile not found. Complete onboarding first.' }, 404)
    }

    if (Object.keys(data).length === 0) {
      return c.json({ error: 'No updates provided' }, 400)
    }

    const updateData: Prisma.ProfileUpdateInput = {}

    // Username changes require reserved + uniqueness checks
    if (data.username !== undefined) {
      const normalizedUsername = data.username.toLowerCase()

      if (RESERVED_USERNAMES.includes(normalizedUsername)) {
        return c.json({ error: 'This username is not available' }, 400)
      }

      const usernameOwner = await db.profile.findUnique({
        where: { username: normalizedUsername },
        select: { userId: true },
      })

      if (usernameOwner && usernameOwner.userId !== userId) {
        return c.json({ error: 'This username is already taken' }, 400)
      }

      updateData.username = normalizedUsername
      updateData.shareUrl = `${env.PUBLIC_PAGE_URL || 'https://natepay.co'}/${normalizedUsername}`
    }

    if (data.displayName !== undefined) updateData.displayName = data.displayName
    if (data.bio !== undefined) updateData.bio = data.bio || null
    if (data.avatarUrl !== undefined) updateData.avatarUrl = data.avatarUrl || null
    if (data.voiceIntroUrl !== undefined) updateData.voiceIntroUrl = data.voiceIntroUrl || null
    if (data.country !== undefined) updateData.country = data.country
    if (data.countryCode !== undefined) updateData.countryCode = data.countryCode.toUpperCase()
    if (data.currency !== undefined) updateData.currency = data.currency.toUpperCase()
    if (data.purpose !== undefined) updateData.purpose = data.purpose
    if (data.pricingModel !== undefined) updateData.pricingModel = data.pricingModel
    if (data.paymentProvider !== undefined) updateData.paymentProvider = data.paymentProvider || null
    if (data.feeMode !== undefined) updateData.feeMode = data.feeMode

    // Address fields
    if (data.address !== undefined) updateData.address = data.address || null
    if (data.city !== undefined) updateData.city = data.city || null
    if (data.state !== undefined) updateData.state = data.state || null
    if (data.zip !== undefined) updateData.zip = data.zip || null

    // Template (normalize legacy 'liquid' -> 'midnight')
    if (data.template !== undefined) {
      updateData.template = normalizeTemplate(data.template) || 'boundary'
    }

    // Amount conversion depends on currency (use updated currency if provided)
    const currency = (data.currency || existingProfile.currency || 'USD').toUpperCase()

    if (data.singleAmount !== undefined) {
      updateData.singleAmount = data.singleAmount === null
        ? null
        : displayAmountToCents(data.singleAmount, currency)
    }

    if (data.tiers !== undefined) {
      updateData.tiers = data.tiers === null
        ? Prisma.JsonNull
        : data.tiers.map(t => ({ ...t, amount: displayAmountToCents(t.amount, currency) }))
    }

    if (data.perks !== undefined) {
      updateData.perks = data.perks === null ? Prisma.JsonNull : data.perks
    }

    if (data.impactItems !== undefined) {
      updateData.impactItems = data.impactItems === null ? Prisma.JsonNull : data.impactItems
    }

    const updatedProfile = await db.profile.update({
      where: { userId },
      data: updateData,
    })

    return c.json({
      profile: {
        ...updatedProfile,
        template: normalizeTemplate(updatedProfile.template as any) || 'boundary',
      },
    })
  }
)

// Get onboarding status
profile.get('/onboarding-status', requireAuth, async (c) => {
  const userId = c.get('userId')

  const userProfile = await db.profile.findUnique({
    where: { userId },
  })

  // Check if user is a service provider (needs platform subscription)
  const isServiceProvider = userProfile?.purpose === 'service'
  const validSubscriptionStatuses = ['active', 'trialing']
  const hasActiveSubscription = userProfile?.platformSubscriptionStatus &&
    validSubscriptionStatuses.includes(userProfile.platformSubscriptionStatus)

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
      // Payment setup is complete only when Stripe/Paystack is active
      completed: userProfile?.payoutStatus === 'active',
      status: userProfile?.payoutStatus || 'not_started',
      stripeAccountId: userProfile?.stripeAccountId || null,
    },
    // Platform subscription step (only for service providers)
    ...(isServiceProvider && {
      subscription: {
        required: true,
        completed: hasActiveSubscription,
        status: userProfile?.platformSubscriptionStatus || null,
        trialEndsAt: userProfile?.platformTrialEndsAt?.toISOString() || null,
      },
    }),
  }

  // Calculate overall progress
  const profileFields = Object.values(steps.profile.fields)
  const profileProgress = profileFields.filter(Boolean).length / profileFields.length
  const paymentsProgress = steps.payments.completed ? 1 : (steps.payments.stripeAccountId ? 0.5 : 0)

  // Service providers have 3 steps, personal users have 2
  let overallProgress: number
  if (isServiceProvider) {
    const subscriptionProgress = hasActiveSubscription ? 1 : 0
    overallProgress = (profileProgress * 0.4) + (paymentsProgress * 0.3) + (subscriptionProgress * 0.3)
  } else {
    overallProgress = (profileProgress * 0.6) + (paymentsProgress * 0.4)
  }

  // Service providers can only accept payments if they have active subscription
  const canAcceptPayments = userProfile?.payoutStatus === 'active' &&
    (!isServiceProvider || hasActiveSubscription)

  // Determine completion and next step
  const baseComplete = steps.profile.completed && steps.payments.completed
  const isComplete = isServiceProvider ? (baseComplete && hasActiveSubscription) : baseComplete

  let nextStep: string | null = null
  if (!steps.profile.completed) {
    nextStep = 'profile'
  } else if (!steps.payments.completed) {
    nextStep = 'payments'
  } else if (isServiceProvider && !hasActiveSubscription) {
    nextStep = 'subscription'
  }

  return c.json({
    steps,
    progress: {
      profile: Math.round(profileProgress * 100),
      payments: Math.round(paymentsProgress * 100),
      overall: Math.round(overallProgress * 100),
    },
    isComplete,
    canAcceptPayments,
    nextStep,
    // Additional context for service providers
    ...(isServiceProvider && {
      plan: 'service',
      subscriptionRequired: true,
    }),
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
  feeMode: z.enum(['absorb', 'pass_to_subscriber']).optional(),
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
    if (data.feeMode !== undefined) {
      updateData.feeMode = data.feeMode
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
        feeMode: updatedProfile.feeMode,
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
      feeMode: true,
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
    feeMode: userProfile?.feeMode || 'pass_to_subscriber',
  })
})

// Check username availability
profile.get(
  '/check-username/:username',
  publicStrictRateLimit,
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
profile.get('/pricing/:plan', publicRateLimit, async (c) => {
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
