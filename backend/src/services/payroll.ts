// Payroll Service - Generate pay statements for service providers
// Aggregates payment data into bi-weekly periods with verification

import crypto from 'crypto'
import { db } from '../db/client.js'
import type { PayrollPeriodType } from '@prisma/client'

// Platform fee breakdown
const PLATFORM_FEE_PERCENT = 8
const PROCESSING_FEE_PERCENT = 2
const TOTAL_FEE_PERCENT = PLATFORM_FEE_PERCENT + PROCESSING_FEE_PERCENT

// ============================================
// TYPES
// ============================================

export interface PayrollSummary {
  id: string
  periodStart: Date
  periodEnd: Date
  periodType: PayrollPeriodType
  grossCents: number
  platformFeeCents: number
  processingFeeCents: number
  netCents: number
  paymentCount: number
  verificationCode: string
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
 * Format: NP-YYYY-MMM-XXXXX
 */
export function generateVerificationCode(userId: string, periodEnd: Date): string {
  const year = periodEnd.getFullYear()
  const month = periodEnd.toLocaleString('en', { month: 'short' }).toUpperCase()
  const hash = crypto
    .createHash('sha256')
    .update(`${userId}-${periodEnd.toISOString()}-${Date.now()}-${Math.random()}`)
    .digest('hex')
    .substring(0, 5)
    .toUpperCase()

  return `NP-${year}-${month}-${hash}`
}

// ============================================
// DATA AGGREGATION
// ============================================

/**
 * Aggregate payments for a user within a period
 */
async function aggregatePayments(
  userId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<{
  grossCents: number
  paymentCount: number
  payments: PaymentItem[]
}> {
  const payments = await db.payment.findMany({
    where: {
      creatorId: userId,
      status: 'succeeded',
      occurredAt: {
        gte: periodStart,
        lte: periodEnd,
      },
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

  const grossCents = payments.reduce((sum, p) => sum + p.amountCents, 0)

  const paymentItems: PaymentItem[] = payments.map((p) => ({
    id: p.id,
    date: p.occurredAt,
    subscriberName: p.subscription?.subscriber?.email?.split('@')[0] || 'Anonymous',
    subscriberEmail: maskEmail(p.subscription?.subscriber?.email || ''),
    amount: p.amountCents,
    type: p.type === 'recurring' ? 'recurring' : 'one_time',
  }))

  return {
    grossCents,
    paymentCount: payments.length,
    payments: paymentItems,
  }
}

/**
 * Calculate year-to-date totals
 */
async function calculateYTD(
  userId: string,
  asOfDate: Date
): Promise<{ grossCents: number; netCents: number }> {
  const yearStart = new Date(asOfDate.getFullYear(), 0, 1, 0, 0, 0, 0)

  const result = await db.payment.aggregate({
    where: {
      creatorId: userId,
      status: 'succeeded',
      occurredAt: {
        gte: yearStart,
        lte: asOfDate,
      },
    },
    _sum: {
      amountCents: true,
    },
  })

  const grossCents = result._sum.amountCents || 0
  const netCents = Math.round(grossCents * (1 - TOTAL_FEE_PERCENT / 100))

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
    return profile.paystackAccountNumber.slice(-4)
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
    platformFeeCents: p.platformFeeCents,
    processingFeeCents: p.processingFeeCents,
    netCents: p.netCents,
    paymentCount: p.paymentCount,
    verificationCode: p.verificationCode,
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

  // Get individual payments for this period
  const { payments } = await aggregatePayments(userId, period.periodStart, period.periodEnd)

  return {
    id: period.id,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    periodType: period.periodType,
    grossCents: period.grossCents,
    platformFeeCents: period.platformFeeCents,
    processingFeeCents: period.processingFeeCents,
    netCents: period.netCents,
    paymentCount: period.paymentCount,
    ytdGrossCents: period.ytdGrossCents,
    ytdNetCents: period.ytdNetCents,
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
 * Generate a payroll period for a user
 * This aggregates all payments in the period and creates a snapshot
 */
export async function generatePayrollPeriod(
  userId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<PayrollSummary | null> {
  // Check if period already exists
  const existing = await db.payrollPeriod.findFirst({
    where: {
      userId,
      periodStart,
      periodEnd,
    },
  })

  if (existing) {
    return {
      id: existing.id,
      periodStart: existing.periodStart,
      periodEnd: existing.periodEnd,
      periodType: existing.periodType,
      grossCents: existing.grossCents,
      platformFeeCents: existing.platformFeeCents,
      processingFeeCents: existing.processingFeeCents,
      netCents: existing.netCents,
      paymentCount: existing.paymentCount,
      verificationCode: existing.verificationCode,
      createdAt: existing.createdAt,
    }
  }

  // Aggregate payments
  const { grossCents, paymentCount } = await aggregatePayments(userId, periodStart, periodEnd)

  // Skip if no payments
  if (paymentCount === 0) {
    return null
  }

  // Calculate fees
  const platformFeeCents = Math.round(grossCents * (PLATFORM_FEE_PERCENT / 100))
  const processingFeeCents = Math.round(grossCents * (PROCESSING_FEE_PERCENT / 100))
  const netCents = grossCents - platformFeeCents - processingFeeCents

  // Calculate YTD
  const ytd = await calculateYTD(userId, periodEnd)

  // Get bank info
  const bankLast4 = await getBankLast4(userId)

  // Get payment provider
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { paymentProvider: true },
  })

  // Generate verification code
  const verificationCode = generateVerificationCode(userId, periodEnd)

  // Create period record
  const period = await db.payrollPeriod.create({
    data: {
      userId,
      periodStart,
      periodEnd,
      periodType: 'biweekly',
      grossCents,
      platformFeeCents,
      processingFeeCents,
      netCents,
      paymentCount,
      ytdGrossCents: ytd.grossCents,
      ytdNetCents: ytd.netCents,
      payoutDate: new Date(), // Approximate - actual payout timing varies
      payoutMethod: profile?.paymentProvider || null,
      bankLast4,
      verificationCode,
    },
  })

  return {
    id: period.id,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    periodType: period.periodType,
    grossCents: period.grossCents,
    platformFeeCents: period.platformFeeCents,
    processingFeeCents: period.processingFeeCents,
    netCents: period.netCents,
    paymentCount: period.paymentCount,
    verificationCode: period.verificationCode,
    createdAt: period.createdAt,
  }
}

/**
 * Generate all missing payroll periods for a user
 * Call this when user views payroll history
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
      const result = await generatePayrollPeriod(userId, period.start, period.end)
      if (result) generated++
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
    currency: period.user.profile?.currency || 'USD',
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
