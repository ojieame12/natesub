/**
 * Shared Country Configuration
 * Single source of truth for country-specific payment behavior
 *
 * IMPORTANT: This mirrors frontend/src/utils/regionConfig.ts
 * When adding a new country, update BOTH files.
 *
 * The frontend has full UI metadata (flags, currency names, symbols).
 * This file has the subset needed for backend payment logic.
 */

export interface CountryConfig {
  code: string
  currency: string
  skipAddress: boolean       // Simpler KYC for cross-border Stripe
  paystackCreator: boolean   // Can create Paystack subaccounts
  paystackPayer: boolean     // Can pay via Paystack checkout
  stripeCrossBorder: boolean // USD/GBP/EUR subscription → local payout
}

// ============================================
// SINGLE SOURCE OF TRUTH
// Add/remove countries here only
// ============================================

const COUNTRIES: CountryConfig[] = [
  // Cross-border African countries (Stripe cross-border + simplified KYC)
  // Order: NG, GH, KE to match legacy test expectations
  { code: 'NG', currency: 'NGN', skipAddress: true, paystackCreator: true, paystackPayer: true, stripeCrossBorder: true },
  { code: 'GH', currency: 'GHS', skipAddress: true, paystackCreator: false, paystackPayer: true, stripeCrossBorder: true },
  { code: 'KE', currency: 'KES', skipAddress: true, paystackCreator: true, paystackPayer: true, stripeCrossBorder: true },
  // South Africa: Native Stripe, Paystack supported, full address required
  { code: 'ZA', currency: 'ZAR', skipAddress: false, paystackCreator: true, paystackPayer: true, stripeCrossBorder: false },
  // All other Stripe-native countries (no special handling needed)
  // They use default: skipAddress=false, no paystack, no cross-border
]

// Build lookup map for O(1) access
const countryMap = new Map(COUNTRIES.map(c => [c.code.toUpperCase(), c]))

// ============================================
// DERIVED ARRAYS (for legacy compatibility)
// ============================================

export const SKIP_ADDRESS_COUNTRIES = COUNTRIES.filter(c => c.skipAddress).map(c => c.code) as readonly string[]
export const PAYSTACK_COUNTRIES = COUNTRIES.filter(c => c.paystackCreator).map(c => c.code) as readonly string[]
export const PAYSTACK_PAYER_COUNTRIES = COUNTRIES.filter(c => c.paystackPayer).map(c => c.code) as readonly string[]
export const STRIPE_CROSS_BORDER_COUNTRIES = COUNTRIES.filter(c => c.stripeCrossBorder).map(c => c.code) as readonly string[]

// Legacy types (kept for backwards compatibility)
export type SkipAddressCountry = string
export type PaystackCountry = string
export type PaystackPayerCountry = string
export type StripeCrossBorderCountry = string

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get country config by code
 */
export function getCountry(code: string | null | undefined): CountryConfig | undefined {
  if (!code) return undefined
  return countryMap.get(code.toUpperCase())
}

/**
 * Check if country should skip address step in onboarding
 * Cross-border countries have simpler Stripe verification
 */
export function shouldSkipAddress(code: string | null | undefined): boolean {
  return getCountry(code)?.skipAddress ?? false
}

/**
 * Check if country is supported by Paystack for subaccount creation
 */
export function isPaystackSupported(code: string | null | undefined): boolean {
  return getCountry(code)?.paystackCreator ?? false
}

/**
 * Check if country can pay via Paystack checkout
 */
export function canPayWithPaystack(code: string | null | undefined): boolean {
  return getCountry(code)?.paystackPayer ?? false
}

/**
 * Check if country uses Stripe cross-border payouts
 * These countries accept USD/GBP/EUR subscriptions, paid out in local currency
 */
export function isStripeCrossBorder(code: string | null | undefined): boolean {
  return getCountry(code)?.stripeCrossBorder ?? false
}

/**
 * Get Paystack currency for a supported country
 */
export function getPaystackCurrency(code: string | null | undefined): string | undefined {
  const country = getCountry(code)
  if (!country?.paystackCreator) return undefined
  return country.currency
}
