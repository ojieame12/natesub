// Payroll Service - Generate pay statements for service providers
// Aggregates payment data into bi-weekly periods with verification

import crypto from 'crypto'
import { db } from '../db/client.js'
import type { PayrollPeriodType } from '@prisma/client'
import {
  getPlatformFeePercent,
  getProcessingFeePercent,
  getTotalFeePercent,
  calculateFees,
  type UserPurpose,
} from './pricing.js'
import { scheduleReminder } from '../jobs/reminders.js'
import { decryptAccountNumber } from '../utils/encryption.js'

// ============================================
// TYPES
// ============================================

export interface PayrollSummary {
  id: string
  periodStart: Date
  periodEnd: Date
  periodType: PayrollPeriodType
  grossCents: number
  refundsCents: number
  chargebacksCents: number
  platformFeeCents: number
  processingFeeCents: number
  netCents: number
  paymentCount: number
  currency: string
  verificationCode: string
  payoutDate: Date | null
  createdAt: Date
}

export interface PaymentItem {
  id: string
  date: Date
  subscriberName: string
  subscriberEmail: string
  amount: number
  type: 'recurring' | 'one_time'
}

export interface PayrollDetail extends PayrollSummary {
  ytdGrossCents: number
  ytdNetCents: number
  adjustedGrossCents: number // grossCents - refundsCents - chargebacksCents
  payoutDate: Date | null
  payoutMethod: string | null
  bankLast4: string | null
  pdfUrl: string | null
  payments: PaymentItem[]
}

export interface VerificationResult {
  creatorName: string
  periodStart: Date
  periodEnd: Date
  grossCents: number
  netCents: number
  currency: string
  createdAt: Date
  verificationCode: string
}

// ============================================
// PERIOD CALCULATIONS
// ============================================

/**
 * Get the bi-weekly period boundaries for a given date
 * Periods: 1st-15th and 16th-end of month
 */
export function getPeriodBoundaries(date: Date): { start: Date; end: Date } {
  const year = date.getFullYear()
  const month = date.getMonth()
  const day = date.getDate()

  if (day <= 15) {
    // First half: 1st to 15th
    return {
      start: new Date(year, month, 1, 0, 0, 0, 0),
      end: new Date(year, month, 15, 23, 59, 59, 999),
    }
  } else {
    // Second half: 16th to last day
    const lastDay = new Date(year, month + 1, 0).getDate()
    return {
      start: new Date(year, month, 16, 0, 0, 0, 0),
      end: new Date(year, month, lastDay, 23, 59, 59, 999),
    }
  }
}

/**
 * Get all period boundaries for a year up to a given date
 */
export function getPeriodsForYear(year: number, upToDate: Date): Array<{ start: Date; end: Date }> {
  const periods: Array<{ start: Date; end: Date }> = []

  for (let month = 0; month < 12; month++) {
    // First half
    const firstHalfEnd = new Date(year, month, 15, 23, 59, 59, 999)
    if (firstHalfEnd <= upToDate) {
      periods.push({
        start: new Date(year, month, 1, 0, 0, 0, 0),
        end: firstHalfEnd,
      })
    }

    // Second half
    const lastDay = new Date(year, month + 1, 0).getDate()
    const secondHalfEnd = new Date(year, month, lastDay, 23, 59, 59, 999)
    if (secondHalfEnd <= upToDate) {
      periods.push({
        start: new Date(year, month, 16, 0, 0, 0, 0),
        end: secondHalfEnd,
      })
    }
  }

  return periods
}

/**
 * Generate a unique verification code
 * Format: NP-YYYY-MMM-XXXXXXXXXXXX
 */
export function generateVerificationCode(userId: string, periodEnd: Date): string {
  const year = periodEnd.getFullYear()
  const month = periodEnd.toLocaleString('en', { month: 'short' }).toUpperCase()
  // SECURITY: Use a cryptographically secure random code to prevent brute force enumeration.
  // (The public /payroll/verify/:code endpoint makes low-entropy codes risky.)
  const code = crypto.randomBytes(6).toString('hex').toUpperCase() // 48 bits of entropy

  return `NP-${year}-${month}-${code}`
}

