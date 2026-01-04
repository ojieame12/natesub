/**
 * NatePay Minimum Subscription Calculator
 *
 * FORMULA-BASED MINIMUMS - Single Source of Truth
 *
 * This file calculates minimum subscription amounts from actual Stripe fee inputs.
 *
 * ALL COUNTRIES use destination charges (platform absorbs Stripe fees).
 *
 * CROSS-BORDER COUNTRIES (NG, GH, KE, etc.):
 * - Flat $85 USD minimum (guarantees profit from subscriber #1)
 * - Based on real Stripe data showing ~6.3% processing
 * - Covers $2/month Express fee + processing overhead
 *
 * DOMESTIC COUNTRIES (US, UK, EU, etc.):
 * - Dynamic minimum based on subscriber count
 * - Lower fees = lower minimums
 *
 * Source: https://stripe.com/connect/pricing (2026-01-03)
 */

import { isCrossBorderCountry } from './fees.js'

// Flat minimum for cross-border countries (based on real Stripe fee data)
// $85 guarantees profit from subscriber #1 after $2/month Express fee
const CROSS_BORDER_MINIMUM_USD = 85

// ============================================
// PLATFORM CONFIGURATION
// ============================================

const PLATFORM_FEE_RATE = 0.09 // 9% total platform fee (for destination charges)
const FLOOR_SUBSCRIBER_COUNT = 20 // Floor minimum for established creators

// ============================================
// COUNTRY-SPECIFIC FEE CONFIGURATIONS
// ============================================

// Cross-border transfer rates by region
const CROSS_BORDER_RATES = {
  US: 0,           // Domestic - no cross-border
  SEPA: 0.0025,    // 0.25% for EU/EEA
  UK: 0.0025,      // 0.25%
  STANDARD: 0.01,  // 1% for most others
}

// Payout fees by country (in cents USD equivalent)
const PAYOUT_FEES: Record<string, number> = {
  // Tier 1: Low payout fees ($0.25)
  'United States': 25,
  'Brazil': 25,
  'Japan': 25,
  'Turkey': 25,

  // Tier 2: Standard ($0.25-0.50)
  'Egypt': 50,
  'Nigeria': 67, // $0.67
  'Canada': 25,
  'New Zealand': 25,
  'Norway': 25,
  'Sweden': 25,
  'Hungary': 50,
  'Singapore': 25,

  // EU countries (SEPA - low fees)
  'Austria': 25, 'Belgium': 25, 'Croatia': 25, 'Cyprus': 25,
  'Estonia': 25, 'Finland': 25, 'France': 25, 'Germany': 25,
  'Greece': 25, 'Ireland': 25, 'Italy': 25, 'Latvia': 25,
  'Lithuania': 25, 'Luxembourg': 25, 'Malta': 25, 'Netherlands': 25,
  'Portugal': 25, 'Slovakia': 25, 'Slovenia': 25, 'Spain': 25,

  // Tier 3: Medium ($0.50-1.00)
  'Ghana': 67,
  'Czech Republic': 50,
  'Thailand': 75,
  'Indonesia': 75,
  'Mexico': 75,
  'United Kingdom': 25,
  'Gibraltar': 25,
  'Bangladesh': 100,
  'South Africa': 75,
  'Morocco': 75,
  'Switzerland': 25,
  'Liechtenstein': 25,
  'Australia': 25,
  'Poland': 50,
  'Hong Kong': 50,
  'India': 75,
  'Kenya': 100,
  'Malaysia': 75,
  'Denmark': 25,
  'Pakistan': 100,
  'Romania': 50,
  'Rwanda': 100,

  // Tier 4: High ($1.00+)
  'South Korea': 100,
  'Philippines': 100,
  'Tanzania': 125,
  'Vietnam': 100,
  'Taiwan': 100,
  'Jordan': 125,
  'Bulgaria': 75,
  'Sri Lanka': 125,
  'Saudi Arabia': 150,
  'Qatar': 150,
  'United Arab Emirates': 163, // $1.63
  'Oman': 163,
  'Bahrain': 163,
  'Kuwait': 163,
}

