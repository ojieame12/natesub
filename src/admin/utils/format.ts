/**
 * Admin formatting utilities
 * Centralized logic for currency, dates, and numbers to ensure safety and consistency.
 */

/**
 * Safely formats a currency amount.
 * Handles:
 * - Missing/invalid currency codes (defaults to USD or fallback)
 * - Zero-decimal currencies (JPY, etc.)
 * - Runtime errors from Intl.NumberFormat
 *
 * @param cents - The amount in minor units (e.g., cents)
 * @param currency - The 3-letter currency code (e.g., 'USD', 'NGN'). Defaults to 'USD'.
 * @returns Formatted string (e.g., "$10.00", "₦500")
 */
export function formatCurrency(cents: number, currency: string = 'USD'): string {
  // 1. Safety check for invalid inputs
  if (typeof cents !== 'number' || isNaN(cents)) {
    return '0.00'
  }

  // 2. Normalize currency code
  const code = (currency || 'USD').toUpperCase()

  try {
    // 3. Create formatter to determine decimal places
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
    })

    // 4. Determine divisor based on currency's fraction digits
    // e.g. JPY -> 0 digits -> div 1
    //      USD -> 2 digits -> div 100
    //      BHD -> 3 digits -> div 1000
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2
    const divisor = Math.pow(10, digits)
    const value = cents / divisor

    return formatter.format(value)
  } catch (err) {
    // 5. Fallback if currency code is invalid (e.g., 'XYZ')
    // We log the error in development but fail gracefully in UI
    console.warn(`[formatCurrency] Invalid currency code: ${code}`, err)
    
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100) + ` ${code}`
  }
}

/**
 * Formats a generic number with commas
 */
export function formatNumber(num: number): string {
  if (typeof num !== 'number' || isNaN(num)) return '0'
  return new Intl.NumberFormat('en-US').format(num)
}

/**
 * Formats a date string to a readable format
 */
export function formatDate(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return '-'
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch (e) {
    return '-'
  }
}

/**
 * Formats a date string to include time
 */
export function formatDateTime(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return '-'
  try {
    return new Date(dateStr).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch (e) {
    return '-'
  }
}
