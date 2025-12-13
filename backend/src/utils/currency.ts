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
