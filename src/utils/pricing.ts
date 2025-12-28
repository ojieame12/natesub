// Pricing configuration for Personal vs Service branches
// Using split model: 4.5% subscriber + 4.5% creator = 9% total
//
// SOURCE OF TRUTH: Backend serves canonical values at GET /config/fees
// These are fallback defaults for offline/SSR. Runtime code should use
// useFeeConfig() hook from api/hooks.ts for guaranteed accuracy.
//
// To verify sync: compare these with backend/src/constants/fees.ts
// API endpoint: GET /config/fees returns { platformFeeRate, splitRate, ... }

// Fee constants - FALLBACK values (backend is source of truth)
export const PLATFORM_FEE_RATE = 0.09     // 9% total
export const SPLIT_RATE = 0.045           // 4.5% each party
export const CROSS_BORDER_BUFFER = 0.015  // 1.5%

export const PRICING = {
  personal: {
    subscription: 0, // Free
    subscriptionLabel: 'Free',
    transactionFee: 0.09, // 9% total (4.5% + 4.5%)
    transactionFeeLabel: '9%',
    planName: 'Free Plan',
    planDescription: 'No monthly fee, pay only when you earn',
  },
  service: {
    subscription: 500, // $5.00 in cents
    subscriptionLabel: '$5/mo',
    transactionFee: 0.09, // 9% total (4.5% + 4.5%)
    transactionFeeLabel: '9%',
    planName: 'Service Plan',
    planDescription: 'Professional tools for service providers',
  },
} as const

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

// Fee config interface for optional overrides from useFeeConfig()
export interface FeeConfigOverride {
  platformFeeRate?: number
  splitRate?: number
  crossBorderBuffer?: number
}

// Calculate fee preview using split model (4.5% subscriber + 4.5% creator = 9% total)
export function calculateFeePreview(
  amountCents: number,
  _purpose: string | undefined, // Reserved for future use
  _legacyFeeMode?: 'absorb' | 'pass_to_subscriber', // Ignored - always split
  feeConfig?: FeeConfigOverride // Optional: pass values from useFeeConfig()
): {
  subscriberPays: number
  creatorReceives: number
  feeAmount: number      // Total fee (9%)
  subscriberFee: number  // Subscriber's portion (4.5%)
  creatorFee: number     // Creator's portion (4.5%)
  feePercent: number
} {
  // Use provided config or fall back to module constants
  const splitRate = feeConfig?.splitRate ?? SPLIT_RATE
  const platformFeeRate = feeConfig?.platformFeeRate ?? PLATFORM_FEE_RATE

  // Split model: 4.5% each side = 9% total
  const subscriberFee = Math.round(amountCents * splitRate)
  const creatorFee = Math.round(amountCents * splitRate)
  const feeAmount = subscriberFee + creatorFee

  return {
    subscriberPays: amountCents + subscriberFee,  // Base + 4.5%
    creatorReceives: amountCents - creatorFee,    // Base - 4.5%
    feeAmount,
    subscriberFee,
    creatorFee,
    feePercent: platformFeeRate * 100,
  }
}
