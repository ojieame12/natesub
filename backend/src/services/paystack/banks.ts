// Paystack Bank Operations
// - List banks, resolve account, validate account

import { paystackFetch, type Bank, type ResolvedAccount, type PaystackCountry } from './client.js'

// Bank list cache - banks don't change often, cache for 6 hours
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours
const bankListCache = new Map<string, { data: Bank[]; expiresAt: number }>()

// List banks for a country (with caching)
export async function listBanks(country: PaystackCountry): Promise<Bank[]> {
  // Check cache first
  const cached = bankListCache.get(country)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data
  }

  const countryMap: Record<PaystackCountry, string> = {
    NG: 'nigeria',
    KE: 'kenya',
    ZA: 'south_africa',
  }

  const response = await paystackFetch<Bank[]>(
    `/bank?country=${countryMap[country]}&perPage=100`
  )

  const banks = response.data.filter(bank => bank.active)

  // Cache the result
  bankListCache.set(country, {
    data: banks,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })

  return banks
}

// Resolve bank account (Nigeria & Ghana only)
export async function resolveAccount(
  accountNumber: string,
  bankCode: string
): Promise<ResolvedAccount> {
  const response = await paystackFetch<ResolvedAccount>(
    `/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`
  )

  return response.data
}

// Validate bank account (South Africa - requires ID)
export async function validateAccount(
  accountNumber: string,
  bankCode: string,
  accountType: 'personal' | 'business',
  documentType: string,
  documentNumber: string
): Promise<{ verified: boolean; account_name: string }> {
  const response = await paystackFetch<{ verified: boolean; account_name: string }>(
    '/bank/validate',
    {
      method: 'POST',
      body: JSON.stringify({
        account_number: accountNumber,
        bank_code: bankCode,
        account_type: accountType,
        document_type: documentType,
        document_number: documentNumber,
        country_code: 'ZA',
      }),
    }
  )

  return response.data
}
