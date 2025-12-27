// Paystack Transactions - Checkout, Verification, and Listing

import { paystackFetch, paystackFetchList, type TransactionInit, type TransactionData } from './client.js'

// Transaction for list/reconciliation (different from TransactionData)
export interface PaystackTransaction {
  id: number
  reference: string
  amount: number
  currency: string
  status: 'success' | 'failed' | 'abandoned' | 'pending'
  channel: string
  paid_at: string | null
  created_at: string
  customer: {
    id: number
    email: string
    customer_code: string
  }
  metadata: Record<string, any> | null
  fees: number
  subaccount?: {
    subaccount_code: string
  }
}

interface TransactionListResponse {
  data: PaystackTransaction[]
  meta: {
    total: number
    skipped: number
    perPage: number
    page: number
    pageCount: number
  }
}

/**
 * Initialize checkout with subaccount split
 *
 * Uses Paystack subaccount to automatically split payments:
 * - Platform fee (8%) retained by platform via subaccount percentage_charge
 * - Creator receives the rest directly from Paystack on T+1 settlement
 */
export async function initializePaystackCheckout(params: {
  email: string
  amount: number
  currency: string
  subaccountCode: string
  callbackUrl: string
  reference: string
  metadata: {
    creatorId: string
    tierId?: string
    requestId?: string  // For request-based payments
    interval: string
    viewId?: string
    creatorAmount: number
    serviceFee: number
    feeModel: string
    feeMode: string
    feeEffectiveRate: number
    feeWasCapped?: boolean
    baseAmount?: number
    subscriberFee?: number
    creatorFee?: number
    checkoutIp?: string
    checkoutUserAgent?: string
    checkoutAcceptLanguage?: string
  }
}): Promise<TransactionInit> {
  const response = await paystackFetch<TransactionInit>('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: params.email,
      amount: params.amount,
      currency: params.currency.toUpperCase(),
      subaccount: params.subaccountCode,
      bearer: 'account',
      callback_url: params.callbackUrl,
      metadata: params.metadata,
      reference: params.reference,
      channels: ['card'],
    }),
  })

  return response.data
}

/**
 * Legacy: Initialize transaction with subaccount split
 * Used for existing subscriptions with percentage-based fees
 */
export async function initializeTransaction(params: {
  email: string
  amount: number
  currency: string
  subaccountCode: string
  callbackUrl: string
  metadata: Record<string, any>
  reference?: string
}): Promise<TransactionInit> {
  const response = await paystackFetch<TransactionInit>('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: params.email,
      amount: params.amount,
      currency: params.currency.toUpperCase(),
      subaccount: params.subaccountCode,
      bearer: 'account',
      callback_url: params.callbackUrl,
      metadata: params.metadata,
      reference: params.reference,
      channels: ['card'],
    }),
  })

  return response.data
}

// Verify transaction
export async function verifyTransaction(reference: string): Promise<TransactionData> {
  // SECURITY: Validate reference to prevent path traversal attacks
  if (!reference || !/^[a-zA-Z0-9_-]+$/.test(reference)) {
    throw new Error('Invalid transaction reference format')
  }

  const response = await paystackFetch<TransactionData>(
    `/transaction/verify/${encodeURIComponent(reference)}`
  )
  return response.data
}

/**
 * List transactions from Paystack
 * Used for reconciliation to compare DB records against Paystack's records
 */
export async function listTransactions(params: {
  from?: Date
  to?: Date
  status?: 'success' | 'failed' | 'abandoned'
  perPage?: number
  page?: number
}): Promise<{ transactions: PaystackTransaction[]; meta: TransactionListResponse['meta'] }> {
  const {
    from = new Date(Date.now() - 24 * 60 * 60 * 1000),
    to = new Date(),
    status,
    perPage = 100,
    page = 1,
  } = params

  const fromStr = from.toISOString()
  const toStr = to.toISOString()

  let url = `/transaction?perPage=${perPage}&page=${page}&from=${fromStr}&to=${toStr}`
  if (status) {
    url += `&status=${status}`
  }

  const response = await paystackFetchList<PaystackTransaction[]>(url)

  return {
    transactions: response.data,
    meta: response.meta || { total: response.data.length, skipped: 0, perPage, page, pageCount: 1 },
  }
}

/**
 * Fetch all transactions in a date range (handles pagination)
 */
export async function listAllTransactions(params: {
  from: Date
  to: Date
  status?: 'success' | 'failed' | 'abandoned'
}): Promise<PaystackTransaction[]> {
  const allTransactions: PaystackTransaction[] = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const { transactions, meta } = await listTransactions({
      ...params,
      perPage: 100,
      page,
    })

    allTransactions.push(...transactions)

    if (page >= meta.pageCount || transactions.length === 0) {
      hasMore = false
    } else {
      page++
    }

    if (page > 100) {
      console.warn('[paystack] listAllTransactions: Reached page limit (100)')
      break
    }
  }

  return allTransactions
}

/**
 * Get a single transaction by reference
 */
export async function getTransaction(reference: string): Promise<PaystackTransaction | null> {
  try {
    const response = await paystackFetch<PaystackTransaction>(`/transaction/verify/${reference}`)
    return response.data
  } catch (error) {
    console.error(`[paystack] Failed to fetch transaction ${reference}:`, error)
    return null
  }
}
