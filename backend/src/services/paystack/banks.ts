// Paystack Bank Operations
// - List banks, resolve account, validate account

import { paystackFetch, type Bank, type ResolvedAccount, type PaystackCountry } from './client.js'

// List banks for a country
export async function listBanks(country: PaystackCountry): Promise<Bank[]> {
  const countryMap: Record<PaystackCountry, string> = {
    NG: 'nigeria',
    KE: 'kenya',
    ZA: 'south_africa',
  }

  const response = await paystackFetch<Bank[]>(
    `/bank?country=${countryMap[country]}&perPage=100`
  )

  return response.data.filter(bank => bank.active)
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
