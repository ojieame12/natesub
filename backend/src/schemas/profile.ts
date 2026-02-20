import { z } from 'zod'

// Tier schema
// Note: max 10M to accommodate high local currencies (e.g., 800,000 NGN = ~$500 USD)
export const tierSchema = z.object({
  id: z.string().max(50),
  name: z.string().min(1).max(50),
  amount: z.number().positive().max(10_000_000), // Max 10M for local currencies
  perks: z.array(z.string().max(200)).max(20),
  isPopular: z.boolean().optional(),
})

// Perk schema
export const perkSchema = z.object({
  id: z.string(),
  title: z.string(),
  enabled: z.boolean(),
})

// Impact item schema
export const impactItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string(),
})

// URL validator
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

// Only 'boundary' is currently implemented - others removed to prevent drift
export const templateSchema = z.enum(['boundary'])

// E.164 phone number validation (e.g., +2348012345678)
const e164Phone = z.string().refine(
  (val) => {
    if (!val) return true
    return /^\+[1-9]\d{6,14}$/.test(val)
  },
  { message: 'Phone must be in E.164 format (e.g., +2348012345678)' }
)

export const profileSchema = z.object({
  username: z.string().min(3).max(20).regex(/^[a-z0-9_]+$/),
  displayName: z.string().min(2).max(50),
  bio: z.string().max(500).optional().nullable(),
  avatarUrl: httpsUrl.optional().nullable(),
  bannerUrl: httpsUrl.optional().nullable(), // AI-generated banner for service mode
  voiceIntroUrl: httpsUrl.optional().nullable(),
  phone: e164Phone.optional().nullable(), // SMS notifications
  country: z.string(),
  countryCode: z.string().length(2),
  currency: z.string().length(3).default('USD'),
  purpose: z.enum(['personal', 'service', 'tips', 'support', 'allowance', 'fan_club', 'exclusive_content', 'other']),
  pricingModel: z.enum(['single', 'tiers']),
  singleAmount: z.number().positive().max(10_000_000).optional().nullable(), // Max 10M for local currencies
  tiers: z.array(tierSchema).optional().nullable(),
  perks: z.array(perkSchema).optional().nullable(),
  impactItems: z.array(impactItemSchema).optional().nullable(),
  paymentProvider: z.enum(['stripe', 'paystack', 'flutterwave']).optional().nullable(),
  template: templateSchema.optional(),
  feeMode: z.enum(['absorb', 'pass_to_subscriber', 'split']).optional(),
  // Address fields
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  zip: z.string().optional().nullable(),
  isPublic: z.boolean().optional(),
})

export const profilePatchSchema = profileSchema
  .partial()
  .extend({
    // Allow explicitly clearing JSON fields with null
    tiers: z.array(tierSchema).optional().nullable(),
    perks: z.array(perkSchema).optional().nullable(),
    impactItems: z.array(impactItemSchema).optional().nullable(),
    template: templateSchema.optional(),
  })

export type Profile = z.infer<typeof profileSchema>
export type ProfilePatch = z.infer<typeof profilePatchSchema>
