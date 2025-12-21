// Pricing configuration for Personal vs Service branches

export const PRICING = {
  personal: {
    subscription: 0, // Free
    subscriptionLabel: 'Free',
    transactionFee: 0.08, // 8% (legacy - now tiered)
    transactionFeeLabel: '5-8%',
    planName: 'Free Plan',
    planDescription: 'No monthly fee, pay only when you earn',
  },
  service: {
    subscription: 500, // $5.00 in cents
    subscriptionLabel: '$5/mo',
    transactionFee: 0.08, // 8% (legacy - now tiered)
    transactionFeeLabel: '5-8%',
    planName: 'Service Plan',
    planDescription: 'Professional tools for service providers',
  },
} as const

// =============================================================================
// NEW TIERED FEE MODEL (v2)
// Platform fee: 5% on first $500, 2% above (standard)
//               3% on first $500, 1% above (founding)
// Processing: ~3-6% pass-through depending on corridor
// =============================================================================

export type FeeTier = 'standard' | 'founding'
export type FeeDirection = 'recipient_pays' | 'payer_pays'

const TIER1_LIMIT_CENTS = 50000 // $500

const PLATFORM_RATES: Record<FeeTier, { tier1: number; tier2: number }> = {
  standard: { tier1: 0.05, tier2: 0.02 },  // 5% / 2%
  founding: { tier1: 0.03, tier2: 0.01 },  // 3% / 1%
}

// Estimated processing rates by corridor (for display only - actual rates from backend)
const PROCESSING_ESTIMATES = {
  domestic: { rate: 0.035, fixed: 30 },      // ~3.5% + $0.30
  crossBorder: { rate: 0.06, fixed: 30 },    // ~6% + $0.30
}

const MIN_PLATFORM_FEE_CENTS = 100 // $1 minimum

export interface TieredFeeResult {
  payerPays: number
  recipientReceives: number
  platformFee: number
  processingFee: number
  totalFee: number
  platformFeePercent: number
  processingFeePercent: number
  direction: FeeDirection
  tier: FeeTier
}

/**
 * Calculate platform fee using tiered model
 */
export function calculatePlatformFee(amountCents: number, tier: FeeTier = 'standard'): number {
  const rates = PLATFORM_RATES[tier]
  let fee: number

  if (amountCents <= TIER1_LIMIT_CENTS) {
    fee = amountCents * rates.tier1
  } else {
    fee = (TIER1_LIMIT_CENTS * rates.tier1) + ((amountCents - TIER1_LIMIT_CENTS) * rates.tier2)
  }

  return Math.max(Math.round(fee), MIN_PLATFORM_FEE_CENTS)
}

/**
 * Estimate processing fee (for display - actual fee determined at checkout)
 */
export function estimateProcessingFee(amountCents: number, isCrossBorder: boolean = false): number {
  const estimate = isCrossBorder ? PROCESSING_ESTIMATES.crossBorder : PROCESSING_ESTIMATES.domestic
  return Math.round(amountCents * estimate.rate) + estimate.fixed
}

/**
 * Calculate full fee breakdown with new tiered model
 */
export function calculateTieredFees(
  amountCents: number,
  options: {
    tier?: FeeTier
    direction?: FeeDirection
    isCrossBorder?: boolean
  } = {}
): TieredFeeResult {
  const {
    tier = 'standard',
    direction = 'recipient_pays',
    isCrossBorder = false,
  } = options

  const platformFee = calculatePlatformFee(amountCents, tier)
  const processingFee = estimateProcessingFee(amountCents, isCrossBorder)
  const totalFee = platformFee + processingFee

  if (direction === 'recipient_pays') {
    // Subscriber pays face value, creator absorbs fees
    return {
      payerPays: amountCents,
      recipientReceives: amountCents - totalFee,
      platformFee,
      processingFee,
      totalFee,
      platformFeePercent: (platformFee / amountCents) * 100,
      processingFeePercent: (processingFee / amountCents) * 100,
      direction,
      tier,
    }
  } else {
    // Payer pays extra so recipient gets full amount
    // Need to gross up for processing (it's on the charged amount)
    const estimate = isCrossBorder ? PROCESSING_ESTIMATES.crossBorder : PROCESSING_ESTIMATES.domestic
    const grossedProcessing = Math.round((amountCents + platformFee + estimate.fixed) / (1 - estimate.rate) * estimate.rate) + estimate.fixed
    const totalPayer = amountCents + platformFee + grossedProcessing

    return {
      payerPays: totalPayer,
      recipientReceives: amountCents,
      platformFee,
      processingFee: grossedProcessing,
      totalFee: platformFee + grossedProcessing,
      platformFeePercent: (platformFee / amountCents) * 100,
      processingFeePercent: (grossedProcessing / amountCents) * 100,
      direction,
      tier,
    }
  }
}

export type PlanType = keyof typeof PRICING

// Get pricing based on purpose
export function getPricing(purpose: string | undefined) {
  return purpose === 'service' ? PRICING.service : PRICING.personal
}

// Format fee for display
export function formatFee(fee: number): string {
  return `${(fee * 100).toFixed(0)}%`
}

// Calculate net amount after fees
export function calculateNet(grossCents: number, purpose: string | undefined): number {
  const pricing = getPricing(purpose)
  return Math.round(grossCents * (1 - pricing.transactionFee))
}

// Calculate fee amount
export function calculateFee(grossCents: number, purpose: string | undefined): number {
  const pricing = getPricing(purpose)
  return Math.round(grossCents * pricing.transactionFee)
}

// Calculate fee preview using split model (4% subscriber + 4% creator = 8% total)
export function calculateFeePreview(
  amountCents: number,
  _purpose: string | undefined, // Reserved for future use
  _legacyFeeMode?: 'absorb' | 'pass_to_subscriber' // Ignored - always split
): {
  subscriberPays: number
  creatorReceives: number
  feeAmount: number      // Total fee (8%)
  subscriberFee: number  // Subscriber's portion (4%)
  creatorFee: number     // Creator's portion (4%)
  feePercent: number
} {
  // Split model: 4% each side = 8% total
  const subscriberFeeRate = 0.04
  const creatorFeeRate = 0.04
  const totalFeeRate = subscriberFeeRate + creatorFeeRate

  const subscriberFee = Math.round(amountCents * subscriberFeeRate)
  const creatorFee = Math.round(amountCents * creatorFeeRate)
  const feeAmount = subscriberFee + creatorFee

  return {
    subscriberPays: amountCents + subscriberFee,  // Base + 4%
    creatorReceives: amountCents - creatorFee,    // Base - 4%
    feeAmount,
    subscriberFee,
    creatorFee,
    feePercent: totalFeeRate * 100,
  }
}
