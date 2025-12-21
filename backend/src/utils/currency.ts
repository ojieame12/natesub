// Zero-decimal currencies (from Stripe's documentation)
// These currencies don't use cents - the smallest unit is the main currency unit
// https://stripe.com/docs/currencies#zero-decimal
export const ZERO_DECIMAL_CURRENCIES = [
  'BIF', // Burundi Franc
  'CLP', // Chilean Peso
  'DJF', // Djiboutian Franc
  'GNF', // Guinean Franc
  'JPY', // Japanese Yen
  'KMF', // Comorian Franc
  'KRW', // South Korean Won
  'MGA', // Malagasy Ariary
  'PYG', // Paraguayan Guarani
  'RWF', // Rwandan Franc
  'UGX', // Ugandan Shilling
  'VND', // Vietnamese Dong
  'VUV', // Vanuatu Vatu
  'XAF', // Central African CFA Franc
  'XOF', // West African CFA Franc
  'XPF', // CFP Franc
] as const

export type ZeroDecimalCurrency = typeof ZERO_DECIMAL_CURRENCIES[number]

/**
 * Check if a currency is zero-decimal (no cents)
 */
export function isZeroDecimalCurrency(currencyCode: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.includes(currencyCode?.toUpperCase() as ZeroDecimalCurrency)
}

/**
 * Convert cents to display amount, accounting for zero-decimal currencies
 * For most currencies: 1000 cents → 10.00
 * For zero-decimal (JPY, KRW, etc): 1000 → 1000 (no conversion)
 */
export function centsToDisplayAmount(cents: number, currencyCode: string): number {
  if (isZeroDecimalCurrency(currencyCode)) {
    return cents // Already in main unit
  }
  return cents / 100
}

/**
 * Convert display amount to cents, accounting for zero-decimal currencies
 * For most currencies: 10.00 → 1000 cents
 * For zero-decimal (JPY, KRW, etc): 1000 → 1000 (no conversion)
 */
export function displayAmountToCents(amount: number, currencyCode: string): number {
  if (isZeroDecimalCurrency(currencyCode)) {
    return Math.round(amount) // Already in smallest unit
  }
  return Math.round(amount * 100)
}

/**
 * Format amount for display with currency symbol
 */
export function formatCurrency(amount: number, currencyCode: string): string {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
    // Zero-decimal currencies should not show decimal places
    minimumFractionDigits: isZeroDecimalCurrency(currencyCode) ? 0 : 2,
    maximumFractionDigits: isZeroDecimalCurrency(currencyCode) ? 0 : 2,
  })
  return formatter.format(amount)
}

/**
 * Format amount from cents with proper zero-decimal handling
 */
export function formatCurrencyFromCents(cents: number, currencyCode: string): string {
  const displayAmount = centsToDisplayAmount(cents, currencyCode)
  return formatCurrency(displayAmount, currencyCode)
}

// ============================================
// CURRENCY MINIMUM AMOUNTS (in cents/smallest units)
// ============================================
// These represent Stripe's minimum charge amounts plus a small buffer
// to ensure fees don't push the total below processor minimums.
// Values are in cents (or smallest unit for zero-decimal currencies).

export const CURRENCY_MINIMUM_AMOUNTS: Record<string, number> = {
  // Strong currencies (~$0.50 minimum for Stripe)
  USD: 100,   // $1.00
  EUR: 100,   // €1.00
  GBP: 100,   // £1.00
  CHF: 100,   // CHF 1.00
  CAD: 100,   // C$1.00
  AUD: 100,   // A$1.00
  NZD: 100,   // NZ$1.00
  SGD: 100,   // S$1.00
  HKD: 500,   // HK$5.00

  // Medium currencies
  INR: 5000,    // ₹50.00
  MXN: 2000,    // MX$20.00
  ZAR: 2000,    // R20.00
  THB: 3500,    // ฿35.00
  PHP: 5000,    // ₱50.00
  MYR: 500,     // RM5.00
  BRL: 500,     // R$5.00
  PLN: 500,     // 5 zł
  AED: 500,     // AED 5.00

  // Weaker currencies (larger numbers)
  NGN: 100000,  // ₦1,000.00 (~$0.65 at current rates)
  KES: 10000,   // KSh100.00 (~$0.77 at current rates)
  GHS: 1000,    // GH₵10.00 (~$0.83 at current rates)
  IDR: 1500000, // Rp15,000 (~$0.97 at current rates)

  // Zero-decimal currencies (in main units, not cents)
  JPY: 100,     // ¥100 (~$0.67)
  KRW: 1000,    // ₩1,000 (~$0.77)

  // European currencies
  SEK: 1000,    // 10 kr
  NOK: 1000,    // 10 kr
  DKK: 700,     // 7 kr
  CZK: 2500,    // 25 Kč
  HUF: 35000,   // 350 Ft
  RON: 500,     // 5 lei
}

// Default minimum for unlisted currencies (conservative: ~$1 equivalent)
const DEFAULT_MINIMUM_CENTS = 100

/**
 * Get the minimum amount (in cents/smallest units) for a currency
 */
export function getMinimumAmountCents(currencyCode: string): number {
  const code = currencyCode?.toUpperCase() || 'USD'
  return CURRENCY_MINIMUM_AMOUNTS[code] ?? DEFAULT_MINIMUM_CENTS
}

/**
 * Validate that an amount (in cents) meets the minimum for the currency
 */
export function validateMinimumAmount(
  amountCents: number,
  currencyCode: string
): { valid: boolean; minimumCents: number; minimumDisplay: string } {
  const minimumCents = getMinimumAmountCents(currencyCode)
  const valid = amountCents >= minimumCents
  const minimumDisplay = formatCurrencyFromCents(minimumCents, currencyCode)

  return { valid, minimumCents, minimumDisplay }
}
