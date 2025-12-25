// Payroll Auto-Generation Job
// Runs on the 1st and 16th of each month to generate completed period statements

import { db } from '../db/client.js'
import { redis } from '../db/redis.js'
import {
  generatePayrollPeriodsForAllCurrencies,
  getPeriodBoundaries,
  getPayrollPeriod,
} from '../services/payroll.js'
import { generateAndUploadPayStatement, type IncomeStatementData, type PaymentRecord } from '../services/pdf.js'
import { setPdfUrl } from '../services/payroll.js'
import { alertSystemError } from '../services/slack.js'
import { env } from '../config/env.js'

// Lock key prefix for deduplication
const LOCK_PREFIX = 'payroll_lock:'
const LOCK_TTL_SECONDS = 3600 // 1 hour

interface PayrollJobResult {
  processed: number
  generated: number
  pdfsGenerated: number
  skipped: number
  errors: Array<{ userId: string; error: string }>
}

/**
 * Generate payroll periods for all creators with payments
 * Run on the 1st and 16th of each month
 */
export async function generatePayrollPeriods(): Promise<PayrollJobResult> {
  const result: PayrollJobResult = {
    processed: 0,
    generated: 0,
    pdfsGenerated: 0,
    skipped: 0,
    errors: [],
  }

  // Acquire job-level lock (single key for all payroll job runs)
  const jobLockKey = `${LOCK_PREFIX}job:generate`
  const gotLock = await redis.set(jobLockKey, '1', 'EX', LOCK_TTL_SECONDS, 'NX')

  if (!gotLock) {
    console.log('[payroll] Another payroll job is already running')
    return result
  }

  try {
    const now = new Date()

    // Calculate the previous period (the one that just ended)
    // On the 1st, generate 16th-end of previous month
    // On the 16th, generate 1st-15th of current month
    let periodStart: Date
    let periodEnd: Date

    const day = now.getDate()
    const month = now.getMonth()
    const year = now.getFullYear()

    if (day <= 7) {
      // First week of month - generate previous month's second half
      const prevMonth = month === 0 ? 11 : month - 1
      const prevYear = month === 0 ? year - 1 : year
      const lastDay = new Date(prevYear, prevMonth + 1, 0).getDate()
      periodStart = new Date(Date.UTC(prevYear, prevMonth, 16, 0, 0, 0, 0))
      periodEnd = new Date(Date.UTC(prevYear, prevMonth, lastDay, 23, 59, 59, 999))
    } else if (day >= 16 && day <= 22) {
      // Days 16-22 - generate current month's first half
      periodStart = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0))
      periodEnd = new Date(Date.UTC(year, month, 15, 23, 59, 59, 999))
    } else {
      // Not a payroll generation window
      console.log('[payroll] Not in payroll generation window, skipping')
      return result
    }

    console.log(`[payroll] Generating periods for ${periodStart.toISOString()} - ${periodEnd.toISOString()}`)

    // Find all creators who have received payments in the period
    const creatorsWithPayments = await db.payment.findMany({
      where: {
        status: 'succeeded',
        occurredAt: {
          gte: periodStart,
          lte: periodEnd,
        },
      },
      select: {
        creatorId: true,
      },
      distinct: ['creatorId'],
    })

    const creatorIds = [...new Set(creatorsWithPayments.map((p) => p.creatorId))]
    console.log(`[payroll] Found ${creatorIds.length} creators with payments`)

    for (const creatorId of creatorIds) {
      result.processed++

      // Per-user lock to prevent duplicate processing
      const userLockKey = `${LOCK_PREFIX}user:${creatorId}:${periodStart.toISOString()}`
      const userLock = await redis.set(userLockKey, '1', 'EX', LOCK_TTL_SECONDS, 'NX')

      if (!userLock) {
        result.skipped++
        console.log(`[payroll] Skipping ${creatorId}: already being processed`)
        continue
      }

      try {
        // Generate payroll periods for ALL currencies the creator received
        // This prevents missing statements for multi-currency creators
        const periodsGenerated = await generatePayrollPeriodsForAllCurrencies(creatorId, periodStart, periodEnd)

        if (periodsGenerated === 0) {
          result.skipped++
          console.log(`[payroll] No payments for ${creatorId} in period`)
          continue
        }

        result.generated += periodsGenerated
        console.log(`[payroll] Generated ${periodsGenerated} period(s) for ${creatorId}`)

        // Fetch all periods for this date range to generate PDFs
        const periodsForPdf = await db.payrollPeriod.findMany({
          where: {
            userId: creatorId,
            periodStart,
            periodEnd,
            pdfUrl: null, // Only ones without PDF
          },
        })

        for (const period of periodsForPdf) {
          // Auto-generate PDF for this period
          const fullPeriod = await getPayrollPeriod(creatorId, period.id)
          if (fullPeriod) {
            const user = await db.user.findUnique({
              where: { id: creatorId },
              include: {
                profile: {
                  select: {
                    displayName: true,
                    currency: true,
                    address: true,
                    city: true,
                    state: true,
                    zip: true,
                  },
                },
              },
            })

            if (user?.profile) {
              const verificationUrl = `${env.APP_URL}/verify/${period.verificationCode}`

              // Get active subscriber count
              const activeSubscribers = await db.subscription.count({
                where: {
                  creatorId,
                  status: { in: ['active', 'past_due'] },
                },
              })

              // Get first payment date for "earning since"
              const firstPayment = await db.payment.findFirst({
                where: { creatorId, status: 'succeeded' },
                orderBy: { occurredAt: 'asc' },
                select: { occurredAt: true },
              })
              const earningsSince = firstPayment?.occurredAt || fullPeriod.periodStart

              // Calculate months since first payment for average
              const monthsActive = Math.max(1, Math.ceil(
                (new Date().getTime() - earningsSince.getTime()) / (30 * 24 * 60 * 60 * 1000)
              ))
              const avgMonthlyEarnings = Math.round(fullPeriod.ytdNetCents / monthsActive)

              // Build payments array from period payments
              // Use formatted description from payroll service, not raw email
              const payments: PaymentRecord[] = fullPeriod.payments.map((p) => ({
                date: p.date,
                amount: p.amount,
                description: p.description || 'Subscription payment',
              }))

              // Count YTD payments - filter by period currency for accuracy
              const ytdPaymentCount = await db.payment.count({
                where: {
                  creatorId,
                  status: 'succeeded',
                  currency: fullPeriod.currency, // Match period currency
                  occurredAt: { gte: new Date(new Date().getFullYear(), 0, 1) },
                },
              })

              const pdfData: IncomeStatementData = {
                payeeName: user.profile.displayName,
                payeeEmail: user.email,
                payeeAddress: user.profile.address ? {
                  street: user.profile.address,
                  city: user.profile.city || undefined,
                  state: user.profile.state || undefined,
                  zip: user.profile.zip || undefined,
                } : undefined,
                periodStart: fullPeriod.periodStart,
                periodEnd: fullPeriod.periodEnd,
                activeSubscribers,
                totalEarnings: fullPeriod.netCents,
                payments,
                depositDate: fullPeriod.payoutDate,
                depositMethod: fullPeriod.payoutMethod || 'Bank Transfer',
                bankLast4: fullPeriod.bankLast4,
                ytdEarnings: fullPeriod.ytdNetCents,
                ytdPaymentCount,
                earningsSince,
                avgMonthlyEarnings,
                statementId: period.verificationCode,
                verificationUrl,
                currency: fullPeriod.currency, // Use period currency, not profile default
              }

              const pdfUrl = await generateAndUploadPayStatement(creatorId, period.id, pdfData)
              await setPdfUrl(period.id, pdfUrl)

              result.pdfsGenerated++
              console.log(`[payroll] Generated PDF for period ${period.id}`)
            }
          }
        } // End for periodsForPdf loop
      } catch (error: any) {
        result.errors.push({
          userId: creatorId,
          error: error.message || 'Unknown error',
        })
        console.error(`[payroll] Error processing ${creatorId}:`, error.message)

        // Alert on individual creator failures for visibility
        await alertSystemError({
          service: 'payroll',
          error: `Failed to generate payroll for creator ${creatorId}`,
          context: {
            creatorId,
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            errorMessage: error.message,
          },
        }).catch((alertErr) => {
          // Don't let alert failures break the job
          console.error('[payroll] Failed to send error alert:', alertErr.message)
        })
      }
    }

    console.log(
      `[payroll] Complete: ${result.generated} periods, ${result.pdfsGenerated} PDFs, ${result.skipped} skipped`
    )

    // Send summary alert if there were any errors
    if (result.errors.length > 0) {
      await alertSystemError({
        service: 'payroll',
        error: `Payroll job completed with ${result.errors.length} error(s)`,
        context: {
          processed: result.processed,
          generated: result.generated,
          pdfsGenerated: result.pdfsGenerated,
          skipped: result.skipped,
          errorCount: result.errors.length,
          errors: result.errors.slice(0, 5), // First 5 errors for brevity
        },
      }).catch((alertErr) => {
        console.error('[payroll] Failed to send summary alert:', alertErr.message)
      })
    }

    return result
  } finally {
    // Release job lock
    await redis.del(jobLockKey)
  }
}

