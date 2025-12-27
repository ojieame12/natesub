/**
 * Shared Country Configuration
 * Single source of truth for country-specific behavior
 *
 * NOTE: When adding a new country, update:
 * 1. This file (add to appropriate array)
 * 2. Frontend regionConfig.ts (add to COUNTRIES array)
 * 3. Tests (countryConfig.test.ts)
 */

// Countries that skip address step (simpler KYC for cross-border Stripe)
export const SKIP_ADDRESS_COUNTRIES = ['NG', 'GH', 'KE'] as const
export type SkipAddressCountry = (typeof SKIP_ADDRESS_COUNTRIES)[number]

// Countries supported by Paystack subaccounts (creator onboarding)
// Note: GH is NOT supported - Ghana creators use Stripe cross-border only
export const PAYSTACK_COUNTRIES = ['NG', 'KE', 'ZA'] as const
export type PaystackCountry = (typeof PAYSTACK_COUNTRIES)[number]

// Countries where PAYERS can use Paystack (for checkout routing optimization)
// Includes GH because Ghanaian payers CAN use Paystack to pay NG/KE/ZA creators
// This is different from PAYSTACK_COUNTRIES which is for creator subaccount creation
export const PAYSTACK_PAYER_COUNTRIES = ['NG', 'KE', 'ZA', 'GH'] as const
export type PaystackPayerCountry = (typeof PAYSTACK_PAYER_COUNTRIES)[number]

// Stripe cross-border countries (USD/GBP/EUR subscription → local currency payout)
export const STRIPE_CROSS_BORDER_COUNTRIES = ['NG', 'GH', 'KE'] as const
export type StripeCrossBorderCountry = (typeof STRIPE_CROSS_BORDER_COUNTRIES)[number]

/**
 * Check if country should skip address step in onboarding
 * Cross-border countries have simpler Stripe verification
 */
export function shouldSkipAddress(code: string | null | undefined): boolean {
  if (!code) return false
  return SKIP_ADDRESS_COUNTRIES.includes(code.toUpperCase() as SkipAddressCountry)
}

/**
 * Check if country is supported by Paystack for subaccount creation
 */
export function isPaystackSupported(code: string | null | undefined): boolean {
  if (!code) return false
  return PAYSTACK_COUNTRIES.includes(code.toUpperCase() as PaystackCountry)
}

/**
 * Check if country uses Stripe cross-border payouts
 * These countries accept USD/GBP/EUR subscriptions, paid out in local currency
 */
export function isStripeCrossBorder(code: string | null | undefined): boolean {
  if (!code) return false
  return STRIPE_CROSS_BORDER_COUNTRIES.includes(code.toUpperCase() as StripeCrossBorderCountry)
}

/**
 * Get Paystack currency for a supported country
 */
export function getPaystackCurrency(code: string | null | undefined): string | undefined {
  if (!code) return undefined
  const upper = code.toUpperCase()
  switch (upper) {
    case 'NG':
      return 'NGN'
    case 'KE':
      return 'KES'
    case 'ZA':
      return 'ZAR'
    default:
      return undefined
  }
}
