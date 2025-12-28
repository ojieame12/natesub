// Paystack Subaccounts - Creator Onboarding
// Subaccounts enable automatic payment splitting

import { db } from '../../db/client.js'
import { maskAccountNumber } from '../../utils/pii.js'
import { encryptAccountNumber } from '../../utils/encryption.js'
import { getPlatformFeePercent, type UserPurpose } from '../pricing.js'
import { paystackFetch, type Subaccount } from './client.js'
import { invalidatePublicProfileCache } from '../../utils/cache.js'

// Create subaccount for a creator
export async function createSubaccount(params: {
  userId: string
  businessName: string
  bankCode: string
  accountNumber: string
  email: string
  phone?: string
  purpose?: UserPurpose
}): Promise<{ subaccountCode: string }> {
  // Check if user already has a subaccount
  const profile = await db.profile.findUnique({ where: { userId: params.userId } })

  if (profile?.paystackSubaccountCode) {
    return { subaccountCode: profile.paystackSubaccountCode }
  }

  // Calculate platform fee based on creator's purpose (9% for all users)
  const platformFeePercent = getPlatformFeePercent(params.purpose || profile?.purpose as UserPurpose)

  // Log creation attempt with masked PII
  console.log(`[paystack] Creating subaccount for user ${params.userId}, account ${maskAccountNumber(params.accountNumber)}, fee: ${platformFeePercent}%`)

  const response = await paystackFetch<Subaccount>('/subaccount', {
    method: 'POST',
    body: JSON.stringify({
      business_name: params.businessName,
      settlement_bank: params.bankCode,
      account_number: params.accountNumber,
      percentage_charge: platformFeePercent,
      primary_contact_email: params.email,
      primary_contact_phone: params.phone,
      settlement_schedule: 'auto',
    }),
  })

  const subaccountCode = response.data.subaccount_code

  // Save to profile (encrypt sensitive account number)
  const updatedProfile = await db.profile.update({
    where: { userId: params.userId },
    data: {
      paystackSubaccountCode: subaccountCode,
      paystackBankCode: params.bankCode,
      paystackAccountNumber: encryptAccountNumber(params.accountNumber),
      paymentProvider: 'paystack',
      payoutStatus: 'active',
    },
  })

  // Invalidate public profile cache - payoutStatus affects paymentsReady
  if (updatedProfile.username) {
    await invalidatePublicProfileCache(updatedProfile.username)
  }

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
    return
  }

  const newFeePercent = getPlatformFeePercent(purpose)

  console.log(`[paystack] Updating subaccount ${profile.paystackSubaccountCode} fee to ${newFeePercent}%`)

  await updateSubaccount(profile.paystackSubaccountCode, {
    percentageCharge: newFeePercent,
  })
}
