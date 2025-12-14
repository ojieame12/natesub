// Paystack Service for Nigeria, Kenya, South Africa
// API Docs: https://paystack.com/docs/api/

import { env } from '../config/env.js'
import { db } from '../db/client.js'
import { maskAccountNumber, maskEmail } from '../utils/pii.js'
import { encryptAccountNumber, decryptAccountNumber } from '../utils/encryption.js'
import { getPlatformFeePercent, type UserPurpose } from './pricing.js'
import { paystackCircuitBreaker, CircuitBreakerError } from '../utils/circuitBreaker.js'

const PAYSTACK_API_URL = 'https://api.paystack.co'

// Supported countries for Paystack
export const PAYSTACK_COUNTRIES = ['NG', 'KE', 'ZA'] as const
export type PaystackCountry = typeof PAYSTACK_COUNTRIES[number]

// Check if a country is supported by Paystack
export function isPaystackSupported(countryCode: string): countryCode is PaystackCountry {
  return PAYSTACK_COUNTRIES.includes(countryCode as PaystackCountry)
}

// Types
interface PaystackResponse<T> {
  status: boolean
  message: string
  data: T
}

interface Bank {
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

interface ResolvedAccount {
  account_number: string
  account_name: string
  bank_id: number
}

interface Subaccount {
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

interface TransactionInit {
  authorization_url: string
  access_code: string
  reference: string
}

interface TransactionData {
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

// Base fetch wrapper with circuit breaker protection
async function paystackFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<PaystackResponse<T>> {
  const secretKey = env.PAYSTACK_SECRET_KEY

  if (!secretKey) {
    throw new Error('Paystack is not configured')
  }

  // Wrap API call in circuit breaker for resilience
  return paystackCircuitBreaker(async () => {
    const response = await fetch(`${PAYSTACK_API_URL}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })

    const data = await response.json()

    if (!response.ok || !data.status) {
      // Log error without exposing request body (may contain PII)
      console.error(`[paystack] API error on ${path}: ${data.message || 'Unknown error'}`)
      throw new Error(data.message || 'Paystack API error')
    }

    return data
  })
}

// ============================================
// BANK OPERATIONS
// ============================================

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

// ============================================
// SUBACCOUNT (Creator Onboarding)
// ============================================

// Create subaccount for a creator
export async function createSubaccount(params: {
  userId: string
  businessName: string
  bankCode: string
  accountNumber: string
  email: string
  phone?: string
  purpose?: UserPurpose // For dynamic fee calculation
}): Promise<{ subaccountCode: string }> {
  // Check if user already has a subaccount
  const profile = await db.profile.findUnique({ where: { userId: params.userId } })

  if (profile?.paystackSubaccountCode) {
    return { subaccountCode: profile.paystackSubaccountCode }
  }

  // Calculate platform fee based on creator's purpose (personal: 10%, service: 8%)
  const platformFeePercent = getPlatformFeePercent(params.purpose || profile?.purpose as UserPurpose)

  // Log creation attempt with masked PII
  console.log(`[paystack] Creating subaccount for user ${params.userId}, account ${maskAccountNumber(params.accountNumber)}, fee: ${platformFeePercent}%`)

  const response = await paystackFetch<Subaccount>('/subaccount', {
    method: 'POST',
    body: JSON.stringify({
      business_name: params.businessName,
      settlement_bank: params.bankCode,
      account_number: params.accountNumber,
      percentage_charge: platformFeePercent, // Dynamic: personal=10%, service=8%
      primary_contact_email: params.email,
      primary_contact_phone: params.phone,
      settlement_schedule: 'auto', // T+1 settlement
    }),
  })

  const subaccountCode = response.data.subaccount_code

  // Save to profile (encrypt sensitive account number)
  await db.profile.update({
    where: { userId: params.userId },
    data: {
      paystackSubaccountCode: subaccountCode,
      paystackBankCode: params.bankCode,
      paystackAccountNumber: encryptAccountNumber(params.accountNumber),
      paymentProvider: 'paystack',
      payoutStatus: 'active', // Paystack subaccounts are active immediately
    },
  })

  return { subaccountCode }
}

// Get subaccount details
export async function getSubaccount(subaccountCode: string): Promise<Subaccount> {
  const response = await paystackFetch<Subaccount>(`/subaccount/${subaccountCode}`)
  return response.data
}

// Update subaccount
export async function updateSubaccount(
  subaccountCode: string,
  data: {
    businessName?: string
    settlementBank?: string
    accountNumber?: string
    percentageCharge?: number
  }
): Promise<Subaccount> {
  const response = await paystackFetch<Subaccount>(`/subaccount/${subaccountCode}`, {
    method: 'PUT',
    body: JSON.stringify({
      business_name: data.businessName,
      settlement_bank: data.settlementBank,
      account_number: data.accountNumber,
      percentage_charge: data.percentageCharge,
    }),
  })
  return response.data
}

// Update subaccount fee when user's purpose changes
export async function updateSubaccountFee(
  userId: string,
  purpose: UserPurpose
): Promise<void> {
  const profile = await db.profile.findUnique({ where: { userId } })

  if (!profile?.paystackSubaccountCode) {
    return // No Paystack account to update
  }

  const newFeePercent = getPlatformFeePercent(purpose)

  console.log(`[paystack] Updating subaccount ${profile.paystackSubaccountCode} fee to ${newFeePercent}%`)

  await updateSubaccount(profile.paystackSubaccountCode, {
    percentageCharge: newFeePercent,
  })
}

// ============================================
// TRANSACTIONS (Checkout)
// ============================================

/**
 * Initialize checkout with subscriber-pays fee model
 *
 * New model: Platform receives full payment, then transfers to creator
 * This allows for progressive fees with caps that can't be expressed as percentages
 */
export async function initializePaystackCheckout(params: {
  email: string
  creatorAmount: number   // What creator will receive
  serviceFee: number      // Platform fee (flat: 10% personal, 8% service)
  totalAmount: number     // What subscriber pays (creatorAmount + serviceFee)
  currency: string
  callbackUrl: string
  reference: string
  metadata: {
    creatorId: string
    tierId?: string
    interval: string
    viewId?: string         // Analytics: page view ID for conversion tracking
    creatorAmount: number
    serviceFee: number
    feeModel: string
    feeMode: string         // 'absorb' | 'pass_to_subscriber'
    feeEffectiveRate: number
    feeWasCapped?: boolean  // Optional - flat fee model has no caps
  }
}): Promise<TransactionInit> {
  // Platform receives full payment (no subaccount split)
  // Creator payout will be handled via transfer after webhook confirmation
  const response = await paystackFetch<TransactionInit>('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: params.email,
      amount: params.totalAmount, // Subscriber pays total (creator amount + fee)
      currency: params.currency.toUpperCase(),
      // No subaccount - platform receives full amount
      callback_url: params.callbackUrl,
      metadata: params.metadata,
      reference: params.reference,
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
  amount: number // in smallest unit (kobo/cents)
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
      bearer: 'account', // Platform bears Paystack fees
      callback_url: params.callbackUrl,
      metadata: params.metadata,
      reference: params.reference,
    }),
  })

  return response.data
}

// Verify transaction
export async function verifyTransaction(reference: string): Promise<TransactionData> {
  const response = await paystackFetch<TransactionData>(
    `/transaction/verify/${reference}`
  )
  return response.data
}

// ============================================
// RECURRING CHARGES
// ============================================

// Charge authorization for recurring payments
export async function chargeAuthorization(params: {
  authorizationCode: string
  email: string
  amount: number // in smallest unit
  currency: string
  subaccountCode?: string // Optional - omit for new fee model
  metadata: Record<string, any>
  reference?: string
}): Promise<TransactionData> {
  // Build request body, only include subaccount if provided
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
    requestBody.bearer = 'account' // Platform bears Paystack fees
  }

  const response = await paystackFetch<TransactionData>('/transaction/charge_authorization', {
    method: 'POST',
    body: JSON.stringify(requestBody),
  })

  return response.data
}

// ============================================
// TRANSFERS (Paystack Payout API)
// Used to transfer creator's earnings to their bank via Paystack
// ============================================

// Get recipient type based on currency/country and account details
function getRecipientType(currency: string, bankCode?: string, accountNumber?: string): string {
  // Paystack requires different recipient types per country
  // NG: nuban (Nigerian Uniform Bank Account Number)
  // KE: mobile_money (M-PESA) or authorization (bank)
  // ZA: basa (Bank Account South Africa)
  switch (currency.toUpperCase()) {
    case 'NGN':
      return 'nuban'
    case 'KES':
      // Kenya supports both mobile money (M-PESA) and bank transfers
      // Mobile money accounts typically have phone number format (9-10 digits starting with 0 or 7)
      // Bank accounts typically have 10+ digits
      // M-PESA bank code is typically 'MPESA' or similar
      if (bankCode?.toLowerCase().includes('mpesa') ||
          bankCode?.toLowerCase().includes('safaricom') ||
          (accountNumber && /^0?7\d{8}$/.test(accountNumber))) {
        return 'mobile_money'
      }
      // For bank accounts in Kenya, use 'authorization' type
      // (Paystack Kenya bank transfers require pre-authorized recipients)
      return 'authorization'
    case 'ZAR':
      return 'basa'
    default:
      return 'nuban' // Fallback
  }
}

// Create transfer recipient
export async function createTransferRecipient(params: {
  name: string
  accountNumber: string
  bankCode: string
  currency: string
}): Promise<{ recipientCode: string }> {
  // Get recipient type based on currency and account details
  const recipientType = getRecipientType(params.currency, params.bankCode, params.accountNumber)

  const response = await paystackFetch<{ recipient_code: string }>('/transferrecipient', {
    method: 'POST',
    body: JSON.stringify({
      type: recipientType,
      name: params.name,
      account_number: params.accountNumber,
      bank_code: params.bankCode,
      currency: params.currency,
    }),
  })

  return { recipientCode: response.data.recipient_code }
}

// Initiate transfer
export async function initiateTransfer(params: {
  amount: number
  recipientCode: string
  reason: string
  reference?: string
}): Promise<{ transferCode: string; reference: string; status: string }> {
  const response = await paystackFetch<{ transfer_code: string; reference: string; status: string }>(
    '/transfer',
    {
      method: 'POST',
      body: JSON.stringify({
        source: 'balance',
        amount: params.amount,
        recipient: params.recipientCode,
        reason: params.reason,
        reference: params.reference,
      }),
    }
  )

  return {
    transferCode: response.data.transfer_code,
    reference: response.data.reference,
    status: response.data.status, // 'otp' if OTP required, 'pending'/'success' otherwise
  }
}

// Finalize transfer with OTP (when transfer requires OTP verification)
// Paystack sends transfer.requires_otp webhook when OTP is needed
export async function finalizeTransfer(params: {
  transferCode: string
  otp: string
}): Promise<{ status: string; reference: string }> {
  const response = await paystackFetch<{ status: string; reference: string }>(
    '/transfer/finalize_transfer',
    {
      method: 'POST',
      body: JSON.stringify({
        transfer_code: params.transferCode,
        otp: params.otp,
      }),
    }
  )

  return {
    status: response.data.status,
    reference: response.data.reference,
  }
}

// Resend OTP for transfer finalization
export async function resendTransferOtp(params: {
  transferCode: string
  reason?: 'resend_otp' | 'transfer'
}): Promise<{ status: boolean; message: string }> {
  const response = await paystackFetch<{ status: boolean; message: string }>(
    '/transfer/resend_otp',
    {
      method: 'POST',
      body: JSON.stringify({
        transfer_code: params.transferCode,
        reason: params.reason || 'resend_otp',
      }),
    }
  )

  return response.data
}

// ============================================
// BALANCE
// ============================================

// Get platform balance (not subaccount balance)
export async function getBalance(): Promise<{
  currency: string
  balance: number
}[]> {
  const response = await paystackFetch<{ currency: string; balance: number }[]>('/balance')
  return response.data
}

// ============================================
// TRANSACTION LIST (For Reconciliation)
// ============================================

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
 * List transactions from Paystack
 * Used for reconciliation to compare DB records against Paystack's records
 */
export async function listTransactions(params: {
  from?: Date  // Start date (defaults to 24h ago)
  to?: Date    // End date (defaults to now)
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

  // Format dates for Paystack (ISO 8601)
  const fromStr = from.toISOString()
  const toStr = to.toISOString()

  let url = `/transaction?perPage=${perPage}&page=${page}&from=${fromStr}&to=${toStr}`
  if (status) {
    url += `&status=${status}`
  }

  const response = await paystackFetch<TransactionListResponse['data']>(url)

  // The meta is in the response object at the same level as data
  // Need to fetch full response
  const fullResponse = await fetch(`${PAYSTACK_API_URL}${url}`, {
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
  })
  const fullData = await fullResponse.json()

  return {
    transactions: response.data,
    meta: fullData.meta || { total: response.data.length, skipped: 0, perPage, page, pageCount: 1 },
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

    // Safety limit to prevent infinite loops
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

// ============================================
// HELPERS
// ============================================

// Generate unique reference
// Paystack only allows alphanumeric characters and hyphens (no underscores)
export function generateReference(prefix = 'TX'): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}-${timestamp}-${random}`.toUpperCase()
}

// Convert amount to display format (handles zero-decimal currencies)
export function formatPaystackAmount(amount: number, currency: string): string {
  // Import dynamically to avoid circular deps - or inline the logic
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