// Currency multipliers (USD to local, approximate)
// NOTE: This includes all countries in CREATOR_MINIMUMS for local currency display.
// This is NOT the list of supported countries - see regionConfig.ts for that.
// Countries like BD/PK/EG are here for currency conversion but not enabled for signups.
const CURRENCY_INFO: Record<string, { currency: string; multiplier: number }> = {
  'United States': { currency: 'USD', multiplier: 1 },
  'Brazil': { currency: 'BRL', multiplier: 5.9 },
  'Japan': { currency: 'JPY', multiplier: 150 },
  'Turkey': { currency: 'TRY', multiplier: 34 },
  'Egypt': { currency: 'EGP', multiplier: 50 },
  'Nigeria': { currency: 'NGN', multiplier: 1600 },
  'Canada': { currency: 'CAD', multiplier: 1.36 },
  'New Zealand': { currency: 'NZD', multiplier: 1.68 },
  'Norway': { currency: 'NOK', multiplier: 11 },
  'Sweden': { currency: 'SEK', multiplier: 10.6 },
  'Hungary': { currency: 'HUF', multiplier: 370 },
  'Singapore': { currency: 'SGD', multiplier: 1.35 },
  // EU (all EUR)
  'Austria': { currency: 'EUR', multiplier: 0.92 },
  'Belgium': { currency: 'EUR', multiplier: 0.92 },
  'Croatia': { currency: 'EUR', multiplier: 0.92 },
  'Cyprus': { currency: 'EUR', multiplier: 0.92 },
  'Estonia': { currency: 'EUR', multiplier: 0.92 },
  'Finland': { currency: 'EUR', multiplier: 0.92 },
  'France': { currency: 'EUR', multiplier: 0.92 },
  'Germany': { currency: 'EUR', multiplier: 0.92 },
  'Greece': { currency: 'EUR', multiplier: 0.92 },
  'Ireland': { currency: 'EUR', multiplier: 0.92 },
  'Italy': { currency: 'EUR', multiplier: 0.92 },
  'Latvia': { currency: 'EUR', multiplier: 0.92 },
  'Lithuania': { currency: 'EUR', multiplier: 0.92 },
  'Luxembourg': { currency: 'EUR', multiplier: 0.92 },
  'Malta': { currency: 'EUR', multiplier: 0.92 },
  'Netherlands': { currency: 'EUR', multiplier: 0.92 },
  'Portugal': { currency: 'EUR', multiplier: 0.92 },
  'Slovakia': { currency: 'EUR', multiplier: 0.92 },
  'Slovenia': { currency: 'EUR', multiplier: 0.92 },
  'Spain': { currency: 'EUR', multiplier: 0.92 },
  'Ghana': { currency: 'GHS', multiplier: 16.1 },
  'Czech Republic': { currency: 'CZK', multiplier: 23.3 },
  'Thailand': { currency: 'THB', multiplier: 34.5 },
  'Indonesia': { currency: 'IDR', multiplier: 16100 },
  'Mexico': { currency: 'MXN', multiplier: 17.2 },
  'United Kingdom': { currency: 'GBP', multiplier: 0.79 },
  'Gibraltar': { currency: 'GBP', multiplier: 0.79 },
  'Bangladesh': { currency: 'BDT', multiplier: 120 },
  'South Africa': { currency: 'ZAR', multiplier: 18.2 },
  'Morocco': { currency: 'MAD', multiplier: 10.1 },
  'Switzerland': { currency: 'CHF', multiplier: 0.885 },
  'Liechtenstein': { currency: 'CHF', multiplier: 0.885 },
  'Australia': { currency: 'AUD', multiplier: 1.54 },
  'Poland': { currency: 'PLN', multiplier: 4 },
  'Hong Kong': { currency: 'HKD', multiplier: 7.8 },
  'India': { currency: 'INR', multiplier: 83.5 },
  'Kenya': { currency: 'KES', multiplier: 130 },
  'Malaysia': { currency: 'MYR', multiplier: 4.55 },
  'Denmark': { currency: 'DKK', multiplier: 6.9 },
  'Pakistan': { currency: 'PKR', multiplier: 278 },
  'Romania': { currency: 'RON', multiplier: 4.6 },
  'Rwanda': { currency: 'RWF', multiplier: 1370 },
  'South Korea': { currency: 'KRW', multiplier: 1390 },
  'Philippines': { currency: 'PHP', multiplier: 58.8 },
  'Tanzania': { currency: 'TZS', multiplier: 2560 },
  'Vietnam': { currency: 'VND', multiplier: 25000 },
  'Taiwan': { currency: 'TWD', multiplier: 32.3 },
  'Jordan': { currency: 'JOD', multiplier: 0.71 },
  'Bulgaria': { currency: 'BGN', multiplier: 1.8 },
  'Sri Lanka': { currency: 'LKR', multiplier: 323 },
  'Saudi Arabia': { currency: 'SAR', multiplier: 3.75 },
  'Qatar': { currency: 'QAR', multiplier: 3.64 },
  'United Arab Emirates': { currency: 'AED', multiplier: 3.67 },
  'Oman': { currency: 'OMR', multiplier: 0.385 },
  'Bahrain': { currency: 'BHD', multiplier: 0.377 },
  'Kuwait': { currency: 'KWD', multiplier: 0.308 },
}

