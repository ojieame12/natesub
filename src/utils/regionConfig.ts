/**
 * Centralized Region & Currency Configuration
 *
 * SINGLE SOURCE OF TRUTH for:
 * - Supported countries and their properties
 * - Payment provider availability per country
 * - Cross-border payout status
 * - Currency mappings and display info
 *
 * When adding a new country:
 * 1. Add entry to COUNTRIES array
 * 2. If cross-border, add SWIFT codes to swiftCodes.ts
 * 3. If new currency, add to currency.ts (symbols, suggested amounts)
 */

export type PaymentProvider = 'stripe' | 'paystack'

export interface CountryConfig {
  code: string           // ISO 3166-1 alpha-2 (e.g., 'NG')
  name: string           // Display name (e.g., 'Nigeria')
  flag: string           // Emoji flag
  currency: string       // ISO 4217 currency code (e.g., 'NGN')
  currencyName: string   // Human-readable (e.g., 'Naira')
  currencySymbol: string // Display symbol (e.g., '₦')
  providers: PaymentProvider[] // Available payment providers
  crossBorder: boolean   // True if using Stripe cross-border payouts (USD subscription → local payout)
  skipAddress: boolean   // True if address step skipped in onboarding (simpler KYC)
  region: 'africa' | 'europe' | 'americas' | 'asia' | 'oceania' | 'middle_east'
}

// ============================================
// COUNTRY CONFIGURATIONS
// ============================================

