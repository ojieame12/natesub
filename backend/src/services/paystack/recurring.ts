// Paystack Recurring Charges - Subscription Billing

import { paystackFetch, type TransactionData } from './client.js'

// Charge authorization for recurring payments
export async function chargeAuthorization(params: {
  authorizationCode: string
  email: string
  amount: number
  currency: string
  subaccountCode?: string
  metadata: Record<string, any>
  reference?: string
}): Promise<TransactionData> {
  const requestBody: Record<string, any> = {
    authorization_code: params.authorizationCode,
    email: params.email,
    amount: params.amount,
    currency: params.currency.toUpperCase(),
    metadata: params.metadata,
    reference: params.reference,
  }

  // Only add subaccount fields if subaccountCode is provided (legacy model)
  if (params.subaccountCode) {
    requestBody.subaccount = params.subaccountCode
    requestBody.bearer = 'account'
  }

  const response = await paystackFetch<TransactionData>('/transaction/charge_authorization', {
    method: 'POST',
    body: JSON.stringify(requestBody),
  })

  return response.data
}
