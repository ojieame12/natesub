// Paystack Transfers - Creator Payouts
//
// ⚠️  IMPORTANT: These transfer functions are NOT used in normal operation!
//
// NatePay uses SUBACCOUNT SPLITS for creator payouts, not manual transfers.
// When a subscriber pays:
// 1. Payment goes to Paystack with subaccount parameter
// 2. Paystack automatically splits: 9% → NatePay, 91% → Creator
// 3. Creator receives funds via T+1 automatic settlement
// 4. NO manual transfers, NO OTP required
//
// These transfer functions exist only for:
// - Manual refunds/corrections by admin
// - Edge cases where subaccount split failed
// - Future features that might need direct transfers
//
// The OTP functions (finalizeTransfer, resendTransferOtp) are kept for
// completeness but are NOT a blocker - they're rarely if ever used.

import { paystackFetch } from './client.js'

// Get recipient type based on currency/country and account details
function getRecipientType(currency: string, bankCode?: string, accountNumber?: string): string {
  switch (currency.toUpperCase()) {
    case 'NGN':
      return 'nuban'
    case 'KES':
      // Kenya supports both mobile money (M-PESA) and bank transfers
      if (bankCode?.toLowerCase().includes('mpesa') ||
        bankCode?.toLowerCase().includes('safaricom') ||
        (accountNumber && /^0?7\d{8}$/.test(accountNumber))) {
        return 'mobile_money'
      }
      return 'authorization'
    case 'ZAR':
      return 'basa'
    default:
      return 'nuban'
  }
}

// Create transfer recipient
export async function createTransferRecipient(params: {
  name: string
  accountNumber: string
  bankCode: string
  currency: string
}): Promise<{ recipientCode: string }> {
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
    status: response.data.status,
  }
}

// Finalize transfer with OTP
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