export const COUNTRIES: CountryConfig[] = [
  // === AFRICA ===
  // Cross-border countries: subscription in USD/GBP/EUR, payout in local currency
  {
    code: 'NG',
    name: 'Nigeria',
    flag: '🇳🇬',
    currency: 'NGN',
    currencyName: 'Naira',
    currencySymbol: '₦',
    providers: ['stripe'], // Paystack paused for Stripe-first launch
    crossBorder: true,
    skipAddress: true,
    region: 'africa',
  },
  {
    code: 'KE',
    name: 'Kenya',
    flag: '🇰🇪',
    currency: 'KES',
    currencyName: 'Shillings',
    currencySymbol: 'KSh',
    providers: ['stripe'], // Paystack paused for Stripe-first launch
    crossBorder: true,
    skipAddress: true,
    region: 'africa',
  },
  {
    code: 'GH',
    name: 'Ghana',
    flag: '🇬🇭',
    currency: 'GHS',
    currencyName: 'Cedis',
    currencySymbol: 'GH₵',
    providers: ['stripe'], // No Paystack in Ghana
    crossBorder: true,
    skipAddress: true,
    region: 'africa',
  },
  // South Africa: Cross-border Stripe, Paystack supported
  // Has asterisk (*) on Stripe pricing = cross-border only, not native
  {
    code: 'ZA',
    name: 'South Africa',
    flag: '🇿🇦',
    currency: 'ZAR',
    currencyName: 'Rand',
    currencySymbol: 'R',
    providers: ['stripe'], // Paystack paused for Stripe-first launch
    crossBorder: true, // Cross-border payouts only
    skipAddress: true, // Simplified KYC like other cross-border
    region: 'africa',
  },
  // NOTE: Côte d'Ivoire (CI) removed - Paystack doesn't support subaccount creation for CI creators
  // If Paystack adds CI support in the future, re-add with providers: ['paystack']

  // === AMERICAS ===
  {
    code: 'US',
    name: 'United States',
    flag: '🇺🇸',
    currency: 'USD',
    currencyName: 'Dollar',
    currencySymbol: '$',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'americas',
  },
  {
    code: 'CA',
    name: 'Canada',
    flag: '🇨🇦',
    currency: 'CAD',
    currencyName: 'Dollar',
    currencySymbol: 'C$',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'americas',
  },
  {
    code: 'MX',
    name: 'Mexico',
    flag: '🇲🇽',
    currency: 'MXN',
    currencyName: 'Peso',
    currencySymbol: 'MX$',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'americas',
  },
  {
    code: 'BR',
    name: 'Brazil',
    flag: '🇧🇷',
    currency: 'BRL',
    currencyName: 'Real',
    currencySymbol: 'R$',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'americas',
  },

  // === EUROPE ===
  {
    code: 'GB',
    name: 'United Kingdom',
    flag: '🇬🇧',
    currency: 'GBP',
    currencyName: 'Pound',
    currencySymbol: '£',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'DE',
    name: 'Germany',
    flag: '🇩🇪',
    currency: 'EUR',
    currencyName: 'Euro',
    currencySymbol: '€',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'FR',
    name: 'France',
    flag: '🇫🇷',
    currency: 'EUR',
    currencyName: 'Euro',
    currencySymbol: '€',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'ES',
    name: 'Spain',
    flag: '🇪🇸',
    currency: 'EUR',
    currencyName: 'Euro',
    currencySymbol: '€',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'IT',
    name: 'Italy',
    flag: '🇮🇹',
    currency: 'EUR',
    currencyName: 'Euro',
    currencySymbol: '€',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'NL',
    name: 'Netherlands',
    flag: '🇳🇱',
    currency: 'EUR',
    currencyName: 'Euro',
    currencySymbol: '€',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'BE',
    name: 'Belgium',
    flag: '🇧🇪',
    currency: 'EUR',
    currencyName: 'Euro',
    currencySymbol: '€',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'IE',
    name: 'Ireland',
    flag: '🇮🇪',
    currency: 'EUR',
    currencyName: 'Euro',
    currencySymbol: '€',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'PT',
    name: 'Portugal',
    flag: '🇵🇹',
    currency: 'EUR',
    currencyName: 'Euro',
    currencySymbol: '€',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'AT',
    name: 'Austria',
    flag: '🇦🇹',
    currency: 'EUR',
    currencyName: 'Euro',
    currencySymbol: '€',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'CH',
    name: 'Switzerland',
    flag: '🇨🇭',
    currency: 'CHF',
    currencyName: 'Franc',
    currencySymbol: 'Fr',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'SE',
    name: 'Sweden',
    flag: '🇸🇪',
    currency: 'SEK',
    currencyName: 'Krona',
    currencySymbol: 'kr',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'NO',
    name: 'Norway',
    flag: '🇳🇴',
    currency: 'NOK',
    currencyName: 'Krone',
    currencySymbol: 'kr',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'DK',
    name: 'Denmark',
    flag: '🇩🇰',
    currency: 'DKK',
    currencyName: 'Krone',
    currencySymbol: 'kr',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'FI',
    name: 'Finland',
    flag: '🇫🇮',
    currency: 'EUR',
    currencyName: 'Euro',
    currencySymbol: '€',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'PL',
    name: 'Poland',
    flag: '🇵🇱',
    currency: 'PLN',
    currencyName: 'Zloty',
    currencySymbol: 'zł',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'CZ',
    name: 'Czech Republic',
    flag: '🇨🇿',
    currency: 'CZK',
    currencyName: 'Koruna',
    currencySymbol: 'Kč',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'RO',
    name: 'Romania',
    flag: '🇷🇴',
    currency: 'RON',
    currencyName: 'Leu',
    currencySymbol: 'lei',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'HU',
    name: 'Hungary',
    flag: '🇭🇺',
    currency: 'HUF',
    currencyName: 'Forint',
    currencySymbol: 'Ft',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'BG',
    name: 'Bulgaria',
    flag: '🇧🇬',
    currency: 'BGN',
    currencyName: 'Lev',
    currencySymbol: 'лв',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'HR',
    name: 'Croatia',
    flag: '🇭🇷',
    currency: 'EUR',
    currencyName: 'Euro',
    currencySymbol: '€',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'CY',
    name: 'Cyprus',
    flag: '🇨🇾',
    currency: 'EUR',
    currencyName: 'Euro',
    currencySymbol: '€',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'EE',
    name: 'Estonia',
    flag: '🇪🇪',
    currency: 'EUR',
    currencyName: 'Euro',
    currencySymbol: '€',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'GR',
    name: 'Greece',
    flag: '🇬🇷',
    currency: 'EUR',
    currencyName: 'Euro',
    currencySymbol: '€',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'LV',
    name: 'Latvia',
    flag: '🇱🇻',
    currency: 'EUR',
    currencyName: 'Euro',
    currencySymbol: '€',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'LT',
    name: 'Lithuania',
    flag: '🇱🇹',
    currency: 'EUR',
    currencyName: 'Euro',
    currencySymbol: '€',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'LU',
    name: 'Luxembourg',
    flag: '🇱🇺',
    currency: 'EUR',
    currencyName: 'Euro',
    currencySymbol: '€',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'MT',
    name: 'Malta',
    flag: '🇲🇹',
    currency: 'EUR',
    currencyName: 'Euro',
    currencySymbol: '€',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'SK',
    name: 'Slovakia',
    flag: '🇸🇰',
    currency: 'EUR',
    currencyName: 'Euro',
    currencySymbol: '€',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'SI',
    name: 'Slovenia',
    flag: '🇸🇮',
    currency: 'EUR',
    currencyName: 'Euro',
    currencySymbol: '€',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'GI',
    name: 'Gibraltar',
    flag: '🇬🇮',
    currency: 'GBP',
    currencyName: 'Pound',
    currencySymbol: '£',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },
  {
    code: 'LI',
    name: 'Liechtenstein',
    flag: '🇱🇮',
    currency: 'CHF',
    currencyName: 'Franc',
    currencySymbol: 'Fr',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'europe',
  },

  // === ASIA PACIFIC ===
  {
    code: 'SG',
    name: 'Singapore',
    flag: '🇸🇬',
    currency: 'SGD',
    currencyName: 'Dollar',
    currencySymbol: 'S$',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'asia',
  },
  {
    code: 'HK',
    name: 'Hong Kong',
    flag: '🇭🇰',
    currency: 'HKD',
    currencyName: 'Dollar',
    currencySymbol: 'HK$',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'asia',
  },
  {
    code: 'JP',
    name: 'Japan',
    flag: '🇯🇵',
    currency: 'JPY',
    currencyName: 'Yen',
    currencySymbol: '¥',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'asia',
  },
  {
    code: 'AU',
    name: 'Australia',
    flag: '🇦🇺',
    currency: 'AUD',
    currencyName: 'Dollar',
    currencySymbol: 'A$',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'oceania',
  },
  {
    code: 'NZ',
    name: 'New Zealand',
    flag: '🇳🇿',
    currency: 'NZD',
    currencyName: 'Dollar',
    currencySymbol: 'NZ$',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'oceania',
  },
  // India (IN) removed — Stripe has limited support for India (backend STRIPE_UNSUPPORTED_REGIONS)
  // Re-add when Stripe India support is confirmed and backend isStripeSupported('IN') returns true
  {
    code: 'PH',
    name: 'Philippines',
    flag: '🇵🇭',
    currency: 'PHP',
    currencyName: 'Peso',
    currencySymbol: '₱',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'asia',
  },
  {
    code: 'MY',
    name: 'Malaysia',
    flag: '🇲🇾',
    currency: 'MYR',
    currencyName: 'Ringgit',
    currencySymbol: 'RM',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'asia',
  },
  {
    code: 'TH',
    name: 'Thailand',
    flag: '🇹🇭',
    currency: 'THB',
    currencyName: 'Baht',
    currencySymbol: '฿',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'asia',
  },
  {
    code: 'ID',
    name: 'Indonesia',
    flag: '🇮🇩',
    currency: 'IDR',
    currencyName: 'Rupiah',
    currencySymbol: 'Rp',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'asia',
  },

  // === MIDDLE EAST ===
  {
    code: 'AE',
    name: 'United Arab Emirates',
    flag: '🇦🇪',
    currency: 'AED',
    currencyName: 'Dirham',
    currencySymbol: 'د.إ',
    providers: ['stripe'],
    crossBorder: false,
    skipAddress: false,
    region: 'middle_east',
  },
]

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get country config by code
 */