// Cross-border rate by country
function getCrossBorderRate(country: string): number {
  if (country === 'United States') return CROSS_BORDER_RATES.US
  if (country === 'United Kingdom' || country === 'Gibraltar') return CROSS_BORDER_RATES.UK

  // EU/SEPA countries
  const sepaCountries = [
    'Austria', 'Belgium', 'Croatia', 'Cyprus', 'Estonia', 'Finland', 'France',
    'Germany', 'Greece', 'Ireland', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg',
    'Malta', 'Netherlands', 'Portugal', 'Slovakia', 'Slovenia', 'Spain',
    'Norway', 'Sweden', 'Denmark', 'Poland', 'Czech Republic', 'Hungary',
    'Romania', 'Bulgaria', 'Switzerland', 'Liechtenstein',
  ]
  if (sepaCountries.includes(country)) return CROSS_BORDER_RATES.SEPA

  return CROSS_BORDER_RATES.STANDARD
}

// ============================================
// MINIMUM CALCULATION FORMULA
// ============================================

/**
 * Calculate floor minimum subscription amount in USD.
 * This uses the dynamic formula with a high subscriber count,
 * representing an established creator (20+ subscribers).
 */
function calculateMinimumUSD(country: string): number {
  return calculateDynamicMinimumUSD({ country, subscriberCount: FLOOR_SUBSCRIBER_COUNT })
}

// ============================================
// GENERATED MINIMUMS (Single Source of Truth)
// ============================================

export interface CreatorMinimum {
  usd: number
  local: number
  currency: string
  // Audit fields
  _calculatedMargin: number  // Net margin after all fees
  _totalFeePercent: number   // Total percentage fees
}

function generateMinimums(): Record<string, CreatorMinimum> {
  const minimums: Record<string, CreatorMinimum> = {}

  for (const country of Object.keys(CURRENCY_INFO)) {
    const dynamicMinimum = getDynamicMinimum({
      country,
      subscriberCount: FLOOR_SUBSCRIBER_COUNT,
    })

    minimums[country] = {
      usd: dynamicMinimum.minimumUSD,
      local: dynamicMinimum.minimumLocal,
      currency: dynamicMinimum.currency,
      _calculatedMargin: dynamicMinimum.netMarginRate,
      _totalFeePercent: dynamicMinimum.percentFees,
    }
  }

  return minimums
}

// ============================================
// DYNAMIC MINIMUM CALCULATION (Subscriber-Based)
// ============================================

/**
 * Updated fee constants for dynamic calculation
 * Uses hybrid approach: different international subscriber assumptions by country type
 */
const DYNAMIC_FEES = {
  processing: 0.029,        // 2.9% (Stripe base)
  billing: 0.007,           // 0.7% (Stripe Billing - subscriptions)
  payoutPercent: 0.0025,    // 0.25% (payout fee percentage)
  intlCard: 0.015,          // 1.5% international card surcharge
  fx: 0.02,                 // 2% currency conversion (non-US platform)
  fixedCents: 30,           // $0.30 per transaction
  monthlyAccountCents: 200, // $2.00/month per connected account
}

function getInternationalMix(country: string): number {
  // Cross-border countries have 100% international cards (all subscribers are international)
  // Domestic countries (US, UK, EU) have ~70% international mix
  return isCrossBorderCountry(country) ? 1.0 : 0.7
}

