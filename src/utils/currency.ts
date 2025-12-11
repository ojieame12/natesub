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
