// FX Rate Service
// Fetches exchange rates from API with Redis caching
// Used for platform debit recovery in cross-border payments

import { redis } from '../db/redis.js'

const FX_CACHE_TTL = 3600 // 1 hour cache
const FX_CACHE_KEY = 'fx:usd:rates'

interface FXRates {
  USD_NGN: number
  USD_KES: number
  USD_ZAR: number
  USD_GHS: number
  fetchedAt: number
}

// Fallback rates if API fails (updated periodically)
// These are approximate rates as of late 2024
const FALLBACK_RATES: Record<string, number> = {
  NGN: 1600,  // 1 USD = ~1600 NGN
  KES: 155,   // 1 USD = ~155 KES
  ZAR: 18,    // 1 USD = ~18 ZAR
  GHS: 15,    // 1 USD = ~15 GHS
}

/**
 * Get the USD to target currency exchange rate
 * Uses Redis cache with 1 hour TTL, fetches from API if cache miss
 * Falls back to hardcoded rates if API fails
 */
export async function getUSDRate(targetCurrency: string): Promise<number> {
  const currency = targetCurrency.toUpperCase()

  // Try cache first
  try {
    const cached = await redis.get(FX_CACHE_KEY)
    if (cached) {
      const rates = JSON.parse(cached) as FXRates
      const key = `USD_${currency}` as keyof FXRates
      if (typeof rates[key] === 'number') {
        return rates[key] as number
      }
    }
  } catch (cacheErr) {
    console.error('[fx] Cache read error:', cacheErr)
  }

  // Fetch fresh rates from API
  try {
    const response = await fetch(
      'https://api.exchangerate-api.com/v4/latest/USD',
      { signal: AbortSignal.timeout(5000) } // 5 second timeout
    )

    if (!response.ok) {
      throw new Error(`FX API returned ${response.status}`)
    }

    const data = await response.json()

    if (!data.rates) {
      throw new Error('Invalid FX API response - missing rates')
    }

    const rates: FXRates = {
      USD_NGN: data.rates.NGN || FALLBACK_RATES.NGN,
      USD_KES: data.rates.KES || FALLBACK_RATES.KES,
      USD_ZAR: data.rates.ZAR || FALLBACK_RATES.ZAR,
      USD_GHS: data.rates.GHS || FALLBACK_RATES.GHS,
      fetchedAt: Date.now(),
    }

    // Cache the rates
    try {
      await redis.setex(FX_CACHE_KEY, FX_CACHE_TTL, JSON.stringify(rates))
    } catch (cacheErr) {
      console.error('[fx] Cache write error:', cacheErr)
    }

    const key = `USD_${currency}` as keyof FXRates
    const rate = rates[key]
    if (typeof rate === 'number') {
      console.log(`[fx] Fetched rate: 1 USD = ${rate} ${currency}`)
      return rate
    }

    // Currency not in our list, return fallback or 1
    return FALLBACK_RATES[currency] || 1
  } catch (err) {
    console.error('[fx] Failed to fetch rates, using fallback:', err)
    return FALLBACK_RATES[currency] || 1
  }
}

/**
 * Convert USD cents to local currency smallest unit
 * E.g., 500 USD cents at rate 1600 = 800000 NGN kobo
 */
export function convertUSDCentsToLocal(usdCents: number, rate: number): number {
  return Math.round(usdCents * rate)
}

/**
 * Convert local currency smallest unit to USD cents
 * E.g., 800000 NGN kobo at rate 1600 = 500 USD cents
 */
export function convertLocalCentsToUSD(localCents: number, rate: number): number {
  if (rate === 0) return 0
  return Math.round(localCents / rate)
}

/**
 * Check if a currency is a Paystack-supported local currency
 */
export function isLocalCurrency(currency: string): boolean {
  const localCurrencies = ['NGN', 'KES', 'ZAR', 'GHS']
  return localCurrencies.includes(currency.toUpperCase())
}