function getPercentFeeInputs(country: string) {
  const crossBorderRate = getCrossBorderRate(country)
  const intlMix = getInternationalMix(country)
  const percentFees =
    DYNAMIC_FEES.processing +
    DYNAMIC_FEES.billing +
    DYNAMIC_FEES.payoutPercent +
    crossBorderRate +
    (DYNAMIC_FEES.intlCard * intlMix) +
    (DYNAMIC_FEES.fx * intlMix)

  return {
    percentFees,
    intlMix,
    crossBorderRate,
  }
}

export interface DynamicMinimumParams {
  country: string
  subscriberCount: number
}

export interface DynamicMinimumResult {
  minimumUSD: number
  minimumLocal: number
  currency: string
  subscriberCount: number
  percentFees: number
  fixedCents: number
  netMarginRate: number
}

/**
 * Calculate minimum subscription based on country
 *
 * CROSS-BORDER COUNTRIES: Flat $85 minimum (based on real Stripe data)
 * DOMESTIC COUNTRIES: Dynamic minimum based on subscriber count
 */
export function calculateDynamicMinimumUSD(params: DynamicMinimumParams): number {
  const { country, subscriberCount } = params

  // Cross-border countries use flat $85 minimum
  if (isCrossBorderCountry(country)) {
    return CROSS_BORDER_MINIMUM_USD
  }

  // Domestic countries use dynamic calculation
  const effectiveSubs = Math.max(1, subscriberCount)

  const payoutFixedCents = PAYOUT_FEES[country] ?? 100
  const { percentFees } = getPercentFeeInputs(country)

  // Fixed fees per transaction (including amortized account fee)
  const accountFeePerSub = DYNAMIC_FEES.monthlyAccountCents / effectiveSubs
  const fixedCents = DYNAMIC_FEES.fixedCents + payoutFixedCents + accountFeePerSub

  const netMarginRate = PLATFORM_FEE_RATE - percentFees
  if (netMarginRate <= 0) {
    console.warn(`[creatorMinimums] Non-viable margin for ${country}: ${(netMarginRate * 100).toFixed(2)}%`)
    return 99999
  }

  const minimumCents = fixedCents / netMarginRate
  return Math.ceil(minimumCents / 100 / 5) * 5 // Round up to nearest $5
}

/**
 * Get detailed dynamic minimum with all calculation components
 */
export function getDynamicMinimum(params: DynamicMinimumParams): DynamicMinimumResult {
  const { country, subscriberCount } = params
  const effectiveSubs = Math.max(1, subscriberCount)
  const countryInfo = CURRENCY_INFO[country]

  // Cross-border countries use flat $85 minimum
  if (isCrossBorderCountry(country)) {
    const minimumUSD = CROSS_BORDER_MINIMUM_USD

    // Calculate local currency amount
    let minimumLocal = minimumUSD
    if (countryInfo) {
      const { multiplier } = countryInfo
      if (multiplier >= 100) {
        minimumLocal = Math.ceil((minimumUSD * multiplier) / 1000) * 1000
      } else if (multiplier >= 10) {
        minimumLocal = Math.ceil((minimumUSD * multiplier) / 100) * 100
      } else {
        minimumLocal = Math.ceil((minimumUSD * multiplier) / 5) * 5
      }
    }

    return {
      minimumUSD,
      minimumLocal,
      currency: countryInfo?.currency || 'USD',
      subscriberCount: effectiveSubs,
      percentFees: 0.063, // Based on real Stripe data
      fixedCents: 97, // $0.30 + $0.67 payout
      netMarginRate: 0.027, // 9% - 6.3%
    }
  }

  // Domestic countries use dynamic calculation
  const payoutFixedCents = PAYOUT_FEES[country] ?? 100
  const { percentFees } = getPercentFeeInputs(country)

  const accountFeePerSub = DYNAMIC_FEES.monthlyAccountCents / effectiveSubs
  const fixedCents = DYNAMIC_FEES.fixedCents + payoutFixedCents + accountFeePerSub
  const netMarginRate = PLATFORM_FEE_RATE - percentFees

  const minimumUSD = netMarginRate <= 0
    ? 99999
    : Math.ceil((fixedCents / netMarginRate) / 100 / 5) * 5

  // Calculate local currency amount
  let minimumLocal = minimumUSD
  if (countryInfo) {
    const { multiplier } = countryInfo
    if (multiplier >= 100) {
      minimumLocal = Math.ceil((minimumUSD * multiplier) / 1000) * 1000
    } else if (multiplier >= 10) {
      minimumLocal = Math.ceil((minimumUSD * multiplier) / 100) * 100
    } else {
      minimumLocal = Math.ceil((minimumUSD * multiplier) / 5) * 5
    }
  }

  return {
    minimumUSD,
    minimumLocal,
    currency: countryInfo?.currency || 'USD',
    subscriberCount: effectiveSubs,
    percentFees,
    fixedCents,
    netMarginRate,
  }
}