export function getCountry(code: string | null | undefined): CountryConfig | undefined {
  if (!code) return undefined
  return COUNTRIES.find(c => c.code.toUpperCase() === code.toUpperCase())
}

/**
 * Get all countries as simple list for dropdowns
 */
export function getCountryList(): { code: string; name: string; flag: string; currency: string }[] {
  return COUNTRIES.map(c => ({
    code: c.code,
    name: c.name,
    flag: c.flag,
    currency: c.currency,
  }))
}

/**
 * Check if country uses cross-border payouts (USD subscription → local payout)
 */
export function isCrossBorderCountry(code: string | null | undefined): boolean {
  const country = getCountry(code)
  return country?.crossBorder ?? false
}

/**
 * Check if country should skip address step in onboarding
 */
export function shouldSkipAddress(code: string | null | undefined): boolean {
  const country = getCountry(code)
  return country?.skipAddress ?? false
}

/**
 * Get available payment providers for a country
 */
export function getAvailableProviders(code: string | null | undefined): PaymentProvider[] {
  const country = getCountry(code)
  return country?.providers ?? ['stripe']
}

/**
 * Check if Paystack is available for a country
 */
export function hasPaystack(code: string | null | undefined): boolean {
  return getAvailableProviders(code).includes('paystack')
}

