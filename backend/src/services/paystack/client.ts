// Paystack Base Client - HTTP wrapper, types, and constants
// API Docs: https://paystack.com/docs/api/

import { env } from '../../config/env.js'
import { maskAccountNumber } from '../../utils/pii.js'
import { paystackCircuitBreaker } from '../../utils/circuitBreaker.js'
import {
  PAYSTACK_COUNTRIES,
  isPaystackSupported as isPaystackSupportedFn,
  type PaystackCountry,
} from '../../utils/countryConfig.js'

export const PAYSTACK_API_URL = 'https://api.paystack.co'

// Mask sensitive data in API paths for logging (account numbers in querystrings)
export function maskPathForLogging(path: string): string {
  return path.replace(/account_number=([^&]+)/gi, (_, num) => `account_number=${maskAccountNumber(num)}`)
}

// Re-export from countryConfig (single source of truth)
export { PAYSTACK_COUNTRIES }
export type { PaystackCountry }

// Type guard version for runtime checks
export function isPaystackSupported(countryCode: string): countryCode is PaystackCountry {
  return isPaystackSupportedFn(countryCode)
}

// Types
export interface PaystackResponse<T> {
  status: boolean
  message: string
  data: T
}

export interface PaystackListResponse<T> extends PaystackResponse<T> {
  meta?: {
    total: number
    skipped: number
    perPage: number
    page: number
    pageCount: number
  }
}

export interface Bank {
  id: number
  name: string
  slug: string
  code: string
  longcode: string
  country: string
  currency: string
  type: string
  active: boolean
}

export interface ResolvedAccount {
  account_number: string
  account_name: string
  bank_id: number
}

export interface Subaccount {
  id: number
  subaccount_code: string
  business_name: string
  description: string | null
  primary_contact_name: string | null
  primary_contact_email: string | null
  primary_contact_phone: string | null
  percentage_charge: number
  settlement_bank: string
  account_number: string
  currency: string
  active: boolean
}

export interface TransactionInit {
  authorization_url: string
  access_code: string
  reference: string
}

export interface TransactionData {
  id: number
  reference: string
  amount: number
  currency: string
  status: string
  channel: string
  paid_at: string
  customer: {
    id: number
    email: string
    customer_code: string
  }
  authorization: {
    authorization_code: string
    card_type: string
    last4: string
    exp_month: string
    exp_year: string
    reusable: boolean
  }
  metadata: Record<string, any>
}

// Timeout for Paystack API calls (prevents hanging public page loads)
const PAYSTACK_TIMEOUT_MS = 10000 // 10 seconds

// Base fetch wrapper with circuit breaker protection and timeout
export async function paystackFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<PaystackResponse<T>> {
  const secretKey = env.PAYSTACK_SECRET_KEY

  if (!secretKey) {
    throw new Error('Paystack is not configured')
  }

  return paystackCircuitBreaker(async () => {
    // Add timeout via AbortController to prevent hanging requests
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PAYSTACK_TIMEOUT_MS)

    try {
      const response = await fetch(`${PAYSTACK_API_URL}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      })

      const data = await response.json()

      if (!response.ok || !data.status) {
        console.error(`[paystack] API error on ${maskPathForLogging(path)}: ${data.message || 'Unknown error'}`)
        throw new Error(data.message || 'Paystack API error')
      }

      return data
    } catch (err: any) {
      // Convert AbortError to a more descriptive timeout error
      if (err.name === 'AbortError') {
        console.error(`[paystack] Request timeout on ${maskPathForLogging(path)} after ${PAYSTACK_TIMEOUT_MS}ms`)
        throw new Error(`Paystack API timeout after ${PAYSTACK_TIMEOUT_MS}ms`)
      }
      throw err
    } finally {
      clearTimeout(timeoutId)
    }
  })
}

// Variant for list endpoints that returns meta for pagination
export async function paystackFetchList<T>(
  path: string,
  options: RequestInit = {}
): Promise<PaystackListResponse<T>> {
  return paystackFetch<T>(path, options) as Promise<PaystackListResponse<T>>
}

// Helper: Generate unique reference
// Paystack only allows alphanumeric characters and hyphens (no underscores)
export function generateReference(prefix = 'TX'): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}-${timestamp}-${random}`.toUpperCase()
}

// Helper: Convert amount to display format (handles zero-decimal currencies)
export function formatPaystackAmount(amount: number, currency: string): string {
  const ZERO_DECIMAL = ['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']
  const isZeroDecimal = ZERO_DECIMAL.includes(currency.toUpperCase())
  const displayAmount = isZeroDecimal ? amount : amount / 100

  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: isZeroDecimal ? 0 : 2,
    maximumFractionDigits: isZeroDecimal ? 0 : 2,
  })
  return formatter.format(displayAmount)
}