// ============================================
// DATA AGGREGATION
// ============================================

/**
 * Aggregate payments for a user within a period
 * Handles refunds and chargebacks by subtracting from gross
 */
async function aggregatePayments(
  userId: string,
  periodStart: Date,
  periodEnd: Date,
  currency?: string
): Promise<{
  grossCents: number
  refundsCents: number
  chargebacksCents: number
  totalFeeCents: number  // Sum of actual recorded fees
  totalNetCents: number  // Sum of actual recorded net amounts
  paymentCount: number
  payments: PaymentItem[]
}> {
  // Build where clause with optional currency filter
  const whereClause: any = {
    creatorId: userId,
    occurredAt: {
      gte: periodStart,
      lte: periodEnd,
    },
  }

  if (currency) {
    whereClause.currency = currency
  }

  // Get successful inbound payments (revenue only, exclude payouts)
  const successfulPayments = await db.payment.findMany({
    where: {
      ...whereClause,
      status: 'succeeded',
      // Only count inbound revenue (one_time, recurring) - exclude payout transfers
      type: { in: ['one_time', 'recurring'] },
    },
    include: {
      subscription: {
        include: {
          subscriber: {
            select: {
              email: true,
            },
          },
        },
      },
    },
    orderBy: { occurredAt: 'desc' },
  })

  // Get refunds in the same period (only for revenue payments)
  const refunds = await db.payment.findMany({
    where: {
      ...whereClause,
      status: 'refunded',
      type: { in: ['one_time', 'recurring'] },
    },
  })

  // Get chargebacks (disputes lost, only for revenue payments)
  const chargebacks = await db.payment.findMany({
    where: {
      ...whereClause,
      status: { in: ['dispute_lost', 'disputed'] },
      type: { in: ['one_time', 'recurring'] },
    },
  })

  const grossCents = successfulPayments.reduce((sum, p) => sum + p.amountCents, 0)
  const refundsCents = refunds.reduce((sum, p) => sum + Math.abs(p.amountCents), 0)
  const chargebacksCents = chargebacks.reduce((sum, p) => sum + Math.abs(p.amountCents), 0)

  // Sum actual recorded fees and net amounts from payment records
  // This uses the real fees charged at checkout, not recomputed approximations
  const totalFeeCents = successfulPayments.reduce((sum, p) => sum + p.feeCents, 0)
  const totalNetCents = successfulPayments.reduce((sum, p) => sum + p.netCents, 0)

  const paymentItems: PaymentItem[] = successfulPayments.map((p) => ({
    id: p.id,
    date: p.occurredAt,
    subscriberName: p.subscription?.subscriber?.email?.split('@')[0] || 'Anonymous',
    subscriberEmail: maskEmail(p.subscription?.subscriber?.email || ''),
    amount: p.amountCents,
    type: p.type === 'recurring' ? 'recurring' : 'one_time',
  }))

  return {
    grossCents,
    refundsCents,
    chargebacksCents,
    totalFeeCents,
    totalNetCents,
    paymentCount: successfulPayments.length,
    payments: paymentItems,
  }
}

/**
 * Calculate year-to-date totals
 * Uses actual recorded netCents from payment records, not recomputed approximations
 */
async function calculateYTD(
  userId: string,
  asOfDate: Date,
  _purpose: UserPurpose | null // Kept for signature compatibility, but not used
): Promise<{ grossCents: number; netCents: number }> {
  const yearStart = new Date(asOfDate.getFullYear(), 0, 1, 0, 0, 0, 0)

  const result = await db.payment.aggregate({
    where: {
      creatorId: userId,
      status: 'succeeded',
      // Only count inbound revenue (one_time, recurring) - exclude payout transfers
      type: { in: ['one_time', 'recurring'] },
      occurredAt: {
        gte: yearStart,
        lte: asOfDate,
      },
    },
    _sum: {
      amountCents: true,
      netCents: true, // Sum actual recorded net amounts
    },
  })

  const grossCents = result._sum.amountCents || 0
  // Use actual recorded net amounts instead of recomputing from gross
  const netCents = result._sum.netCents || 0

  return { grossCents, netCents }
}

