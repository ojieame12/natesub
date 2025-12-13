// Pricing configuration for Personal vs Service branches

export const PRICING = {
  personal: {
    subscription: 0, // Free
    subscriptionLabel: 'Free',
    transactionFee: 0.10, // 10%
    transactionFeeLabel: '10%',
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

// Calculate fee preview based on fee mode
export function calculateFeePreview(
  amountCents: number,
  purpose: string | undefined,
  feeMode: 'absorb' | 'pass_to_subscriber'
): {
  subscriberPays: number
  creatorReceives: number
  feeAmount: number
  feePercent: number
} {
  const pricing = getPricing(purpose)
  const feePercent = pricing.transactionFee

  if (feeMode === 'absorb') {
    // Creator absorbs fee: subscriber pays exact amount, creator gets less
    const feeAmount = Math.round(amountCents * feePercent)
    return {
      subscriberPays: amountCents,
      creatorReceives: amountCents - feeAmount,
      feeAmount,
      feePercent: feePercent * 100,
    }
  } else {
    // Pass to subscriber: subscriber pays more, creator gets full amount
    // To ensure creator gets exactly amountCents after fee: subscriberPays = amount / (1 - feePercent)
    const subscriberPays = Math.round(amountCents / (1 - feePercent))
    const feeAmount = subscriberPays - amountCents
    return {
      subscriberPays,
      creatorReceives: amountCents,
      feeAmount,
      feePercent: feePercent * 100,
    }
  }
}
