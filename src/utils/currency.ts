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

/**
 * Check if a currency is zero-decimal (no cents)
 */
export function isZeroDecimalCurrency(currencyCode: string): boolean {
    return ZERO_DECIMAL_CURRENCIES.includes(currencyCode?.toUpperCase() as any)
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

// Currency symbol mapping for supported currencies
const currencySymbols: Record<string, string> = {
    // Americas
    USD: '$',
    CAD: 'C$',
    MXN: 'MX$',
    BRL: 'R$',

    // Europe
    EUR: '€',
    GBP: '£',
    CHF: 'Fr',
    SEK: 'kr',
    NOK: 'kr',
    DKK: 'kr',
    PLN: 'zł',
    CZK: 'Kč',
    RON: 'lei',
    HUF: 'Ft',

    // Asia Pacific
    JPY: '¥',
    CNY: '¥',
    HKD: 'HK$',
    SGD: 'S$',
    AUD: 'A$',
    NZD: 'NZ$',
    INR: '₹',
    PHP: '₱',
    MYR: 'RM',
    THB: '฿',
    IDR: 'Rp',

    // Middle East & Africa
    AED: 'د.إ',
    NGN: '₦',
    ZAR: 'R',
    KES: 'KSh',
    GHS: 'GH₵',
    XOF: 'CFA', // West African CFA Franc (Côte d'Ivoire)

    // Eastern Europe
    BGN: 'лв', // Bulgarian Lev
}

/**
 * Get the currency symbol for a given currency code
 * Falls back to the code itself if symbol not found
 */
export function getCurrencySymbol(currencyCode: string): string {
    return currencySymbols[currencyCode?.toUpperCase()] || currencyCode || '$'
}

/**
 * Format an amount with the appropriate currency symbol
 * @param amount - The amount (in dollars/main unit, not cents)
 * @param currencyCode - The currency code (e.g., 'USD', 'EUR')
 * @param showDecimals - Whether to show decimal places (default: true for most, false for JPY)
 */
export function formatCurrency(
    amount: number,
    currencyCode: string = 'USD',
    showDecimals?: boolean
): string {
    const symbol = getCurrencySymbol(currencyCode)
    const code = currencyCode?.toUpperCase() || 'USD'

    // Some currencies don't typically use decimals (for UI cleanliness)
    const noDecimalCurrencies = ['JPY', 'KRW', 'VND', 'IDR', 'HUF', 'NGN', 'KES'] as const
    const useDecimals = showDecimals ?? !noDecimalCurrencies.includes(code as any)

    const formattedAmount = amount.toLocaleString('en-US', {
        minimumFractionDigits: useDecimals ? 2 : 0,
        maximumFractionDigits: useDecimals ? 2 : 0,
    })

    // For currencies with symbol after amount
    const symbolAfterCurrencies = ['SEK', 'NOK', 'DKK', 'PLN', 'CZK']
    if (symbolAfterCurrencies.includes(code)) {
        return `${formattedAmount} ${symbol}`
    }

    return `${symbol}${formattedAmount}`
}

/**
 * Format amount from cents, handling zero-decimal currencies correctly
 * For most currencies: 1000 cents → $10.00
 * For zero-decimal (JPY, KRW, etc): 1000 → ¥1,000
 */
export function formatCurrencyFromCents(
    amountCents: number,
    currencyCode: string = 'USD'
): string {
    const displayAmount = centsToDisplayAmount(amountCents, currencyCode)
    return formatCurrency(displayAmount, currencyCode)
}

/**
 * Format amount with thousand separators (e.g., 200,000)
 * Use for detail views, payment summaries, etc.
 */
export function formatAmountWithSeparators(
    amount: number,
    currencyCode: string = 'USD'
): string {
    const symbol = getCurrencySymbol(currencyCode)
    const code = currencyCode?.toUpperCase() || 'USD'

    // Some currencies don't use decimals
    const noDecimalCurrencies = ['JPY', 'KRW', 'VND', 'IDR', 'HUF', 'NGN', 'KES'] as const
    const useDecimals = !noDecimalCurrencies.includes(code as any)

    const formatted = amount.toLocaleString('en-US', {
        minimumFractionDigits: useDecimals ? 2 : 0,
        maximumFractionDigits: useDecimals ? 2 : 0,
    })

    // For currencies with symbol after amount
    const symbolAfterCurrencies = ['SEK', 'NOK', 'DKK', 'PLN', 'CZK']
    if (symbolAfterCurrencies.includes(code)) {
        return `${formatted} ${symbol}`
    }

    return `${symbol}${formatted}`
}

/**
 * Format amount in compact notation for tight UI spaces
 * e.g., 1000 → 1K, 1500000 → 1.5M
 * Use for hero sections, buttons, cards where space is limited
 */
export function formatCompactAmount(
    amount: number,
    currencyCode: string = 'USD'
): string {
    const symbol = getCurrencySymbol(currencyCode)
    const code = currencyCode?.toUpperCase() || 'USD'
    const symbolAfterCurrencies = ['SEK', 'NOK', 'DKK', 'PLN', 'CZK']
    const attachSymbol = (formatted: string) => (
        symbolAfterCurrencies.includes(code) ? `${formatted} ${symbol}` : `${symbol}${formatted}`
    )

    // Thresholds for compact notation
    if (amount >= 1_000_000_000_000) {
        const trillions = amount / 1_000_000_000_000
        const formatted = trillions % 1 === 0
            ? trillions.toString()
            : trillions.toFixed(1).replace(/\.0$/, '')
        return attachSymbol(`${formatted}T`)
    }

    if (amount >= 1_000_000_000) {
        const billions = amount / 1_000_000_000
        const formatted = billions % 1 === 0
            ? billions.toString()
            : billions.toFixed(1).replace(/\.0$/, '')
        return attachSymbol(`${formatted}B`)
    }

    if (amount >= 1_000_000) {
        const millions = amount / 1_000_000
        // Show decimal only if not a whole number
        const formatted = millions % 1 === 0
            ? millions.toString()
            : millions.toFixed(1).replace(/\.0$/, '')
        return attachSymbol(`${formatted}M`)
    }

    if (amount >= 10_000) {
        const thousands = amount / 1_000
        const formatted = thousands % 1 === 0
            ? thousands.toString()
            : thousands.toFixed(1).replace(/\.0$/, '')
        return attachSymbol(`${formatted}K`)
    }

    // Under 10K, show with separators but no decimals for cleaner look
    if (amount >= 1_000) {
        const formatted = amount.toLocaleString('en-US', { maximumFractionDigits: 0 })
        return attachSymbol(formatted)
    }

    // Small amounts - show with 2 decimals if not a whole number, otherwise clean
    // e.g., 14.4 → "14.40", 15 → "15", 14.00 → "14"
    const hasDecimals = amount % 1 !== 0
    const formatted = hasDecimals
        ? amount.toFixed(2)
        : amount.toString()
    return attachSymbol(formatted)
}

/**
 * Smart format that auto-selects based on context
 * @param amount - The amount to format
 * @param currencyCode - Currency code
 * @param maxLength - Max character length before switching to compact (default: 8)
 */
export function formatSmartAmount(
    amount: number,
    currencyCode: string = 'USD',
    maxLength: number = 8
): string {
    // First try full format with separators
    const fullFormat = formatAmountWithSeparators(amount, currencyCode)

    // If it fits, use it
    if (fullFormat.length <= maxLength) {
        return fullFormat
    }

    // Otherwise use compact
    return formatCompactAmount(amount, currencyCode)
}

/**
 * Format just the number in compact notation (no currency symbol)
 * Use when symbol is displayed separately for styling
 * e.g., 200000 → "200K", 1500000 → "1.5M"
 */
export function formatCompactNumber(amount: number): string {
    if (!Number.isFinite(amount)) return '0'

    const sign = amount < 0 ? '-' : ''
    const absAmount = Math.abs(amount)

    const formatWithUnit = (unitValue: number, suffix: string) => {
        const scaled = absAmount / unitValue
        const hasFraction = scaled % 1 !== 0
        const useDecimal = scaled < 100 && hasFraction
        const rounded = useDecimal
            ? Number(scaled.toFixed(1))
            : Number(scaled.toFixed(0))

        // If rounding pushes to the next unit (e.g., 999.95M → 1000M), bump up.
        if (rounded >= 1000) {
            if (suffix === 'K') return formatWithUnit(1_000_000, 'M')
            if (suffix === 'M') return formatWithUnit(1_000_000_000, 'B')
            if (suffix === 'B') return formatWithUnit(1_000_000_000_000, 'T')
        }

        const formatted = useDecimal
            ? rounded.toFixed(1).replace(/\.0$/, '')
            : rounded.toString()

        return `${sign}${formatted}${suffix}`
    }

    if (absAmount >= 1_000_000_000_000) return formatWithUnit(1_000_000_000_000, 'T')
    if (absAmount >= 1_000_000_000) return formatWithUnit(1_000_000_000, 'B')
    if (absAmount >= 1_000_000) return formatWithUnit(1_000_000, 'M')
    if (absAmount >= 10_000) return formatWithUnit(1_000, 'K')

    // Keep separators for 1,000–9,999, but preserve up to 2 decimals if present.
    if (absAmount >= 1_000) {
        return `${sign}${absAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
    }

    // Avoid long float strings leaking into UI (e.g., 10.49999997)
    return `${sign}${absAmount.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

/**
 * Format number with thousand separators (no currency symbol)
 * e.g., 200000 → "200,000"
 */
export function formatNumberWithSeparators(amount: number, decimals: boolean = false): string {
    return amount.toLocaleString('en-US', {
        minimumFractionDigits: decimals ? 2 : 0,
        maximumFractionDigits: decimals ? 2 : 0,
    })
}

// ============================================
// CURRENCY-AWARE SUGGESTED AMOUNTS
// ============================================

/**
 * Suggested amounts config per currency
 * Based on approximate USD equivalence and local conventions
 *
 * Personal: casual support, allowance, tips
 * Service: invoices, retainers, professional fees
 */
interface SuggestedAmountsConfig {
    personal: number[]
    service: number[]
}

const suggestedAmountsMap: Record<string, SuggestedAmountsConfig> = {
    // === TIER 1: Strong currencies (~1 USD) ===
    USD: { personal: [10, 25, 50, 100], service: [100, 250, 500, 1000] },
    EUR: { personal: [10, 25, 50, 100], service: [100, 250, 500, 1000] },
    GBP: { personal: [10, 25, 50, 100], service: [100, 250, 500, 1000] },
    CHF: { personal: [10, 25, 50, 100], service: [100, 250, 500, 1000] },
    CAD: { personal: [15, 30, 50, 100], service: [100, 250, 500, 1000] },
    AUD: { personal: [15, 30, 50, 100], service: [100, 250, 500, 1000] },
    NZD: { personal: [15, 30, 50, 100], service: [100, 250, 500, 1000] },
    SGD: { personal: [15, 30, 50, 100], service: [100, 250, 500, 1000] },
    HKD: { personal: [50, 100, 250, 500], service: [500, 1000, 2500, 5000] },

    // === TIER 2: Medium currencies ===
    // INR (~83 per USD)
    INR: { personal: [500, 1000, 2500, 5000], service: [5000, 10000, 25000, 50000] },
    // MXN (~17 per USD)
    MXN: { personal: [200, 500, 1000, 2000], service: [2000, 5000, 10000, 20000] },
    // ZAR (~18 per USD)
    ZAR: { personal: [850, 1000, 1500, 2000], service: [2000, 5000, 10000, 20000] },
    // THB (~35 per USD)
    THB: { personal: [350, 1000, 2000, 5000], service: [3500, 10000, 20000, 50000] },
    // PHP (~56 per USD)
    PHP: { personal: [500, 1000, 2500, 5000], service: [5000, 10000, 25000, 50000] },
    // MYR (~4.5 per USD)
    MYR: { personal: [20, 50, 100, 200], service: [200, 500, 1000, 2000] },
    // BRL (~5 per USD)
    BRL: { personal: [50, 100, 250, 500], service: [500, 1000, 2500, 5000] },
    // PLN (~4 per USD)
    PLN: { personal: [50, 100, 200, 500], service: [500, 1000, 2000, 5000] },
    // AED (~3.7 per USD)
    AED: { personal: [50, 100, 200, 500], service: [500, 1000, 2000, 5000] },

    // === TIER 3: Weaker currencies ===
    // NGN (~1500 per USD) - Nigerian Naira
    NGN: { personal: [5000, 10000, 25000, 50000], service: [50000, 100000, 250000, 500000] },
    // KES (~130 per USD) - Kenyan Shilling
    KES: { personal: [1000, 2500, 5000, 10000], service: [10000, 25000, 50000, 100000] },
    // GHS (~12 per USD) - Ghanaian Cedi
    GHS: { personal: [100, 250, 500, 1000], service: [1000, 2500, 5000, 10000] },

    // === TIER 4: Very weak currencies (large numbers) ===
    // IDR (~15500 per USD) - Indonesian Rupiah
    IDR: { personal: [50000, 100000, 250000, 500000], service: [500000, 1000000, 2500000, 5000000] },
    // VND (~24000 per USD) - Vietnamese Dong
    VND: { personal: [100000, 250000, 500000, 1000000], service: [1000000, 2500000, 5000000, 10000000] },

    // === Special: Zero-decimal currencies ===
    // JPY (~150 per USD)
    JPY: { personal: [1000, 2500, 5000, 10000], service: [10000, 25000, 50000, 100000] },
    // KRW (~1300 per USD)
    KRW: { personal: [10000, 25000, 50000, 100000], service: [100000, 250000, 500000, 1000000] },

    // === European currencies ===
    // SEK (~10 per USD)
    SEK: { personal: [100, 250, 500, 1000], service: [1000, 2500, 5000, 10000] },
    // NOK (~10 per USD)
    NOK: { personal: [100, 250, 500, 1000], service: [1000, 2500, 5000, 10000] },
    // DKK (~7 per USD)
    DKK: { personal: [75, 150, 350, 700], service: [700, 1500, 3500, 7000] },
    // CZK (~23 per USD)
    CZK: { personal: [250, 500, 1000, 2500], service: [2500, 5000, 10000, 25000] },
    // HUF (~360 per USD)
    HUF: { personal: [2500, 5000, 10000, 25000], service: [25000, 50000, 100000, 250000] },
    // RON (~4.5 per USD)
    RON: { personal: [50, 100, 200, 500], service: [500, 1000, 2000, 5000] },
    // BGN (~1.8 per USD) - Bulgarian Lev
    BGN: { personal: [20, 50, 100, 200], service: [200, 500, 1000, 2000] },

    // === West African CFA ===
    // XOF (~600 per USD) - Used by Côte d'Ivoire
    XOF: { personal: [5000, 10000, 25000, 50000], service: [50000, 100000, 250000, 500000] },
}

// Default fallback (USD-like)
const defaultSuggestedAmounts: SuggestedAmountsConfig = {
    personal: [10, 25, 50, 100],
    service: [100, 250, 500, 1000],
}

/**
 * Get suggested amounts for a currency
 * Returns appropriate values based on the currency's purchasing power
 */
export function getSuggestedAmounts(
    currencyCode: string,
    type: 'personal' | 'service' = 'personal'
): number[] {
    const code = currencyCode?.toUpperCase() || 'USD'
    const config = suggestedAmountsMap[code] || defaultSuggestedAmounts
    return config[type]
}

/**
 * Get minimum reasonable amount for a currency
 * Useful for validation
 */
export function getMinimumAmount(currencyCode: string): number {
    const amounts = getSuggestedAmounts(currencyCode, 'personal')
    return Math.floor(amounts[0] / 2) // Half of smallest suggestion
}

/**
 * Check if amount is reasonable for the currency
 * Returns true if amount is at least the minimum
 */
export function isReasonableAmount(amount: number, currencyCode: string): boolean {
    return amount >= getMinimumAmount(currencyCode)
}

// ============================================
// FEE CALCULATION (mirrors backend/services/fees.ts)
// Split Fee Model (v2): 4.5% subscriber + 4.5% creator = 9% total
// ============================================

// Import fee constants from pricing.ts (single source of truth for frontend)
import { SPLIT_RATE, CROSS_BORDER_BUFFER, type FeeConfigOverride } from './pricing'

export interface FeePreview {
    creatorReceives: number      // What creator gets (in dollars)
    subscriberPays: number       // Total subscriber pays (in dollars)
    serviceFee: number           // Subscriber's fee portion (4.5%)
    creatorFee: number           // Creator's fee portion (4.5%)
    totalFee: number             // Total platform fee
    effectiveRate: number        // Fee percentage
    effectiveRatePercent: string // Formatted as "X%"
    // New tiered model fields (optional for backward compat)
    platformFee?: number         // NatePay's cut (tiered: 5%/2%)
    processingFee?: number       // Stripe/Paystack pass-through
    platformFeePercent?: string  // e.g., "5%"
    processingFeePercent?: string // e.g., "~3%"
}

/**
 * Calculate fee preview using split model (4.5%/4.5%)
 * Both subscriber and creator pay 4.5% each = 9% total platform fee
 *
 * @param amountDollars - Creator's set price in dollars
 * @param _currency - Currency code (unused, kept for API compatibility)
 * @param _purpose - Creator's purpose (unused - all purposes use 9% now)
 * @param _feeMode - DEPRECATED: Ignored, always uses split model
 * @param isCrossBorder - Whether subscriber is in different country
 * @param feeConfig - Optional: pass values from useFeeConfig() hook
 */
export function calculateFeePreview(
    amountDollars: number,
    _currency: string,
    _purpose?: string | null,
    _feeMode?: 'absorb' | 'pass_to_subscriber' | 'split' | null,
    isCrossBorder: boolean = false,
    feeConfig?: FeeConfigOverride
): FeePreview {
    if (amountDollars === 0) {
        return {
            creatorReceives: 0,
            subscriberPays: 0,
            serviceFee: 0,
            creatorFee: 0,
            totalFee: 0,
            effectiveRate: 0,
            effectiveRatePercent: '0%',
        }
    }

    // Use provided config or fall back to module constants
    const baseSplitRate = feeConfig?.splitRate ?? SPLIT_RATE
    const crossBorderBuffer = feeConfig?.crossBorderBuffer ?? CROSS_BORDER_BUFFER

    // Calculate split rate (4% base, +0.75% each for cross-border)
    let splitRate = baseSplitRate
    if (isCrossBorder) {
        splitRate += crossBorderBuffer / 2 // Split the 1.5% evenly
    }

    // Both parties pay the same rate
    const subscriberFee = amountDollars * splitRate
    const creatorFee = amountDollars * splitRate
    const totalFee = subscriberFee + creatorFee

    return {
        creatorReceives: amountDollars - creatorFee,
        subscriberPays: amountDollars + subscriberFee,
        serviceFee: subscriberFee,     // What subscriber pays
        creatorFee: creatorFee,        // What creator pays
        totalFee: totalFee,            // Total platform fee
        effectiveRate: splitRate,
        effectiveRatePercent: `${(splitRate * 100).toFixed(2)}%`,
    }
}
