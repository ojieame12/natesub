// Field mapping utilities for frontend/backend alignment
// These handle the differences between frontend stores and API contracts

import type { RelationshipType } from '../request/store'
import type { SubscriptionPurpose, PricingModel, SubscriptionTier, ImpactItem, PerkItem } from '../onboarding/store'
import type { UpdateAudience } from '../updates/store'

// ============================================
// AMOUNT CONVERSION HELPERS
// ============================================

/**
 * Convert dollars to cents for API requests
 */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100)
}

/**
 * Convert cents to dollars for display
 */
export function centsToDollars(cents: number): number {
  return cents / 100
}

/**
 * Format amount for display (handles both cents and dollars)
 */
export function formatAmount(amount: number, isCents = false, currency = 'USD'): string {
  const dollars = isCents ? centsToDollars(amount) : amount
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(dollars)
}

// ============================================
// RELATIONSHIP TYPE MAPPING
// ============================================

// Frontend uses granular types, backend uses simple enum
const relationshipMap: Record<RelationshipType, string> = {
  family_mom: 'family',
  family_dad: 'family',
  family_sibling: 'family',
  family_spouse: 'family',
  family_child: 'family',
  family_grandparent: 'family',
  family_other: 'family',
  friend_close: 'friend',
  friend_acquaintance: 'friend',
  client: 'client',
  fan: 'fan',
  colleague: 'colleague',
  partner: 'partner',
  other: 'other',
}

/**
 * Map granular frontend relationship to simple backend enum
 */
export function mapRelationshipToApi(relationship: RelationshipType | null): string {
  if (!relationship) return 'other'
  return relationshipMap[relationship] || 'other'
}

// ============================================
// ONBOARDING PROFILE MAPPING
// ============================================

interface OnboardingStoreData {
  name: string
  country: string
  countryCode: string
  currency: string
  purpose: SubscriptionPurpose | null
  pricingModel: PricingModel
  singleAmount: number | null
  tiers: SubscriptionTier[]
  impactItems: ImpactItem[]
  perks: PerkItem[]
  voiceIntroUrl: string | null
  bio: string
  username: string
  avatarUrl: string | null
}

interface ProfileApiPayload {
  username: string
  displayName: string
  bio: string | null
  avatarUrl: string | null
  voiceIntroUrl: string | null
  country: string
  countryCode: string
  currency: string
  purpose: string
  pricingModel: 'single' | 'tiers'
  singleAmount: number | null // in cents
  tiers: Array<{
    id: string
    name: string
    amount: number // in cents
    perks: string[]
    isPopular?: boolean
  }> | null
  perks: Array<{ id: string; title: string; enabled: boolean }> | null
  impactItems: Array<{ id: string; title: string; subtitle: string }> | null
}

/**
 * Map onboarding store data to API profile payload
 */
export function mapOnboardingToApi(data: OnboardingStoreData): ProfileApiPayload {
  return {
    username: data.username,
    displayName: data.name, // name → displayName
    bio: data.bio || null,
    avatarUrl: data.avatarUrl,
    voiceIntroUrl: data.voiceIntroUrl,
    country: data.country,
    countryCode: data.countryCode,
    currency: data.currency,
    purpose: data.purpose || 'other',
    pricingModel: data.pricingModel,
    singleAmount: data.singleAmount ? dollarsToCents(data.singleAmount) : null,
    tiers: data.pricingModel === 'tiers' ? data.tiers.map(tier => ({
      id: tier.id,
      name: tier.name,
      amount: dollarsToCents(tier.amount),
      perks: tier.perks,
      isPopular: tier.isPopular,
    })) : null,
    perks: data.perks.filter(p => p.enabled).length > 0 ? data.perks : null,
    impactItems: data.impactItems.length > 0 ? data.impactItems : null,
  }
}

/**
 * Map API profile to store format (for loading existing profile)
 */
export function mapApiToOnboarding(profile: ProfileApiPayload): Partial<OnboardingStoreData> {
  return {
    name: profile.displayName, // displayName → name
    country: profile.country,
    countryCode: profile.countryCode,
    currency: profile.currency,
    purpose: profile.purpose as SubscriptionPurpose,
    pricingModel: profile.pricingModel,
    singleAmount: profile.singleAmount ? centsToDollars(profile.singleAmount) : null,
    tiers: profile.tiers?.map(tier => ({
      id: tier.id,
      name: tier.name,
      amount: centsToDollars(tier.amount),
      perks: tier.perks,
      isPopular: tier.isPopular,
    })) || [],
    perks: profile.perks || [],
    impactItems: profile.impactItems || [],
    voiceIntroUrl: profile.voiceIntroUrl,
    bio: profile.bio || '',
    username: profile.username,
    avatarUrl: profile.avatarUrl,
  }
}

// ============================================
// REQUEST MAPPING
// ============================================

interface RequestStoreData {
  recipient: {
    id: string
    name: string
    phone?: string
    email?: string
  } | null
  relationship: RelationshipType | null
  amount: number // in dollars
  isRecurring: boolean
  message: string
  voiceNoteUrl: string | null // frontend name
  customPerks: Array<{ id: string; title: string; enabled: boolean }>
}

interface RequestApiPayload {
  recipientName: string
  recipientEmail?: string
  recipientPhone?: string
  relationship: string
  amountCents: number
  currency?: string
  isRecurring?: boolean
  message?: string
  voiceUrl?: string // backend name
  customPerks?: string[]
}

/**
 * Map request store data to API payload
 */
export function mapRequestToApi(data: RequestStoreData, currency = 'USD'): RequestApiPayload | null {
  if (!data.recipient) return null

  return {
    recipientName: data.recipient.name,
    recipientEmail: data.recipient.email,
    recipientPhone: data.recipient.phone,
    relationship: mapRelationshipToApi(data.relationship),
    amountCents: dollarsToCents(data.amount),
    currency,
    isRecurring: data.isRecurring,
    message: data.message || undefined,
    voiceUrl: data.voiceNoteUrl || undefined, // voiceNoteUrl → voiceUrl
    customPerks: data.customPerks
      .filter(p => p.enabled)
      .map(p => p.title),
  }
}

// ============================================
// UPDATE MAPPING
// ============================================

interface UpdateStoreData {
  caption: string
  mediaUrl?: string
  audience: UpdateAudience
}

interface UpdateApiPayload {
  title?: string
  body: string
  photoUrl?: string
  audience?: string
}

/**
 * Map update store data to API payload
 */
export function mapUpdateToApi(data: UpdateStoreData, title?: string): UpdateApiPayload {
  return {
    title,
    body: data.caption, // caption → body
    photoUrl: data.mediaUrl, // mediaUrl → photoUrl
    audience: data.audience,
  }
}

/**
 * Map API update to store format
 */
export function mapApiToUpdate(update: { body: string; photoUrl?: string; audience: string }): Partial<UpdateStoreData> {
  return {
    caption: update.body,
    mediaUrl: update.photoUrl,
    audience: update.audience as UpdateAudience,
  }
}
