/**
 * Fee Calculation Service
 *
 * Split Fee Model (v2):
 * - 4% paid by subscriber (added to price)
 * - 4% paid by creator (deducted from payout)
 * - 8% total platform fee
 *
 * Psychology: Neither party sees "8%" - both see 4% as reasonable.
 *
 * Processor Buffer: Guarantees positive margin by ensuring platform fee
 * always exceeds estimated processor costs + minimum margin.
 */

export type UserPurpose = 'personal' | 'service' | 'tips' | 'support' | 'allowance' | 'fan_club' | 'exclusive_content' | 'other'

// Legacy fee mode type (kept for backward compatibility with existing subscriptions)
export type FeeMode = 'absorb' | 'pass_to_subscriber' | 'split'

// Fixed fee rate: 8% total, split 4%/4%
const PLATFORM_FEE_RATE = 0.08
const SPLIT_RATE = 0.04 // Each party pays 4%

// Cross-border buffer for FX/Stripe surcharge
const CROSS_BORDER_BUFFER = 0.015 // 1.5%

// Processor fee estimates by currency (for margin calculation)
// These are conservative estimates to ensure we never go negative
const PROCESSOR_FEES: Record<string, { percentRate: number; fixedCents: number }> = {
  USD: { percentRate: 0.029, fixedCents: 30 },    // Stripe US: 2.9% + 30¢
  EUR: { percentRate: 0.029, fixedCents: 25 },    // Stripe EU: 2.9% + €0.25
  GBP: { percentRate: 0.029, fixedCents: 20 },    // Stripe UK: 2.9% + 20p
  CAD: { percentRate: 0.029, fixedCents: 30 },    // Stripe CA: 2.9% + 30¢
  AUD: { percentRate: 0.029, fixedCents: 30 },    // Stripe AU: 2.9% + 30¢
  ZAR: { percentRate: 0.029, fixedCents: 500 },   // ~R5.00 fixed
  KES: { percentRate: 0.015, fixedCents: 5000 },  // Paystack: 1.5% + KSh50
  NGN: { percentRate: 0.015, fixedCents: 10000 }, // Paystack: 1.5% + ₦100
  GHS: { percentRate: 0.019, fixedCents: 0 },     // Paystack Ghana: 1.9%
}

// Default processor fees for unknown currencies
const DEFAULT_PROCESSOR_FEE = { percentRate: 0.029, fixedCents: 30 }

// Minimum margin we want to keep after processor fees (in smallest currency unit)
// This ensures we're profitable on every transaction
const MIN_MARGIN_CENTS: Record<string, number> = {
  USD: 25,     // $0.25 minimum profit
  EUR: 25,     // €0.25
  GBP: 20,     // £0.20
  CAD: 35,     // $0.35
  AUD: 35,     // $0.35
  ZAR: 500,    // R5.00
  KES: 2500,   // KSh25.00
  NGN: 25000,  // ₦250.00 (25,000 kobo)
  GHS: 250,    // ₵2.50
}

// Default minimum margin for unknown currencies
const DEFAULT_MIN_MARGIN = 25

export interface FeeCalculation {
  feeCents: number              // Total platform fee (8%)
  subscriberFeeCents: number    // Subscriber's portion (4%)
  creatorFeeCents: number       // Creator's portion (4%)
  effectiveRate: number         // 0.04 (each side's rate)
  grossCents: number            // Total subscriber pays (base + subscriber fee)
  netCents: number              // What creator receives (base - creator fee)
  baseCents: number             // Original price before split
  currency: string
  feeModel: 'split_v1'          // Always split now
  feeMode: FeeMode              // 'split' for new, 'absorb'/'pass_to_subscriber' for legacy
  purposeType: 'service' | 'personal'
  feeWasCapped: boolean         // True if processor buffer was applied
  estimatedProcessorFee: number // Estimated processor cost
  estimatedMargin: number       // Platform margin after processor fees
}

