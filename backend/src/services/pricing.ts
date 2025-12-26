// Pricing Service - Centralized fee calculation based on user purpose
// Personal: Free plan, 8% transaction fee
// Service: $5/mo subscription, 8% transaction fee
//
// NOTE: Fee constants are imported from constants/fees.ts - the single source of truth

import { PLATFORM_FEE_RATE } from '../constants/fees.js'

export type UserPurpose = 'personal' | 'service'

// Platform fee percentage derived from the canonical PLATFORM_FEE_RATE
// Both personal and service users pay the same 8% fee
const PLATFORM_FEE_PERCENT = PLATFORM_FEE_RATE * 100 // 0.08 -> 8

// Processing fee is included in platform fee - kept at 0 for backward compatibility
// with payroll display. The platform fee IS the total fee.
const PROCESSING_FEE_PERCENT = 0

// Platform subscription price for service users (in cents)
export const PLATFORM_SUBSCRIPTION_PRICE_CENTS = 500 // $5.00/month

/**
 * Get the platform fee percentage for a user based on their purpose
 * @param purpose - 'personal' or 'service'
 * @returns Platform fee percentage (8%)
 */
export function getPlatformFeePercent(_purpose: UserPurpose | null | undefined): number {
  // All users pay the same fee - purpose is kept for backward compatibility
  return PLATFORM_FEE_PERCENT
}

/**
 * Get the processing fee percentage (payment processor overhead)
 * This is the same regardless of user purpose
 */
export function getProcessingFeePercent(): number {
  return PROCESSING_FEE_PERCENT
}

/**
 * Get total fee percentage (platform fee only, processing is included)
 * @param purpose - 'personal' or 'service'
 * @returns Total fee percentage (8% for all users)
 */
export function getTotalFeePercent(purpose: UserPurpose | null | undefined): number {
  return getPlatformFeePercent(purpose) + PROCESSING_FEE_PERCENT
}

/**
 * Calculate fee breakdown for a given amount
 * @param amountCents - The gross amount in cents
 * @param purpose - 'personal' or 'service'
 * @returns Object with platformFeeCents, processingFeeCents, totalFeeCents, netCents
 */
export function calculateFees(
  amountCents: number,
  purpose: UserPurpose | null | undefined
): {
  platformFeeCents: number
  processingFeeCents: number
  totalFeeCents: number
  netCents: number
} {
  const platformFeePercent = getPlatformFeePercent(purpose)
  const processingFeePercent = getProcessingFeePercent()

  const platformFeeCents = Math.round(amountCents * (platformFeePercent / 100))
  const processingFeeCents = Math.round(amountCents * (processingFeePercent / 100))
  const totalFeeCents = platformFeeCents + processingFeeCents
  const netCents = amountCents - totalFeeCents

  return {
    platformFeeCents,
    processingFeeCents,
    totalFeeCents,
    netCents,
  }
}

/**
 * Check if a user needs a platform subscription (service purpose)
 * @param purpose - 'personal' or 'service'
 * @returns true if user should have a platform subscription
 */
export function requiresPlatformSubscription(purpose: UserPurpose | null | undefined): boolean {
  return purpose === 'service'
}
