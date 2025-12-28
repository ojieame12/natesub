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
  subscriberId: string | null
  tierName: string | null
  description: string
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
  // Enhanced fields for verification page
  paymentCount: number
  payoutDate: Date | null
  payoutMethod: string | null
}

// ============================================
// PERIOD CALCULATIONS
// ============================================

/**
 * Get the bi-weekly period boundaries for a given date
 * Periods: 1st-15th and 16th-end of month
 * IMPORTANT: Uses UTC for consistency with the payroll job
 */
export function getPeriodBoundaries(date: Date): { start: Date; end: Date } {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const day = date.getUTCDate()

  if (day <= 15) {
    // First half: 1st to 15th
    return {
      start: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
      end: new Date(Date.UTC(year, month, 15, 23, 59, 59, 999)),
    }
  } else {
    // Second half: 16th to last day
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    return {
      start: new Date(Date.UTC(year, month, 16, 0, 0, 0, 0)),
      end: new Date(Date.UTC(year, month, lastDay, 23, 59, 59, 999)),
    }
  }
}

/**
 * Get all period boundaries for a year up to a given date
 * IMPORTANT: Uses UTC for consistency with the payroll job
 */
export function getPeriodsForYear(year: number, upToDate: Date): Array<{ start: Date; end: Date }> {
  const periods: Array<{ start: Date; end: Date }> = []

  for (let month = 0; month < 12; month++) {
    // First half
    const firstHalfEnd = new Date(Date.UTC(year, month, 15, 23, 59, 59, 999))
    if (firstHalfEnd <= upToDate) {
      periods.push({
        start: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
        end: firstHalfEnd,
      })
    }

    // Second half
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    const secondHalfEnd = new Date(Date.UTC(year, month, lastDay, 23, 59, 59, 999))
    if (secondHalfEnd <= upToDate) {
      periods.push({
        start: new Date(Date.UTC(year, month, 16, 0, 0, 0, 0)),
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

// Maximum payments to load for line-item display (prevents memory issues)
const MAX_PAYMENT_LINE_ITEMS = 100

/**
 * Aggregate payments for a user within a period
 * Uses DB-side aggregation for totals (scalable for high-volume creators)
 * Only loads capped line-items for display
 */
export async function aggregatePayments(
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
  // Use DB-side aggregation for totals (avoids loading all rows into memory)
  // This is critical for high-volume creators with 1000+ payments per period
  // Note: We use conditional queries because Prisma's $queryRaw doesn't support
  // conditional SQL fragments via template embedding

  type TotalsRow = {
    gross_cents: bigint | null
    fee_cents: bigint | null
    net_cents: bigint | null
    payment_count: bigint
    refunds_cents: bigint | null
    chargebacks_cents: bigint | null
  }

  // Fix for legacy payments: Use grossCents/amountCents directly instead of deriving from netCents
  // - New split model: grossCents = subscriber paid amount (creator price + subscriber fee)
  // - Legacy model: grossCents is NULL, use amountCents (total paid by subscriber)
  // For fees:
  // - New split model: creatorFeeCents = creator's 4% fee
  // - Legacy absorb: creatorFeeCents is NULL, creator pays full feeCents
  // - Legacy pass_to_subscriber: creatorFeeCents is NULL, creator pays 0 (subscriber paid the fee)
  const totals = currency
    ? await db.$queryRaw<Array<TotalsRow>>`
        SELECT
          SUM(CASE WHEN "status" = 'succeeded' AND "type" IN ('one_time', 'recurring')
            THEN COALESCE("grossCents", "amountCents") ELSE 0 END) as gross_cents,
          SUM(CASE WHEN "status" = 'succeeded' AND "type" IN ('one_time', 'recurring')
            THEN COALESCE("creatorFeeCents", "feeCents") ELSE 0 END) as fee_cents,
          SUM(CASE WHEN "status" = 'succeeded' AND "type" IN ('one_time', 'recurring')
            THEN "netCents" ELSE 0 END) as net_cents,
          COUNT(*) FILTER (WHERE "status" = 'succeeded' AND "type" IN ('one_time', 'recurring')) as payment_count,
          SUM(CASE WHEN "status" = 'refunded' AND "type" IN ('one_time', 'recurring', 'refund')
            THEN ABS(COALESCE("grossCents", "amountCents")) ELSE 0 END) as refunds_cents,
          -- Only count 'dispute_lost' as chargebacks (finalized losses)
          -- 'disputed' (open disputes) are excluded to avoid overstating losses
          SUM(CASE WHEN "status" = 'dispute_lost' AND "type" IN ('one_time', 'recurring')
            THEN ABS(COALESCE("grossCents", "amountCents")) ELSE 0 END) as chargebacks_cents
        FROM "payments"
        WHERE "creatorId" = ${userId}
          AND "occurredAt" >= ${periodStart}
          AND "occurredAt" <= ${periodEnd}
          AND "currency" = ${currency}
      `
    : await db.$queryRaw<Array<TotalsRow>>`
        SELECT
          SUM(CASE WHEN "status" = 'succeeded' AND "type" IN ('one_time', 'recurring')
            THEN COALESCE("grossCents", "amountCents") ELSE 0 END) as gross_cents,
          SUM(CASE WHEN "status" = 'succeeded' AND "type" IN ('one_time', 'recurring')
            THEN COALESCE("creatorFeeCents", "feeCents") ELSE 0 END) as fee_cents,
          SUM(CASE WHEN "status" = 'succeeded' AND "type" IN ('one_time', 'recurring')
            THEN "netCents" ELSE 0 END) as net_cents,
          COUNT(*) FILTER (WHERE "status" = 'succeeded' AND "type" IN ('one_time', 'recurring')) as payment_count,
          SUM(CASE WHEN "status" = 'refunded' AND "type" IN ('one_time', 'recurring', 'refund')
            THEN ABS(COALESCE("grossCents", "amountCents")) ELSE 0 END) as refunds_cents,
          -- Only count 'dispute_lost' as chargebacks (finalized losses)
          -- 'disputed' (open disputes) are excluded to avoid overstating losses
          SUM(CASE WHEN "status" = 'dispute_lost' AND "type" IN ('one_time', 'recurring')
            THEN ABS(COALESCE("grossCents", "amountCents")) ELSE 0 END) as chargebacks_cents
        FROM "payments"
        WHERE "creatorId" = ${userId}
          AND "occurredAt" >= ${periodStart}
          AND "occurredAt" <= ${periodEnd}
      `

  const row = totals[0]
  const grossCents = Number(row?.gross_cents || 0)
  const totalFeeCents = Number(row?.fee_cents || 0)
  const totalNetCents = Number(row?.net_cents || 0)
  const paymentCount = Number(row?.payment_count || 0)
  const refundsCents = Number(row?.refunds_cents || 0)
  const chargebacksCents = Number(row?.chargebacks_cents || 0)

  // Only load capped line-items for UI display (not for totals calculation)
  const whereClause: any = {
    creatorId: userId,
    status: 'succeeded',
    type: { in: ['one_time', 'recurring'] },
    occurredAt: {
      gte: periodStart,
      lte: periodEnd,
    },
  }
  if (currency) {
    whereClause.currency = currency
  }

  const lineItemPayments = await db.payment.findMany({
    where: whereClause,
    include: {
      subscription: {
        select: {
          tierName: true,
          subscriber: {
            select: {
              id: true,
              email: true,
            },
          },
        },
      },
    },
    orderBy: { occurredAt: 'desc' },
    take: MAX_PAYMENT_LINE_ITEMS, // Cap to prevent memory issues
  })

  const paymentItems: PaymentItem[] = lineItemPayments.map((p) => {
    const email = p.subscription?.subscriber?.email || ''
    const tierName = p.subscription?.tierName || null
    const paymentType: 'recurring' | 'one_time' = p.type === 'recurring' ? 'recurring' : 'one_time'

    // Use grossCents (subscriber paid amount) or fall back to amountCents for legacy payments
    const baseAmount = p.grossCents ?? p.amountCents

    return {
      id: p.id,
      date: p.occurredAt,
      subscriberName: email.split('@')[0] || 'Anonymous',
      subscriberEmail: maskEmail(email),
      subscriberId: p.subscription?.subscriber?.id || null,
      tierName,
      description: formatPaymentDescription(tierName, paymentType, email),
      amount: baseAmount,
      type: paymentType,
    }
  })

  return {
    grossCents,
    refundsCents,
    chargebacksCents,
    totalFeeCents,
    totalNetCents,
    paymentCount,
    payments: paymentItems,
  }
}

/**
 * Calculate year-to-date totals for a specific currency
 * Uses actual recorded netCents from payment records, not recomputed approximations
 * IMPORTANT: YTD must be per-currency to be mathematically valid
 * IMPORTANT: Must account for refunds and chargebacks to be accurate
 * IMPORTANT: Uses UTC for consistency with period boundaries
 */
async function calculateYTD(
  userId: string,
  asOfDate: Date,
  currency: string
): Promise<{ grossCents: number; netCents: number }> {
  const yearStart = new Date(Date.UTC(asOfDate.getUTCFullYear(), 0, 1, 0, 0, 0, 0))

  // Use raw SQL to compute base price in the database
  // This avoids loading all payments into memory for high-volume creators
  // Use COALESCE(grossCents, amountCents) to handle both new split model and legacy payments
  const result = await db.$queryRaw<Array<{ grossCents: bigint | null; netCents: bigint | null }>>`
    SELECT
      SUM(COALESCE("grossCents", "amountCents")) as "grossCents",
      SUM("netCents") as "netCents"
    FROM "payments"
    WHERE "creatorId" = ${userId}
      AND "currency" = ${currency}
      AND "occurredAt" >= ${yearStart}
      AND "occurredAt" <= ${asOfDate}
      AND (
        -- Successful payments
        ("status" = 'succeeded' AND "type" IN ('one_time', 'recurring'))
        -- Refunds (negative values subtract automatically)
        OR ("status" = 'refunded' AND "type" IN ('one_time', 'recurring', 'refund'))
        -- Chargebacks - only count 'dispute_lost' (finalized losses)
        -- Open disputes ('disputed') are excluded for consistency with period totals
        OR ("status" = 'dispute_lost' AND "type" IN ('one_time', 'recurring'))
      )
  `

  // Handle bigint conversion and null safety
  const grossCents = result[0]?.grossCents ? Number(result[0].grossCents) : 0
  const netCents = result[0]?.netCents ? Number(result[0].netCents) : 0

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
 *
 * Handles two scenarios:
 * 1. Stripe: Payouts happen after period end, may be in different currency (cross-border)
 * 2. Paystack: Transfers happen per-payment (immediately), often within the period
 */
async function findPayoutForPeriod(
  userId: string,
  periodStart: Date,
  periodEnd: Date,
  _currency: string // Kept for backward compatibility, not used for matching
): Promise<{ payoutDate: Date; payoutMethod: string | null } | null> {
  // Strategy 1: Look for Stripe payout after period end
  // Don't require currency match - cross-border payouts convert (e.g., USD earnings → NGN payout)
  const stripePayout = await db.payment.findFirst({
    where: {
      creatorId: userId,
      type: 'payout',
      status: 'succeeded',
      stripePaymentIntentId: { not: null }, // Stripe payout
      occurredAt: {
        gte: periodEnd,
      },
    },
    orderBy: { occurredAt: 'asc' },
    select: { occurredAt: true },
  })

  if (stripePayout) {
    return {
      payoutDate: stripePayout.occurredAt,
      payoutMethod: 'stripe',
    }
  }

  // Strategy 2: Look for Paystack transfers within period + 7 day buffer
  // Paystack transfers happen per-transaction, often before period end
  const paystackBuffer = 7 * 24 * 60 * 60 * 1000 // 7 days
  const paystackPayout = await db.payment.findFirst({
    where: {
      creatorId: userId,
      type: 'payout',
      status: 'succeeded',
      paystackTransactionRef: { not: null }, // Paystack transfer
      occurredAt: {
        gte: periodStart,
        lte: new Date(periodEnd.getTime() + paystackBuffer),
      },
    },
    orderBy: { occurredAt: 'desc' }, // Get the last payout in range
    select: { occurredAt: true },
  })

  if (paystackPayout) {
    return {
      payoutDate: paystackPayout.occurredAt,
      payoutMethod: 'paystack',
    }
  }

  return null
}

/**
 * Generate a payroll period for a user for a specific currency
 * This aggregates all payments in the period and creates a snapshot
 * Fee rate is 9% for all users (split: 4.5% subscriber + 4.5% creator)
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

  // Skip if no activity (no payments, refunds, or chargebacks)
  // Allow refund-only periods for proper accounting of losses
  if (paymentCount === 0 && refundsCents === 0 && chargebacksCents === 0) {
    return null
  }

  // Calculate adjusted gross (after refunds and chargebacks)
  // grossCents is now base price (what creator set), not what subscriber paid
  const adjustedGrossCents = grossCents - refundsCents - chargebacksCents

  // totalFeeCents is now creator's fee only (4% in split model)
  // No separate processing fee - it's covered by subscriber's portion
  const platformFeeCents = totalFeeCents // Creator's 4% fee
  const processingFeeCents = 0           // Absorbed by subscriber's fee portion
  const netCents = adjustedGrossCents - totalFeeCents

  // Calculate YTD (per-currency)
  const ytd = await calculateYTD(userId, periodEnd, periodCurrency)

  // Get bank info
  const bankLast4 = await getBankLast4(userId)

  // Generate verification code
  const verificationCode = generateVerificationCode(userId, periodEnd)

  // Find actual payout record for this period
  const payoutInfo = await findPayoutForPeriod(userId, periodStart, periodEnd, periodCurrency)

  // Create period record with race condition handling
  // If another concurrent request created the same period, just return the existing one
  let period
  try {
    period = await db.payrollPeriod.create({
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

    // Schedule payroll ready notification only for newly created periods
    await scheduleReminder({
      userId,
      entityType: 'payroll',
      entityId: period.id,
      type: 'payroll_ready',
      scheduledFor: new Date(), // Send immediately
    })
  } catch (err: any) {
    // Handle race condition: unique constraint violation (P2002)
    if (err?.code === 'P2002') {
      const existingPeriod = await db.payrollPeriod.findFirst({
        where: { userId, periodStart, periodEnd, currency: periodCurrency },
      })
      if (existingPeriod) {
        return {
          id: existingPeriod.id,
          periodStart: existingPeriod.periodStart,
          periodEnd: existingPeriod.periodEnd,
          periodType: existingPeriod.periodType,
          grossCents: existingPeriod.grossCents,
          refundsCents: existingPeriod.refundsCents,
          chargebacksCents: existingPeriod.chargebacksCents,
          platformFeeCents: existingPeriod.platformFeeCents,
          processingFeeCents: existingPeriod.processingFeeCents,
          netCents: existingPeriod.netCents,
          paymentCount: existingPeriod.paymentCount,
          currency: existingPeriod.currency,
          verificationCode: existingPeriod.verificationCode,
          payoutDate: existingPeriod.payoutDate,
          createdAt: existingPeriod.createdAt,
        }
      }
    }
    throw err // Re-throw non-unique constraint errors
  }

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
    // Enhanced fields for verification page
    paymentCount: period.paymentCount,
    payoutDate: period.payoutDate,
    payoutMethod: period.payoutMethod,
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

/**
 * Format payment description for income statements
 * Format: "{tierName} - {type} ({maskedEmail})"
 * Example: "Pro Plan - Subscription (j***n@example.com)"
 */
export function formatPaymentDescription(
  tierName: string | null,
  type: 'recurring' | 'one_time',
  email: string
): string {
  const tier = tierName || 'Subscription'
  const reason = type === 'recurring' ? 'Subscription' : 'One-time payment'
  const maskedEmail = maskEmail(email)
  return `${tier} - ${reason} (${maskedEmail})`
}

// ============================================
// CUSTOM STATEMENT TYPES
// ============================================

export interface CustomStatementRequest {
  startDate: Date
  endDate: Date
  subscriberIds?: string[]
}

export interface CustomStatementResult {
  periodStart: Date
  periodEnd: Date
  grossCents: number
  refundsCents: number
  chargebacksCents: number
  totalFeeCents: number
  netCents: number
  paymentCount: number
  payments: PaymentItem[]
  paymentsTruncated: boolean // True if payments array was capped at 100
  totalsIncomplete: boolean // True if payment query hit limit (totals may be inaccurate)
  currency: string
  ytdGrossCents: number
  ytdNetCents: number
  otherCurrencies: string[] // Currencies excluded from this statement
}

// Maximum days allowed for custom statement date range (1 year)
const MAX_STATEMENT_DAYS = 365
// Maximum payments to load for totals calculation (prevents memory issues)
const MAX_STATEMENT_PAYMENTS = 10000

/**
 * Generate a custom statement for a date range and optional subscriber filter
 * This creates an on-demand report without persisting to the database
 */
export async function generateCustomStatement(
  userId: string,
  request: CustomStatementRequest
): Promise<CustomStatementResult | null> {
  const { startDate, endDate, subscriberIds } = request

  // Guardrail: Validate date range doesn't exceed maximum
  const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
  if (daysDiff > MAX_STATEMENT_DAYS) {
    throw new Error(`Date range exceeds maximum of ${MAX_STATEMENT_DAYS} days. Please select a shorter range.`)
  }
  if (daysDiff < 0) {
    throw new Error('End date must be after start date.')
  }

  // Get profile for currency
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { currency: true, purpose: true },
  })

  if (!profile) return null

  // Build where clause for payments
  const whereClause: any = {
    creatorId: userId,
    status: 'succeeded',
    type: { in: ['one_time', 'recurring'] },
    occurredAt: {
      gte: startDate,
      lte: endDate,
    },
  }

  // Filter by subscriber IDs if provided
  if (subscriberIds && subscriberIds.length > 0) {
    whereClause.subscriberId = { in: subscriberIds }
  }

  // First, determine the currency for this statement
  // Custom statements must be single-currency to be valid
  const currencyCheck = await db.payment.findMany({
    where: whereClause,
    select: { currency: true },
    distinct: ['currency'],
  })

  const currencies = currencyCheck.map((p) => p.currency)

  // Use profile currency as default, or first found currency
  const statementCurrency = currencies.includes(profile.currency)
    ? profile.currency
    : (currencies[0] || profile.currency)

  // Add currency filter to ensure single-currency statement
  const currencyFilteredWhere = {
    ...whereClause,
    currency: statementCurrency,
  }

  // Get successful inbound payments (filtered by currency)
  // Limit query to prevent memory issues for high-volume creators
  const successfulPayments = await db.payment.findMany({
    where: currencyFilteredWhere,
    include: {
      subscription: {
        select: {
          tierName: true,
          subscriber: {
            select: {
              id: true,
              email: true,
            },
          },
        },
      },
    },
    orderBy: { occurredAt: 'desc' },
    take: MAX_STATEMENT_PAYMENTS,
  })

  // Check if we hit the limit (totals may be incomplete)
  const paymentLimitReached = successfulPayments.length >= MAX_STATEMENT_PAYMENTS

  // Get refunds in the same period (same currency)
  // Include both Stripe refunds (type stays original) and Paystack refunds (type='refund')
  const refunds = await db.payment.findMany({
    where: {
      creatorId: userId,
      currency: statementCurrency,
      status: 'refunded',
      type: { in: ['one_time', 'recurring', 'refund'] },
      occurredAt: {
        gte: startDate,
        lte: endDate,
      },
      ...(subscriberIds && subscriberIds.length > 0 ? { subscriberId: { in: subscriberIds } } : {}),
    },
  })

  // Get chargebacks (same currency)
  // Only count 'dispute_lost' (finalized losses) for consistency with period totals
  // Open disputes ('disputed') are excluded to avoid overstating losses
  const chargebacks = await db.payment.findMany({
    where: {
      creatorId: userId,
      status: 'dispute_lost',
      type: { in: ['one_time', 'recurring'] },
      currency: statementCurrency,
      occurredAt: {
        gte: startDate,
        lte: endDate,
      },
      ...(subscriberIds && subscriberIds.length > 0 ? { subscriberId: { in: subscriberIds } } : {}),
    },
  })

  // Use grossCents (subscriber paid) or amountCents (legacy) for gross calculation
  const grossCents = successfulPayments.reduce((sum, p) => {
    return sum + (p.grossCents ?? p.amountCents)
  }, 0)

  const refundsCents = refunds.reduce((sum, p) => {
    return sum + Math.abs(p.grossCents ?? p.amountCents)
  }, 0)

  const chargebacksCents = chargebacks.reduce((sum, p) => {
    return sum + Math.abs(p.grossCents ?? p.amountCents)
  }, 0)

  // Sum creator's fee portion only (4% in split model)
  // For legacy: use feeCents (full platform fee)
  const totalFeeCents = successfulPayments.reduce((sum, p) => {
    return sum + (p.creatorFeeCents ?? p.feeCents)
  }, 0)

  // Calculate net correctly: adjusted gross minus fees
  const adjustedGrossCents = grossCents - refundsCents - chargebacksCents
  const netCents = adjustedGrossCents - totalFeeCents

  // Build payment items
  const payments: PaymentItem[] = successfulPayments.map((p) => {
    const email = p.subscription?.subscriber?.email || ''
    const tierName = p.subscription?.tierName || null
    const paymentType: 'recurring' | 'one_time' = p.type === 'recurring' ? 'recurring' : 'one_time'

    // Use grossCents (subscriber paid) or amountCents (legacy) for consistency with summary
    const baseAmount = p.grossCents ?? p.amountCents

    return {
      id: p.id,
      date: p.occurredAt,
      subscriberName: email.split('@')[0] || 'Anonymous',
      subscriberEmail: maskEmail(email),
      subscriberId: p.subscription?.subscriber?.id || null,
      tierName,
      description: formatPaymentDescription(tierName, paymentType, email),
      amount: baseAmount,
      type: paymentType,
    }
  })

  // Calculate YTD (per-currency)
  const ytd = await calculateYTD(userId, endDate, statementCurrency)

  // Cap payments array to prevent very large responses (totals use full dataset)
  const maxPayments = 100
  const truncatedPayments = payments.slice(0, maxPayments)

  return {
    periodStart: startDate,
    periodEnd: endDate,
    grossCents,
    refundsCents,
    chargebacksCents,
    totalFeeCents,
    netCents,
    paymentCount: successfulPayments.length,
    payments: truncatedPayments,
    paymentsTruncated: payments.length > maxPayments,
    totalsIncomplete: paymentLimitReached,
    currency: statementCurrency,
    ytdGrossCents: ytd.grossCents,
    ytdNetCents: ytd.netCents,
    // Warn if payments in other currencies were excluded
    otherCurrencies: currencies.filter((c) => c !== statementCurrency),
  }
}