/**
 * Calculate estimated processor fees for a transaction
 */
function estimateProcessorFee(grossCents: number, currency: string): number {
  const processor = PROCESSOR_FEES[currency] || DEFAULT_PROCESSOR_FEE
  return Math.round(grossCents * processor.percentRate) + processor.fixedCents
}

/**
 * Calculate service fee using split model (4%/4%)
 *
 * @param amountCents - Creator's set price in smallest currency unit (cents/kobo)
 * @param currency - ISO currency code (USD, NGN, ZAR, etc)
 * @param purpose - User's purpose (for analytics, doesn't affect rate)
 * @param _legacyFeeMode - DEPRECATED: Ignored, always uses split. Kept for backward compatibility.
 * @param isCrossBorder - True if subscriber currency differs from creator currency
 * @returns Fee calculation with breakdown
 *
 * @example
 * // Split model: $100 base price
 * // Subscriber pays: $100 + $4 (4%) = $104
 * // Creator gets: $100 - $4 (4%) = $96
 * // Platform keeps: $8 (8% total)
 * calculateServiceFee(10000, 'USD', 'personal')
 * // Returns: { feeCents: 800, subscriberFeeCents: 400, creatorFeeCents: 400,
 * //           grossCents: 10400, netCents: 9600, baseCents: 10000 }
 */
export function calculateServiceFee(
  amountCents: number,
  currency: string,
  purpose?: UserPurpose | null,
  _legacyFeeMode?: FeeMode, // Ignored - always split
  isCrossBorder: boolean = false
): FeeCalculation {
  // Validate input
  if (amountCents < 0) {
    throw new Error('Amount cannot be negative')
  }

  const normalizedCurrency = currency.toUpperCase()
  const purposeType = purpose === 'service' ? 'service' : 'personal'

  // Handle zero amount
  if (amountCents === 0) {
    return {
      feeCents: 0,
      subscriberFeeCents: 0,
      creatorFeeCents: 0,
      effectiveRate: 0,
      grossCents: 0,
      netCents: 0,
      baseCents: 0,
      currency: normalizedCurrency,
      feeModel: 'split_v1',
      feeMode: 'split',
      purposeType,
      feeWasCapped: false,
      estimatedProcessorFee: 0,
      estimatedMargin: 0,
    }
  }

  // Calculate split fees (4% each side)
  let splitRate = SPLIT_RATE

  // Add cross-border buffer if applicable (subscriber pays more)
  if (isCrossBorder) {
    splitRate += CROSS_BORDER_BUFFER / 2 // Split the extra 1.5% evenly
  }

  let subscriberFeeCents = Math.round(amountCents * splitRate)
  let creatorFeeCents = Math.round(amountCents * splitRate)
  let totalFeeCents = subscriberFeeCents + creatorFeeCents

  // Calculate gross (what subscriber pays)
  let grossCents = amountCents + subscriberFeeCents

  // Estimate processor fees on the gross amount
  const estimatedProcessorFee = estimateProcessorFee(grossCents, normalizedCurrency)
  const minMargin = MIN_MARGIN_CENTS[normalizedCurrency] || DEFAULT_MIN_MARGIN
  const minPlatformFee = estimatedProcessorFee + minMargin

  // Apply processor buffer: ensure platform fee covers processor + margin
  let feeWasCapped = false
  if (totalFeeCents < minPlatformFee) {
    feeWasCapped = true
    // Increase fees proportionally to meet minimum
    const deficit = minPlatformFee - totalFeeCents
    // Split deficit: subscriber pays 60%, creator pays 40% (subscriber already paying gross)
    const subscriberExtra = Math.ceil(deficit * 0.6)
    const creatorExtra = deficit - subscriberExtra

    subscriberFeeCents += subscriberExtra
    creatorFeeCents += creatorExtra
    totalFeeCents = subscriberFeeCents + creatorFeeCents
    grossCents = amountCents + subscriberFeeCents
  }

  // Calculate net (what creator receives)
  const netCents = amountCents - creatorFeeCents

  // Calculate actual margin
  const estimatedMargin = totalFeeCents - estimatedProcessorFee

  // Effective rate is what each party pays (for display)
  const effectiveRate = subscriberFeeCents / amountCents

  return {
    feeCents: totalFeeCents,
    subscriberFeeCents,
    creatorFeeCents,
    effectiveRate,
    grossCents,
    netCents,
    baseCents: amountCents,
    currency: normalizedCurrency,
    feeModel: 'split_v1',
    feeMode: 'split',
    purposeType,
    feeWasCapped,
    estimatedProcessorFee,
    estimatedMargin,
  }
}

