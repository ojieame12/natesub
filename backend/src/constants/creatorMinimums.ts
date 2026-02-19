/**
 * NatePay Minimum Subscription Calculator
 *
 * FORMULA-BASED MINIMUMS - Single Source of Truth
 *
 * DESTINATION CHARGES (Case B): Platform is merchant of record.
 * Platform pays ALL these fees (verified from Stripe Connect + Balance):
 *
 * 1. PROCESSING (charged on platform balance per payment):
 *    - Base: 2.9% + $0.30
 *    - International cards: +1.5%
 *    - Effective: ~4.4% + $0.30 for international-heavy creators
 *
 * 2. CONNECT FEES (charged per creator):
 *    - Billing: 0.7% (Stripe Billing for subscriptions)
 *    - Cross-border transfer: 0.25%-1% (varies by destination country)
 *    - Payout: 0.25% + fixed (varies by country)
 *    - Monthly account: varies by country ($2 US, ₦900 NG, £2 UK, etc.)
 *
 * PLATFORM FEE STRUCTURE:
 * - Domestic (US, UK, EU): 9% total (4.5% subscriber + 4.5% creator)
 * - Cross-border (NG, GH, KE, ZA): 10.5% total (5.25% + 5.25%)
 *
 * IMPORTANT: Platform revenue is 8.61% of charge (not 9%) because fee is
 * calculated on base but charged on gross. See fees.ts for details.
 */

import { isCrossBorderCountry } from './fees.js'

// Minimum floor for cross-border countries (safety buffer)
// $45 floor is margin-positive at 3+ subscribers per creator.
// At $45 with 3 subs: ~$1.12/payment margin (conservative).
// Below $40 at 3 subs we go negative — $45 gives a safety buffer.
// DebiCheck rail (future) will allow lower ZA-local prices.
const CROSS_BORDER_MINIMUM_FLOOR_USD = 45

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
 * PLATFORM FEE CONSTANTS - Verified from Stripe dashboard Jan 2025
 *
 * DESTINATION CHARGES = Platform pays EVERYTHING:
 *
 * 1. PROCESSING (per payment, on platform balance):
 *    - 2.9% + $0.30 base
 *    - +1.5% for international cards
 *    - We use 3.5% as conservative estimate (mix of domestic/intl cards)
 *
 * 2. CONNECT FEES (per creator, in Connect activity):
 *    - Billing: 0.7%
 *    - Cross-border transfer: 0.25%-1%
 *    - Payout: 0.25% + fixed
 *    - Monthly account: varies by country
 */
const PROCESSING_FEES = {
  percent: 0.035,           // 3.5% conservative (2.9% + some intl card exposure)
  fixedCents: 30,           // $0.30 per payment
}

const CONNECT_FEES = {
  billing: 0.007,           // 0.7% (Stripe Billing for subscriptions)
  payoutPercent: 0.0025,    // 0.25% (payout fee percentage)
}

// Monthly account fees by country (in cents USD equivalent)
// Based on Stripe Connect pricing - fees are charged in local currency
const MONTHLY_ACCOUNT_FEES: Record<string, number> = {
  // US: $2.00/month
  'United States': 200,

  // UK: £2.00 ≈ $2.50
  'United Kingdom': 250,
  'Gibraltar': 250,

  // EU: €2.00 ≈ $2.20
  'Austria': 220, 'Belgium': 220, 'Croatia': 220, 'Cyprus': 220,
  'Estonia': 220, 'Finland': 220, 'France': 220, 'Germany': 220,
  'Greece': 220, 'Ireland': 220, 'Italy': 220, 'Latvia': 220,
  'Lithuania': 220, 'Luxembourg': 220, 'Malta': 220, 'Netherlands': 220,
  'Portugal': 220, 'Slovakia': 220, 'Slovenia': 220, 'Spain': 220,

  // Other EUR countries
  'Norway': 220, 'Sweden': 220, 'Denmark': 220, 'Poland': 220,
  'Czech Republic': 220, 'Hungary': 220, 'Romania': 220, 'Bulgaria': 220,
  'Switzerland': 220, 'Liechtenstein': 220,

  // Cross-border countries (lower local fees converted to USD)
  // Nigeria: ₦900 ≈ $0.60
  'Nigeria': 60,
  // Ghana: GH₵15 ≈ $0.95
  'Ghana': 95,
  // Kenya: KES240 ≈ $1.85
  'Kenya': 185,
  // South Africa: R35 ≈ $1.90
  'South Africa': 190,

  // Other countries (approximate based on Stripe pricing)
  'Canada': 200,
  'Australia': 200,
  'New Zealand': 200,
  'Japan': 200,
  'Singapore': 200,
  'Hong Kong': 200,
  'Brazil': 150,
  'Mexico': 150,
  'India': 150,
  'Indonesia': 150,
  'Thailand': 150,
  'Malaysia': 150,
  'Philippines': 150,
  'Vietnam': 150,
  'Taiwan': 200,
  'South Korea': 200,
  'Turkey': 150,
  'Egypt': 150,
  'Morocco': 150,
  'Bangladesh': 150,
  'Pakistan': 150,
  'Sri Lanka': 150,
  'Tanzania': 150,
  'Rwanda': 150,
  'Jordan': 150,
  'Saudi Arabia': 200,
  'United Arab Emirates': 200,
  'Qatar': 200,
  'Kuwait': 200,
  'Bahrain': 200,
  'Oman': 200,
}

