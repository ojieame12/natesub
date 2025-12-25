// Paystack Balance - Platform balance queries

import { paystackFetch } from './client.js'

// Get platform balance (not subaccount balance)
export async function getBalance(): Promise<{
  currency: string
  balance: number
}[]> {
  const response = await paystackFetch<{ currency: string; balance: number }[]>('/balance')
  return response.data
}