/**
 * Get bank account last 4 digits for a user
 */
async function getBankLast4(userId: string): Promise<string | null> {
  const profile = await db.profile.findUnique({
    where: { userId },
    select: {
      paymentProvider: true,
      paystackAccountNumber: true,
      // Stripe doesn't store bank last4 locally - would need API call
    },
  })

  if (!profile) return null

  if (profile.paymentProvider === 'paystack' && profile.paystackAccountNumber) {
    // Decrypt the account number before extracting last 4 digits
    const decrypted = decryptAccountNumber(profile.paystackAccountNumber)
    if (decrypted) {
      return decrypted.slice(-4)
    }
  }

  // For Stripe, return placeholder - would need to fetch from Stripe API
  return '****'
}

// ============================================
// PUBLIC API
// ============================================

/**
 * Get all payroll periods for a user
 */
export async function getPayrollPeriods(userId: string): Promise<PayrollSummary[]> {
  const periods = await db.payrollPeriod.findMany({
    where: { userId },
    orderBy: { periodStart: 'desc' },
  })

  return periods.map((p) => ({
    id: p.id,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    periodType: p.periodType,
    grossCents: p.grossCents,
    refundsCents: p.refundsCents,
    chargebacksCents: p.chargebacksCents,
    platformFeeCents: p.platformFeeCents,
    processingFeeCents: p.processingFeeCents,
    netCents: p.netCents,
    paymentCount: p.paymentCount,
    currency: p.currency,
    verificationCode: p.verificationCode,
    payoutDate: p.payoutDate, // Include for status determination
    createdAt: p.createdAt,
  }))
}

/**
 * Get a single payroll period with payment details
 */
export async function getPayrollPeriod(
  userId: string,
  periodId: string
): Promise<PayrollDetail | null> {
  const period = await db.payrollPeriod.findFirst({
    where: { id: periodId, userId },
  })

  if (!period) return null

  // Get individual payments for this period (filtered by same currency)
  const { payments } = await aggregatePayments(userId, period.periodStart, period.periodEnd, period.currency)

  const adjustedGrossCents = period.grossCents - period.refundsCents - period.chargebacksCents

  return {
    id: period.id,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    periodType: period.periodType,
    grossCents: period.grossCents,
    refundsCents: period.refundsCents,
    chargebacksCents: period.chargebacksCents,
    platformFeeCents: period.platformFeeCents,
    processingFeeCents: period.processingFeeCents,
    netCents: period.netCents,
    paymentCount: period.paymentCount,
    currency: period.currency,
    ytdGrossCents: period.ytdGrossCents,
    ytdNetCents: period.ytdNetCents,
    adjustedGrossCents,
    payoutDate: period.payoutDate,
    payoutMethod: period.payoutMethod,
    bankLast4: period.bankLast4,
    pdfUrl: period.pdfUrl,
    verificationCode: period.verificationCode,
    payments,
    createdAt: period.createdAt,
  }
}

/**
 * Get distinct currencies for which a user received payments in a period
 */