/**
 * Legacy fee calculation for existing subscriptions with old fee modes
 * Used by webhook handlers for backward compatibility
 */
export function calculateLegacyServiceFee(
  amountCents: number,
  currency: string,
  purpose?: UserPurpose | null,
  feeMode: FeeMode = 'pass_to_subscriber',
  isCrossBorder: boolean = false
): FeeCalculation {
  // For split mode, use the new calculation
  if (feeMode === 'split') {
    return calculateServiceFee(amountCents, currency, purpose, feeMode, isCrossBorder)
  }

  const normalizedCurrency = currency.toUpperCase()
  const purposeType = purpose === 'service' ? 'service' : 'personal'

  if (amountCents === 0) {
    return {
      feeCents: 0,
      subscriberFeeCents: 0,
      creatorFeeCents: 0,
      effectiveRate: 0,
      grossCents: 0,
      netCents: 0,
      baseCents: 0,
      currency: normalizedCurrency,
      feeModel: 'split_v1',
      feeMode,
      purposeType,
      feeWasCapped: false,
      estimatedProcessorFee: 0,
      estimatedMargin: 0,
    }
  }

  // Legacy rate calculation (8% flat)
  let rate = PLATFORM_FEE_RATE
  if (isCrossBorder) {
    rate += CROSS_BORDER_BUFFER
  }

  const feeCents = Math.round(amountCents * rate)
  const estimatedProcessorFee = estimateProcessorFee(
    feeMode === 'absorb' ? amountCents : amountCents + feeCents,
    normalizedCurrency
  )

  if (feeMode === 'absorb') {
    // Creator absorbs entire fee
    return {
      feeCents,
      subscriberFeeCents: 0,
      creatorFeeCents: feeCents,
      effectiveRate: rate,
      grossCents: amountCents,
      netCents: amountCents - feeCents,
      baseCents: amountCents,
      currency: normalizedCurrency,
      feeModel: 'split_v1',
      feeMode,
      purposeType,
      feeWasCapped: false,
      estimatedProcessorFee,
      estimatedMargin: feeCents - estimatedProcessorFee,
    }
  }

  // pass_to_subscriber: subscriber pays entire fee
  return {
    feeCents,
    subscriberFeeCents: feeCents,
    creatorFeeCents: 0,
    effectiveRate: rate,
    grossCents: amountCents + feeCents,
    netCents: amountCents,
    baseCents: amountCents,
    currency: normalizedCurrency,
    feeModel: 'split_v1',
    feeMode,
    purposeType,
    feeWasCapped: false,
    estimatedProcessorFee,
    estimatedMargin: feeCents - estimatedProcessorFee,
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
  return `${(rate * 100).toFixed(1)}%`
}

/**
 * Get the platform fee rate (always 8% total, 4% each side)
 */
export function getFeeRate(_purpose?: UserPurpose | null): number {
  return PLATFORM_FEE_RATE // 8% flat for all purposes
}

/**
 * Get the split rate (what each party pays)
 */
export function getSplitRate(): number {
  return SPLIT_RATE // 4% each
}

/**
 * Legacy fee calculation for backward compatibility
 * Used for existing subscriptions created before split model
 */
export function calculateLegacyFee(
  amountCents: number,
  _purpose: 'personal' | 'service' | null
): { feeCents: number; netCents: number } {
  // Use 8% flat rate with buffer
  const feeCents = Math.round(amountCents * PLATFORM_FEE_RATE) + 30
  return {
    feeCents,
    netCents: amountCents - feeCents,
  }
}

/**
 * Calculate what both parties see (preview)
 * Always uses split model
 */
export function calculateFeePreview(
  amountCents: number,
  currency: string,
  purpose?: UserPurpose | null,
  _legacyFeeMode?: FeeMode // Ignored - always split
): {
  creatorReceives: number
  subscriberPays: number
  serviceFee: number        // Total fee
  subscriberFee: number     // Subscriber's portion
  creatorFee: number        // Creator's portion
  effectiveRate: string
  feeMode: FeeMode
  feeWasCapped: boolean
} {
  const calc = calculateServiceFee(amountCents, currency, purpose)

  return {
    creatorReceives: calc.netCents,
    subscriberPays: calc.grossCents,
    serviceFee: calc.feeCents,
    subscriberFee: calc.subscriberFeeCents,
    creatorFee: calc.creatorFeeCents,
    effectiveRate: formatRate(calc.effectiveRate),
    feeMode: calc.feeMode,
    feeWasCapped: calc.feeWasCapped,
  }
}

// =============================================================================
// NEW TIERED FEE MODEL (v2)
// Platform fee: 5% on first $500, 2% above (standard)
//               3% on first $500, 1% above (founding)
// Processing: pass-through to Stripe/Paystack (not included in platform fee)
// =============================================================================

export type FeeTier = 'standard' | 'founding'
export type FeeDirection = 'recipient_pays' | 'payer_pays'

const TIER1_LIMIT_CENTS = 50000 // $500

const TIERED_PLATFORM_RATES: Record<FeeTier, { tier1: number; tier2: number }> = {
  standard: { tier1: 0.05, tier2: 0.02 },  // 5% / 2%
  founding: { tier1: 0.03, tier2: 0.01 },  // 3% / 1%
}

const MIN_PLATFORM_FEE_CENTS = 100 // $1 minimum

export interface TieredFeeCalculation {
  payerPaysCents: number
  recipientReceivesCents: number
  platformFeeCents: number
  processingFeeCents: number
  totalFeeCents: number
  platformFeePercent: number
  processingFeePercent: number
  direction: FeeDirection
  tier: FeeTier
  currency: string
}

/**
 * Calculate platform fee using new tiered model
 * 5% on first $500, 2% above (standard)
 * 3% on first $500, 1% above (founding)
 */
export function calculateTieredPlatformFee(amountCents: number, tier: FeeTier = 'standard'): number {
  if (amountCents <= 0) return 0

  const rates = TIERED_PLATFORM_RATES[tier]
  let fee: number

  if (amountCents <= TIER1_LIMIT_CENTS) {
    fee = amountCents * rates.tier1
  } else {
    fee = (TIER1_LIMIT_CENTS * rates.tier1) + ((amountCents - TIER1_LIMIT_CENTS) * rates.tier2)
  }

  return Math.max(Math.round(fee), MIN_PLATFORM_FEE_CENTS)
}

/**
 * Get processing fee rate for a corridor
 */
export function getProcessingRate(currency: string, isCrossBorder: boolean = false): { percent: number; fixed: number } {
  const normalizedCurrency = currency.toUpperCase()

  // Cross-border adds ~3% on top of base rate
  if (isCrossBorder) {
    const base = PROCESSOR_FEES[normalizedCurrency] || DEFAULT_PROCESSOR_FEE
    return {
      percent: base.percentRate + 0.02 + 0.01, // +2% cross-border +1% FX
      fixed: base.fixedCents,
    }
  }

  const processor = PROCESSOR_FEES[normalizedCurrency] || DEFAULT_PROCESSOR_FEE
  return {
    percent: processor.percentRate,
    fixed: processor.fixedCents,
  }
}

/**
 * Calculate processing fee for a transaction
 */
export function calculateProcessingFee(amountCents: number, currency: string, isCrossBorder: boolean = false): number {
  const rate = getProcessingRate(currency, isCrossBorder)
  return Math.round(amountCents * rate.percent) + rate.fixed
}

/**
 * Calculate fees using new tiered model with direction support
 *
 * @param amountCents - Base amount in cents
 * @param currency - ISO currency code
 * @param options.tier - 'standard' or 'founding'
 * @param options.direction - 'recipient_pays' (subscriber pays face value) or 'payer_pays' (recipient gets full amount)
 * @param options.isCrossBorder - True if cross-border transaction
 */
export function calculateTieredFees(
  amountCents: number,
  currency: string,
  options: {
    tier?: FeeTier
    direction?: FeeDirection
    isCrossBorder?: boolean
  } = {}
): TieredFeeCalculation {
  const {
    tier = 'standard',
    direction = 'recipient_pays',
    isCrossBorder = false,
  } = options

  const normalizedCurrency = currency.toUpperCase()

  if (amountCents <= 0) {
    return {
      payerPaysCents: 0,
      recipientReceivesCents: 0,
      platformFeeCents: 0,
      processingFeeCents: 0,
      totalFeeCents: 0,
      platformFeePercent: 0,
      processingFeePercent: 0,
      direction,
      tier,
      currency: normalizedCurrency,
    }
  }

  const platformFee = calculateTieredPlatformFee(amountCents, tier)
  const processingFee = calculateProcessingFee(amountCents, normalizedCurrency, isCrossBorder)
  const totalFee = platformFee + processingFee

  if (direction === 'recipient_pays') {
    // Subscriber pays face value, creator absorbs all fees
    return {
      payerPaysCents: amountCents,
      recipientReceivesCents: amountCents - totalFee,
      platformFeeCents: platformFee,
      processingFeeCents: processingFee,
      totalFeeCents: totalFee,
      platformFeePercent: (platformFee / amountCents) * 100,
      processingFeePercent: (processingFee / amountCents) * 100,
      direction,
      tier,
      currency: normalizedCurrency,
    }
  } else {
    // Payer pays extra so recipient gets the full amount
    // Need to gross up for processing (it's calculated on charged amount)
    const rate = getProcessingRate(normalizedCurrency, isCrossBorder)
    const baseWithPlatform = amountCents + platformFee
    // Solve: gross = baseWithPlatform + (gross * rate.percent) + rate.fixed
    // gross * (1 - rate.percent) = baseWithPlatform + rate.fixed
    // gross = (baseWithPlatform + rate.fixed) / (1 - rate.percent)
    const grossAmount = Math.ceil((baseWithPlatform + rate.fixed) / (1 - rate.percent))
    const actualProcessingFee = grossAmount - baseWithPlatform
    const actualTotalFee = platformFee + actualProcessingFee

    return {
      payerPaysCents: grossAmount,
      recipientReceivesCents: amountCents,
      platformFeeCents: platformFee,
      processingFeeCents: actualProcessingFee,
      totalFeeCents: actualTotalFee,
      platformFeePercent: (platformFee / amountCents) * 100,
      processingFeePercent: (actualProcessingFee / amountCents) * 100,
      direction,
      tier,
      currency: normalizedCurrency,
    }
  }
}

/**
 * Get effective platform fee rate for display
 * Shows the blended rate for amounts that cross the tier threshold
 */
export function getEffectivePlatformRate(amountCents: number, tier: FeeTier = 'standard'): number {
  if (amountCents <= 0) return 0
  const fee = calculateTieredPlatformFee(amountCents, tier)
  return (fee / amountCents) * 100
}
