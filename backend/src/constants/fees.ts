/**
 * Fee Constants - Single source of truth for all fee calculations
 *
 * Split Fee Model:
 * - 4.5% paid by subscriber (added to price)
 * - 4.5% paid by creator (deducted from payout)
 * - 9% total platform fee
 *
 * Psychology: Neither party sees "9%" - both see 4.5% as reasonable.
 *
 * REALITY CHECK (based on actual Stripe data):
 * - Stripe takes ~6-7% on international cards (2.9% + 1.5% intl + 2% FX + 0.7% billing)
 * - Plus fixed fees: $0.30 per transaction, $2/month per account, payout fees
 * - Our 9% barely covers this, leaving ~2% margin
 * - At low prices with few subscribers, we go NEGATIVE
 *
 * Cross-border countries (NG, GH, KE, etc.) have higher minimums because:
 * - 100% international card usage (vs ~70% domestic)
 * - Higher payout fees
 * - All fees hit platform (destination charges)
 */

// Total platform fee rate: 9%
export const PLATFORM_FEE_RATE = 0.09

// Cross-border payout countries with higher fee burden
// These use Stripe Recipient Service Agreement (destination charges)
// Higher fees: 10.5% (vs 9% domestic), $85 flat minimum
// IMPORTANT: Must match STRIPE_CROSS_BORDER_COUNTRIES in utils/constants.ts
// South Africa has 0.5% cross-border fee (lower than NG/GH/KE at 1%)
export const CROSS_BORDER_PAYOUT_COUNTRIES = [
  'Nigeria', 'Ghana', 'Kenya', 'South Africa',
] as const

export type CrossBorderCountry = typeof CROSS_BORDER_PAYOUT_COUNTRIES[number]

/**
 * Check if a country is cross-border (higher Stripe fees)
 * These countries have 100% international cards = higher processing costs
 */
export function isCrossBorderCountry(country: string): boolean {
  return CROSS_BORDER_PAYOUT_COUNTRIES.includes(country as CrossBorderCountry)
}

// Split rate: each party pays 4.5%
export const SPLIT_RATE = 0.045

// Cross-border buffer for FX/Stripe surcharge: 1.5%
export const CROSS_BORDER_BUFFER = 0.015

// Processor fee estimates by currency (for margin calculation)
// These are conservative estimates to ensure we never go negative
export const PROCESSOR_FEES: Record<string, { percentRate: number; fixedCents: number }> = {
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
export const DEFAULT_PROCESSOR_FEE = { percentRate: 0.029, fixedCents: 30 }

// Minimum margin we want to keep after processor fees (in smallest currency unit)
// This ensures we're profitable on every transaction
export const MIN_MARGIN_CENTS: Record<string, number> = {
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
export const DEFAULT_MIN_MARGIN = 25

// Note: Country-based minimum subscription amounts are in creatorMinimums.ts
// These are based on actual Stripe fee calculations per creator country.