function getPercentFeeInputs(country: string) {
  const crossBorderTransferRate = getCrossBorderRate(country)

  // Platform pays ALL of these (destination charges):
  // 1. Processing: ~3.5% (2.9% + intl card exposure)
  // 2. Billing: 0.7%
  // 3. Payout %: 0.25%
  // 4. Cross-border transfer: 0-1%
  const percentFees =
    PROCESSING_FEES.percent +
    CONNECT_FEES.billing +
    CONNECT_FEES.payoutPercent +
    crossBorderTransferRate

  return {
    percentFees,
    crossBorderTransferRate,
    processingPercent: PROCESSING_FEES.percent,
    billingPercent: CONNECT_FEES.billing,
    payoutPercent: CONNECT_FEES.payoutPercent,
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
 * Formula: minBase = totalFixedCosts / netMarginRate
 *
 * Where:
 * - totalFixedCosts = processing fixed ($0.30) + payout fixed + (account fee / subscribers)
 * - netMarginRate = platformFee - allPercentFees
 *
 * ALL COUNTRIES use dynamic calculation based on actual Stripe fees.
 * Cross-border countries have a floor minimum for safety.
 */
export function calculateDynamicMinimumUSD(params: DynamicMinimumParams): number {
  const { country, subscriberCount } = params
  const effectiveSubs = Math.max(1, subscriberCount)

  // Get fees for this country
  const payoutFixedCents = PAYOUT_FEES[country] ?? 100
  const monthlyAccountCents = MONTHLY_ACCOUNT_FEES[country] ?? 200 // Default to US rate
  const { percentFees } = getPercentFeeInputs(country)

  // Fixed fees per transaction:
  // 1. Processing fixed: $0.30
  // 2. Payout fixed: varies by country
  // 3. Account fee amortized: monthly fee / subscriber count
  const accountFeePerSub = monthlyAccountCents / effectiveSubs
  const fixedCents = PROCESSING_FEES.fixedCents + payoutFixedCents + accountFeePerSub

  // Cross-border countries use 10.5% platform fee (includes 1.5% buffer)
  const platformFeeRate = isCrossBorderCountry(country) ? 0.105 : PLATFORM_FEE_RATE
  const netMarginRate = platformFeeRate - percentFees

  if (netMarginRate <= 0) {
    console.warn(`[creatorMinimums] Non-viable margin for ${country}: ${(netMarginRate * 100).toFixed(2)}%`)
    return 99999
  }

  const minimumCents = fixedCents / netMarginRate
  let minimumUSD = Math.ceil(minimumCents / 100 / 5) * 5 // Round up to nearest $5

  // Cross-border countries have a floor minimum for safety
  if (isCrossBorderCountry(country)) {
    minimumUSD = Math.max(minimumUSD, CROSS_BORDER_MINIMUM_FLOOR_USD)
  }

  return minimumUSD
}

/**
 * Get detailed dynamic minimum with all calculation components
 * ALL countries now use dynamic calculation based on actual Stripe fees.
 */
export function getDynamicMinimum(params: DynamicMinimumParams): DynamicMinimumResult {
  const { country, subscriberCount } = params
  const effectiveSubs = Math.max(1, subscriberCount)
  const countryInfo = CURRENCY_INFO[country]

  // Get country-specific fees
  const payoutFixedCents = PAYOUT_FEES[country] ?? 100
  const monthlyAccountCents = MONTHLY_ACCOUNT_FEES[country] ?? 200
  const { percentFees } = getPercentFeeInputs(country)

  // Fixed costs per transaction
  const accountFeePerSub = monthlyAccountCents / effectiveSubs
  const fixedCents = PROCESSING_FEES.fixedCents + payoutFixedCents + accountFeePerSub

  // Cross-border countries use 10.5% platform fee (includes 1.5% buffer)
  const platformFeeRate = isCrossBorderCountry(country) ? 0.105 : PLATFORM_FEE_RATE
  const netMarginRate = platformFeeRate - percentFees

  let minimumUSD = netMarginRate <= 0
    ? 99999
    : Math.ceil((fixedCents / netMarginRate) / 100 / 5) * 5

  // Cross-border countries have a floor minimum for safety
  if (isCrossBorderCountry(country)) {
    minimumUSD = Math.max(minimumUSD, CROSS_BORDER_MINIMUM_FLOOR_USD)
  }

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
 * Shows ALL platform costs (destination charges = platform pays everything)
 */
export function getFeeBreakdown(country: string) {
  const payoutFixedCents = PAYOUT_FEES[country] ?? 100
  const monthlyAccountCents = MONTHLY_ACCOUNT_FEES[country] ?? 200
  const crossBorderTransferRate = getCrossBorderRate(country)

  // Platform pays ALL of these (destination charges)
  const totalPercentFees =
    PROCESSING_FEES.percent +
    CONNECT_FEES.billing +
    CONNECT_FEES.payoutPercent +
    crossBorderTransferRate

  // Cross-border countries get 10.5% platform fee (vs 9% domestic)
  const platformFeeRate = isCrossBorderCountry(country)
    ? PLATFORM_FEE_RATE + 0.015  // 10.5%
    : PLATFORM_FEE_RATE          // 9%

  return {
    // Percent fees (PLATFORM pays ALL these with destination charges)
    processingPercent: PROCESSING_FEES.percent,
    billingPercent: CONNECT_FEES.billing,
    payoutPercent: CONNECT_FEES.payoutPercent,
    crossBorderTransferPercent: crossBorderTransferRate,
    totalPercentFees,
    // Fixed fees (per transaction or per creator)
    processingFixedCents: PROCESSING_FEES.fixedCents,
    payoutFixedCents,
    monthlyAccountFeeCents: monthlyAccountCents,
    // Margin calculation
    platformFeeRate,
    netMarginRate: platformFeeRate - totalPercentFees,
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