/**
 * Check if Stripe is available for a country
 */
export function hasStripe(code: string | null | undefined): boolean {
  return getAvailableProviders(code).includes('stripe')
}

/**
 * Get currency for a country
 */
export function getCountryCurrency(code: string | null | undefined): string {
  const country = getCountry(code)
  return country?.currency ?? 'USD'
}

/**
 * Get local currency display name for cross-border messaging
 * e.g., "Naira (NGN)" or "Shillings (KES)"
 */
export function getLocalCurrencyName(code: string | null | undefined): string {
  const country = getCountry(code)
  if (!country) return 'local currency'
  return `${country.currencyName} (${country.currency})`
}

/**
 * Get all cross-border country codes
 */
export function getCrossBorderCountryCodes(): string[] {
  return COUNTRIES.filter(c => c.crossBorder).map(c => c.code)
}

/**
 * Get all Paystack-supported country codes
 */
export function getPaystackCountryCodes(): string[] {
  return COUNTRIES.filter(c => c.providers.includes('paystack')).map(c => c.code)
}

/**
 * Get Paystack currency for a country (returns undefined if not supported)
 */
export function getPaystackCurrency(code: string | null | undefined): string | undefined {
  const country = getCountry(code)
  if (!country || !country.providers.includes('paystack')) return undefined
  return country.currency
}

/**
 * Get countries by region
 */
export function getCountriesByRegion(region: CountryConfig['region']): CountryConfig[] {
  return COUNTRIES.filter(c => c.region === region)
}

/**
 * Get African countries (for UI grouping)
 */
export function getAfricanCountries(): CountryConfig[] {
  return getCountriesByRegion('africa')
}

/**
 * Check if a country is in Africa
 */
export function isAfricanCountry(code: string | null | undefined): boolean {
  const country = getCountry(code)
  return country?.region === 'africa'
}

// ============================================
// CROSS-BORDER CURRENCY OPTIONS
// For cross-border creators, these are the currencies they can accept
// (subscription currency, not payout currency)
// ============================================

export interface CrossBorderCurrency {
  code: string
  symbol: string
  label: string
}

export const CROSS_BORDER_CURRENCIES: CrossBorderCurrency[] = [
  { code: 'USD', symbol: '$', label: 'USD' },
]

/**
 * Get cross-border currency options for subscription pricing
 */
export function getCrossBorderCurrencyOptions(): CrossBorderCurrency[] {
  return CROSS_BORDER_CURRENCIES
}

// ============================================
// UI HELPERS
// ============================================

/**
 * Check if a country uses Stripe cross-border payouts.
 * These countries have higher fees (10.5% vs 9%) and $45 minimum.
 * All countries use destination charges - platform absorbs Stripe fees.
 */
export function isStripeCrossBorderCountry(code: string | null | undefined): boolean {
  const country = getCountry(code)
  return Boolean(country?.crossBorder)
}

/**
 * Get Stripe description for UI
 * Returns appropriate message based on country
 */
export function getStripeDescription(code: string | null | undefined): string {
  const country = getCountry(code)
  if (!country) return 'Accept global cards'

  if (country.crossBorder) {
    // Cross-border: accepts USD/GBP/EUR, pays out in local
    return `Accept USD, GBP, EUR → Payout in ${country.currency}`
  }

  // Native: accepts in local currency
  return `Accept cards in ${country.currency}`
}

/**
 * Get Paystack description for UI
 */
export function getPaystackDescription(code: string | null | undefined): string {
  const country = getCountry(code)
  if (!country || !country.providers.includes('paystack')) {
    return 'Accept local cards'
  }
  return `Accept ${country.currency} (Local Audience)`
}

/**
 * Format provider currencies for display
 * e.g., "NGN, KES, ZAR" for Paystack countries
 */
export function formatPaystackCurrencies(): string {
  const currencies = getPaystackCountryCodes()
    .map(code => getCountry(code)?.currency)
    .filter((c): c is string => !!c)
  return [...new Set(currencies)].join(', ')
}

/**
 * Format Stripe currencies for display (global currencies)
 */
export function formatStripeCurrencies(): string {
  return 'USD, GBP, EUR'
}
