/**
 * Fee Calculation Service
 *
 * Two fee modes (creator's choice):
 * - absorb: Creator absorbs fee, subscriber pays exact price
 * - pass_to_subscriber: Fee added on top, creator keeps full amount
 *
 * Simple flat rates:
 * - Personal (tips, allowances): 10%
 * - Service (freelancers, businesses): 8%
 *
 * No caps. No floors. Simple and fair for everyone.
 */

export type UserPurpose = 'personal' | 'service' | 'tips' | 'support' | 'allowance' | 'fan_club' | 'exclusive_content' | 'other'
export type FeeMode = 'absorb' | 'pass_to_subscriber'

// Fee rates by purpose type
const FEE_RATES = {
  personal: 0.10,  // 10% for personal (tips, allowances, support)
  service: 0.08,   // 8% for service (freelancers, businesses)
}

// Map purpose enum to fee type
function isServicePurpose(purpose: UserPurpose | null | undefined): boolean {
  return purpose === 'service'
}

export interface FeeCalculation {
  feeCents: number
  effectiveRate: number
  grossCents: number        // Total subscriber pays
  netCents: number          // What creator receives
  currency: string
  feeModel: 'flat'
  feeMode: FeeMode          // Who pays the fee
  purposeType: 'service' | 'personal'
}

/**
 * Calculate service fee based on creator's fee mode
 *
 * @param amountCents - Creator's set price in smallest currency unit (cents/kobo)
 * @param currency - ISO currency code (USD, NGN, ZAR, etc)
 * @param purpose - User's purpose (determines fee rate: 10% personal, 8% service)
 * @param feeMode - Who pays the fee: 'absorb' or 'pass_to_subscriber'
 * @returns Fee calculation with breakdown
 *
 * @example
 * // Pass to subscriber (default): $100 price, subscriber pays $110, creator gets $100
 * calculateServiceFee(10000, 'USD', 'personal', 'pass_to_subscriber')
 * // Returns: { feeCents: 1000, grossCents: 11000, netCents: 10000 }
 *
 * @example
 * // Creator absorbs: $100 price, subscriber pays $100, creator gets $90
 * calculateServiceFee(10000, 'USD', 'personal', 'absorb')
 * // Returns: { feeCents: 1000, grossCents: 10000, netCents: 9000 }
 */
export function calculateServiceFee(
  amountCents: number,
  currency: string,
  purpose?: UserPurpose | null,
  feeMode: FeeMode = 'pass_to_subscriber',
  isCrossBorder: boolean = false
): FeeCalculation {
  // Validate input
  if (amountCents < 0) {
    throw new Error('Amount cannot be negative')
  }

  const normalizedCurrency = currency.toUpperCase()
  const isService = isServicePurpose(purpose)
  const purposeType = isService ? 'service' : 'personal'

  // Base Rate (8% or 10%)
  let rate = isService ? FEE_RATES.service : FEE_RATES.personal

  // Smart Buffer: Add 1.5% for cross-border to cover FX/Stripe surcharge
  if (isCrossBorder) {
    rate += 0.015
  }

  if (amountCents === 0) {
    return {
      feeCents: 0,
      effectiveRate: 0,
      grossCents: 0,
      netCents: 0,
      currency: normalizedCurrency,
      feeModel: 'flat',
      feeMode,
      purposeType,
    }
  }

  // Calculate fee based on mode (flat percentage)
  let feeCents = Math.round(amountCents * rate)

  // Safety Floor: Ensure we collect at least 50 cents (or equivalent) to cover fixed costs
  // Only apply floor if the transaction amount is reasonably high (> $1) to avoid killing micro-transactions
  // For micro-transactions (< $1), we accept the loss or take what we can
  const MIN_FEE_CENTS = 50
  if (amountCents > 100 && feeCents < MIN_FEE_CENTS) {
    feeCents = MIN_FEE_CENTS
    // Recalculate effective rate for metadata
    rate = feeCents / amountCents
  }

  if (feeMode === 'absorb') {
    // Creator absorbs: subscriber pays exact price, creator gets price - fee
    return {
      feeCents,
      effectiveRate: rate,
      grossCents: amountCents,      // Subscriber pays the set price
      netCents: amountCents - feeCents, // Creator receives price minus fee
      currency: normalizedCurrency,
      feeModel: 'flat',
      feeMode,
      purposeType,
    }
  }

  // pass_to_subscriber (default): fee added on top, creator keeps full amount
  return {
    feeCents,
    effectiveRate: rate,
    grossCents: amountCents + feeCents, // Subscriber pays price + fee
    netCents: amountCents,              // Creator receives full price
    currency: normalizedCurrency,
    feeModel: 'flat',
    feeMode,
    purposeType,
  }
}

/**
 * Format fee for display
 */
export function formatFee(feeCents: number, currency: string): string {
  const amount = feeCents / 100

  // Handle zero-decimal currencies (Stripe's full list)
  // These currencies have no decimal places - 100 JPY is 100, not 1.00
  const zeroDecimalCurrencies = [
    'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW',
    'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'
  ]
  const displayAmount = zeroDecimalCurrencies.includes(currency.toUpperCase())
    ? feeCents
    : amount

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: zeroDecimalCurrencies.includes(currency.toUpperCase()) ? 0 : 2,
  }).format(displayAmount)
}

/**
 * Format effective rate as percentage
 */
export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`
}

/**
 * Get fee rate for a purpose type
 */
export function getFeeRate(purpose?: UserPurpose | null): number {
  return isServicePurpose(purpose) ? FEE_RATES.service : FEE_RATES.personal
}

/**
 * Legacy fee calculation for backward compatibility
 * Used for existing subscriptions created before subscriber-pays model
 * In legacy model, fee was deducted FROM creator's amount
 */
export function calculateLegacyFee(
  amountCents: number,
  purpose: 'personal' | 'service' | null
): { feeCents: number; netCents: number } {
  const rate = purpose === 'service' ? FEE_RATES.service : FEE_RATES.personal
  // Legacy fee model: add buffer to ensure positive margin
  const feeCents = Math.round(amountCents * rate) + 30
  return {
    feeCents,
    netCents: amountCents - feeCents,
  }
}

/**
 * Calculate what the subscriber sees (preview)
 * Useful for displaying fee breakdown before checkout
 */
export function calculateFeePreview(
  amountCents: number,
  currency: string,
  purpose?: UserPurpose | null,
  feeMode: FeeMode = 'pass_to_subscriber'
): {
  creatorReceives: number
  subscriberPays: number
  serviceFee: number
  effectiveRate: string
  feeMode: FeeMode
} {
  const calc = calculateServiceFee(amountCents, currency, purpose, feeMode)

  return {
    creatorReceives: calc.netCents,
    subscriberPays: calc.grossCents,
    serviceFee: calc.feeCents,
    effectiveRate: formatRate(calc.effectiveRate),
    feeMode: calc.feeMode,
  }
}
