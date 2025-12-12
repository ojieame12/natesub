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

    // Some currencies don't typically use decimals
    const noDecimalCurrencies = ['JPY', 'KRW', 'VND', 'IDR', 'HUF']
    const useDecimals = showDecimals ?? !noDecimalCurrencies.includes(code)

    const formattedAmount = useDecimals
        ? amount.toFixed(2)
        : Math.round(amount).toString()

    // For currencies with symbol after amount
    const symbolAfterCurrencies = ['SEK', 'NOK', 'DKK', 'PLN', 'CZK']
    if (symbolAfterCurrencies.includes(code)) {
        return `${formattedAmount} ${symbol}`
    }

    return `${symbol}${formattedAmount}`
}

/**
 * Format amount from cents
 */
export function formatCurrencyFromCents(
    amountCents: number,
    currencyCode: string = 'USD'
): string {
    return formatCurrency(amountCents / 100, currencyCode)
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
    const noDecimalCurrencies = ['JPY', 'KRW', 'VND', 'IDR', 'HUF', 'NGN', 'KES']
    const useDecimals = !noDecimalCurrencies.includes(code)

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

    // Thresholds for compact notation
    if (amount >= 1_000_000) {
        const millions = amount / 1_000_000
        // Show decimal only if not a whole number
        const formatted = millions % 1 === 0
            ? millions.toString()
            : millions.toFixed(1).replace(/\.0$/, '')
        return `${symbol}${formatted}M`
    }

    if (amount >= 10_000) {
        const thousands = amount / 1_000
        const formatted = thousands % 1 === 0
            ? thousands.toString()
            : thousands.toFixed(1).replace(/\.0$/, '')
        return `${symbol}${formatted}K`
    }

    // Under 10K, show with separators but no decimals for cleaner look
    if (amount >= 1_000) {
        return `${symbol}${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    }

    // Small amounts - show as-is
    return `${symbol}${amount}`
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
    if (amount >= 1_000_000) {
        const millions = amount / 1_000_000
        return millions % 1 === 0
            ? `${millions}M`
            : `${millions.toFixed(1).replace(/\.0$/, '')}M`
    }

    if (amount >= 10_000) {
        const thousands = amount / 1_000
        return thousands % 1 === 0
            ? `${thousands}K`
            : `${thousands.toFixed(1).replace(/\.0$/, '')}K`
    }

    if (amount >= 1_000) {
        return amount.toLocaleString('en-US', { maximumFractionDigits: 0 })
    }

    return amount.toString()
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
    ZAR: { personal: [200, 500, 1000, 2000], service: [2000, 5000, 10000, 20000] },
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
