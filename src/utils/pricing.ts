// Pricing configuration for Personal vs Service branches

export const PRICING = {
  personal: {
    subscription: 0, // Free
    subscriptionLabel: 'Free',
    transactionFee: 0.08, // 8%
    transactionFeeLabel: '8%',
    planName: 'Free Plan',
    planDescription: 'No monthly fee, pay only when you earn',
  },
  service: {
    subscription: 500, // $5.00 in cents
    subscriptionLabel: '$5/mo',
    transactionFee: 0.08, // 8%
    transactionFeeLabel: '8%',
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