/**
 * Generate missing historical periods for a specific user
 * Call this when a user first views their payroll page
 */
export async function generateUserMissingPeriods(userId: string): Promise<number> {
  const userLockKey = `${LOCK_PREFIX}backfill:${userId}`
  const gotLock = await redis.set(userLockKey, '1', 'EX', 300, 'NX') // 5 minute lock

  if (!gotLock) {
    console.log(`[payroll] Backfill already running for ${userId}`)
    return 0
  }

  try {
    // Get user's first payment
    const firstPayment = await db.payment.findFirst({
      where: { creatorId: userId, status: 'succeeded' },
      orderBy: { occurredAt: 'asc' },
      select: { occurredAt: true },
    })

    if (!firstPayment) return 0

    const now = new Date()
    const currentPeriod = getPeriodBoundaries(now)

    let generated = 0
    let checkDate = new Date(firstPayment.occurredAt)

    while (checkDate < currentPeriod.start) {
      const period = getPeriodBoundaries(checkDate)

      if (period.end < now) {
        // Generate for ALL currencies the user received in this period
        const count = await generatePayrollPeriodsForAllCurrencies(userId, period.start, period.end)
        generated += count
      }

      // Move to next period
      checkDate = new Date(period.end.getTime() + 1)
    }

    console.log(`[payroll] Generated ${generated} historical period(s) for ${userId}`)
    return generated
  } finally {
    await redis.del(userLockKey)
  }
}

export default {
  generatePayrollPeriods,
  generateUserMissingPeriods,
}