async function getDistinctCurrencies(
  userId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<string[]> {
  const payments = await db.payment.findMany({
    where: {
      creatorId: userId,
      status: 'succeeded',
      occurredAt: {
        gte: periodStart,
        lte: periodEnd,
      },
    },
    select: { currency: true },
    distinct: ['currency'],
  })

  return payments.map((p) => p.currency)
}

/**
 * Find payout record for this period (actual Payment with type: 'payout')
 * Returns the payout that covers this period's earnings, if any
 */
async function findPayoutForPeriod(
  userId: string,
  periodEnd: Date,
  currency: string
): Promise<{ payoutDate: Date; payoutMethod: string | null } | null> {
  // Look for a payout Payment that occurred after the period ended
  // and matches the currency (payouts happen after earnings are collected)
  const payout = await db.payment.findFirst({
    where: {
      creatorId: userId,
      type: 'payout',
      status: 'succeeded',
      currency,
      occurredAt: {
        gte: periodEnd,
      },
    },
    orderBy: { occurredAt: 'asc' }, // Get the first payout after period end
    select: {
      occurredAt: true,
      paystackTransactionRef: true,
      stripePaymentIntentId: true,
    },
  })

  if (!payout) return null

  // Determine payout method based on which provider field is populated
  let payoutMethod: string | null = null
  if (payout.paystackTransactionRef) {
    payoutMethod = 'paystack'
  } else if (payout.stripePaymentIntentId) {
    payoutMethod = 'stripe'
  }

  return {
    payoutDate: payout.occurredAt,
    payoutMethod,
  }
}

/**
 * Generate a payroll period for a user for a specific currency
 * This aggregates all payments in the period and creates a snapshot
 * Fee rates are based on the creator's purpose (personal: 10%, service: 8%)
 */
export async function generatePayrollPeriod(
  userId: string,
  periodStart: Date,
  periodEnd: Date,
  currency?: string
): Promise<PayrollSummary | null> {
  // Get profile for purpose (for fee calculation) and fallback currency
  const profile = await db.profile.findUnique({
    where: { userId },
    select: {
      currency: true,
      paymentProvider: true,
      purpose: true,
    },
  })

  if (!profile) return null

  // Use provided currency or fall back to profile currency
  const periodCurrency = currency || profile.currency

  // Check if period already exists for this currency
  const existing = await db.payrollPeriod.findFirst({
    where: {
      userId,
      periodStart,
      periodEnd,
      currency: periodCurrency,
    },
  })

  if (existing) {
    return {
      id: existing.id,
      periodStart: existing.periodStart,
      periodEnd: existing.periodEnd,
      periodType: existing.periodType,
      grossCents: existing.grossCents,
      refundsCents: existing.refundsCents,
      chargebacksCents: existing.chargebacksCents,
      platformFeeCents: existing.platformFeeCents,
      processingFeeCents: existing.processingFeeCents,
      netCents: existing.netCents,
      paymentCount: existing.paymentCount,
      currency: existing.currency,
      verificationCode: existing.verificationCode,
      payoutDate: existing.payoutDate,
      createdAt: existing.createdAt,
    }
  }

  // Aggregate payments filtered by currency
  const { grossCents, refundsCents, chargebacksCents, totalFeeCents, totalNetCents, paymentCount } = await aggregatePayments(
    userId,
    periodStart,
    periodEnd,
    periodCurrency
  )

  // Skip if no payments
  if (paymentCount === 0) {
    return null
  }

  // Calculate adjusted gross (after refunds and chargebacks)
  const adjustedGrossCents = grossCents - refundsCents - chargebacksCents

  // Use actual recorded fees from payment records (not recomputed approximations)
  // For fee breakdown, approximate split: ~80% platform, ~20% processing (for display only)
  const purpose = profile.purpose as UserPurpose
  const platformFeePercent = getPlatformFeePercent(purpose)
  const processingFeePercent = getProcessingFeePercent()
  const totalFeePercent = platformFeePercent + processingFeePercent

  // Split the actual total fee proportionally for display purposes
  const platformFeeCents = Math.round(totalFeeCents * (platformFeePercent / totalFeePercent))
  const processingFeeCents = totalFeeCents - platformFeeCents // Remainder to avoid rounding errors
  const netCents = adjustedGrossCents - totalFeeCents

  // Calculate YTD
  const ytd = await calculateYTD(userId, periodEnd, purpose)

  // Get bank info
  const bankLast4 = await getBankLast4(userId)

  // Generate verification code
  const verificationCode = generateVerificationCode(userId, periodEnd)

  // Find actual payout record for this period
  const payoutInfo = await findPayoutForPeriod(userId, periodEnd, periodCurrency)

  // Create period record
  const period = await db.payrollPeriod.create({
    data: {
      userId,
      periodStart,
      periodEnd,
      periodType: 'biweekly',
      currency: periodCurrency,
      grossCents,
      refundsCents,
      chargebacksCents,
      platformFeeCents,
      processingFeeCents,
      netCents,
      paymentCount,
      ytdGrossCents: ytd.grossCents,
      ytdNetCents: ytd.netCents,
      payoutDate: payoutInfo?.payoutDate || null,
      payoutMethod: payoutInfo?.payoutMethod || null,
      bankLast4,
      verificationCode,
    },
  })

  // Schedule payroll ready notification (sends immediately)
  await scheduleReminder({
    userId,
    entityType: 'payroll',
    entityId: period.id,
    type: 'payroll_ready',
    scheduledFor: new Date(), // Send immediately
  })

  return {
    id: period.id,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    periodType: period.periodType,
    grossCents: period.grossCents,
    refundsCents: period.refundsCents,
    chargebacksCents: period.chargebacksCents,
    platformFeeCents: period.platformFeeCents,
    processingFeeCents: period.processingFeeCents,
    netCents: period.netCents,
    paymentCount: period.paymentCount,
    currency: period.currency,
    verificationCode: period.verificationCode,
    payoutDate: period.payoutDate,
    createdAt: period.createdAt,
  }
}

/**
 * Generate payroll periods for all currencies received in a period
 * Returns the count of periods generated
 */
export async function generatePayrollPeriodsForAllCurrencies(
  userId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<number> {
  // Get all currencies the user received payments in during this period
  const currencies = await getDistinctCurrencies(userId, periodStart, periodEnd)

  if (currencies.length === 0) return 0

  let generated = 0
  for (const currency of currencies) {
    const result = await generatePayrollPeriod(userId, periodStart, periodEnd, currency)
    if (result) generated++
  }

  return generated
}

/**
 * Generate all missing payroll periods for a user
 * Call this when user views payroll history
 * Generates separate statements for each currency received
 */
export async function generateMissingPeriods(userId: string): Promise<number> {
  // Get user's first payment date
  const firstPayment = await db.payment.findFirst({
    where: { creatorId: userId, status: 'succeeded' },
    orderBy: { occurredAt: 'asc' },
    select: { occurredAt: true },
  })

  if (!firstPayment) return 0

  const now = new Date()
  const currentPeriod = getPeriodBoundaries(now)

  // Generate periods from first payment to now (excluding current incomplete period)
  let generated = 0
  let checkDate = new Date(firstPayment.occurredAt)

  while (checkDate < currentPeriod.start) {
    const period = getPeriodBoundaries(checkDate)

    // Only generate if period has ended
    if (period.end < now) {
      // Generate for ALL currencies received in this period
      const count = await generatePayrollPeriodsForAllCurrencies(userId, period.start, period.end)
      generated += count
    }

    // Move to next period
    checkDate = new Date(period.end.getTime() + 1)
  }

  return generated
}

/**
 * Verify a payroll document (public endpoint)
 */
export async function verifyDocument(code: string): Promise<VerificationResult | null> {
  const period = await db.payrollPeriod.findUnique({
    where: { verificationCode: code },
    include: {
      user: {
        include: {
          profile: {
            select: {
              displayName: true,
              currency: true,
            },
          },
        },
      },
    },
  })

  if (!period) return null

  return {
    creatorName: period.user.profile?.displayName || 'Unknown',
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    grossCents: period.grossCents,
    netCents: period.netCents,
    // Use the period's currency, not the profile's current currency
    // (profile currency could have changed since this period was created)
    currency: period.currency || 'USD',
    createdAt: period.createdAt,
    verificationCode: period.verificationCode,
  }
}

/**
 * Update a period with PDF URL after generation
 */
export async function setPdfUrl(periodId: string, pdfUrl: string): Promise<void> {
  await db.payrollPeriod.update({
    where: { id: periodId },
    data: {
      pdfUrl,
      pdfGeneratedAt: new Date(),
    },
  })
}

// ============================================
// HELPERS
// ============================================

function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '****'
  const [local, domain] = email.split('@')
  if (local.length <= 2) return `${local[0]}***@${domain}`
  return `${local[0]}***${local.slice(-1)}@${domain}`
}