// ============================================
// GENERATED DATA
// ============================================

// Generate minimums using floor subscriber count (established creator scenario)
export const CREATOR_MINIMUMS = generateMinimums()

// ============================================
// PUBLIC API
// ============================================

/**
 * Get minimum subscription for a creator's country
 * Returns null if country is not supported
 */
export function getCreatorMinimum(country: string): CreatorMinimum | null {
  return CREATOR_MINIMUMS[country] ?? null
}

/**
 * Check if a subscription amount meets the minimum for a country
 * ALWAYS compares in USD to avoid FX drift issues
 */
export function meetsMinimum(country: string, amountUSD: number): boolean {
  const min = CREATOR_MINIMUMS[country]
  if (!min) return false
  return amountUSD >= min.usd
}

/**
 * Get all supported countries
 */
export function getSupportedCountries(): string[] {
  return Object.keys(CREATOR_MINIMUMS)
}

/**
 * Check if a country is supported
 */
export function isCountrySupported(country: string): boolean {
  return country in CREATOR_MINIMUMS
}

/**
 * Get the fee breakdown for a country (for transparency/debugging)
 * Matches the dynamic minimum calculation assumptions
 */
export function getFeeBreakdown(country: string) {
  const payoutFixedCents = PAYOUT_FEES[country] ?? 100
  const crossBorderRate = getCrossBorderRate(country)
  const intlMix = getInternationalMix(country)

  // Match the dynamic formula's percent fee calculation
  const percentFees = {
    processing: DYNAMIC_FEES.processing,           // 2.9%
    billing: DYNAMIC_FEES.billing,                 // 0.7%
    payoutPercent: DYNAMIC_FEES.payoutPercent,     // 0.25%
    crossBorder: crossBorderRate,                  // 0-1%
    intlCard: DYNAMIC_FEES.intlCard * intlMix,     // 1.5% * intlMix
    fx: DYNAMIC_FEES.fx * intlMix,                 // 2% * intlMix
  }

  const totalPercentFees = (
    percentFees.processing +
    percentFees.billing +
    percentFees.payoutPercent +
    percentFees.crossBorder +
    percentFees.intlCard +
    percentFees.fx
  )

  return {
    // Percent fees (applied to transaction amount)
    processingPercent: percentFees.processing,
    billingPercent: percentFees.billing,
    payoutPercent: percentFees.payoutPercent,
    crossBorderPercent: percentFees.crossBorder,
    intlCardPercent: percentFees.intlCard,
    fxPercent: percentFees.fx,
    totalPercentFees,
    // Fixed fees (per transaction or per creator)
    fixedFeeCents: DYNAMIC_FEES.fixedCents,
    payoutFixedCents,
    monthlyAccountFeeCents: DYNAMIC_FEES.monthlyAccountCents,
    // Assumptions
    intlMix, // 1.0 for cross-border countries, 0.7 for domestic
    platformFeeRate: PLATFORM_FEE_RATE,
    netMarginRate: PLATFORM_FEE_RATE - totalPercentFees,
  }
}

// Log generated minimums on startup (for audit)
if (process.env.NODE_ENV !== 'test') {
  console.log('[creatorMinimums] Generated minimums:')
  const sorted = Object.entries(CREATOR_MINIMUMS).sort((a, b) => a[1].usd - b[1].usd)
  for (const [country, min] of sorted.slice(0, 5)) {
    console.log(`  ${country}: $${min.usd} USD (${min.currency} ${min.local})`)
  }
  console.log(`  ... and ${sorted.length - 5} more countries`)
}
