// Payroll Auto-Generation Job
// Runs on the 1st and 16th of each month to generate completed period statements

import { db } from '../db/client.js'
import { redis } from '../db/redis.js'
import {
  generatePayrollPeriod,
  getPeriodBoundaries,
  getPayrollPeriod,
} from '../services/payroll.js'
import { generateAndUploadPayStatement, type PayStatementData } from '../services/pdf.js'
import { setPdfUrl } from '../services/payroll.js'
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
        // Generate payroll period
        const period = await generatePayrollPeriod(creatorId, periodStart, periodEnd)

        if (!period) {
          result.skipped++
          console.log(`[payroll] No payments for ${creatorId} in period`)
          continue
        }

        result.generated++
        console.log(`[payroll] Generated period ${period.id} for ${creatorId}`)

        // Auto-generate PDF
        const fullPeriod = await getPayrollPeriod(creatorId, period.id)
        if (fullPeriod && !fullPeriod.pdfUrl) {
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

            const pdfData: PayStatementData = {
              creatorName: user.profile.displayName,
              creatorEmail: user.email,
              periodStart: fullPeriod.periodStart,
              periodEnd: fullPeriod.periodEnd,
              periodType: fullPeriod.periodType,
              grossCents: fullPeriod.grossCents,
              platformFeeCents: fullPeriod.platformFeeCents,
              processingFeeCents: fullPeriod.processingFeeCents,
              netCents: fullPeriod.netCents,
              paymentCount: fullPeriod.paymentCount,
              ytdGrossCents: fullPeriod.ytdGrossCents,
              ytdNetCents: fullPeriod.ytdNetCents,
              payoutDate: fullPeriod.payoutDate,
              payoutMethod: fullPeriod.payoutMethod,
              bankLast4: fullPeriod.bankLast4,
              verificationCode: period.verificationCode,
              verificationUrl,
              currency: user.profile.currency,
            }

            const pdfUrl = await generateAndUploadPayStatement(creatorId, period.id, pdfData)
            await setPdfUrl(period.id, pdfUrl)

            result.pdfsGenerated++
            console.log(`[payroll] Generated PDF for period ${period.id}`)
          }
        }
      } catch (error: any) {
        result.errors.push({
          userId: creatorId,
          error: error.message || 'Unknown error',
        })
        console.error(`[payroll] Error processing ${creatorId}:`, error.message)
      }
    }

    console.log(
      `[payroll] Complete: ${result.generated} periods, ${result.pdfsGenerated} PDFs, ${result.skipped} skipped`
    )

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
        const result = await generatePayrollPeriod(userId, period.start, period.end)
        if (result) generated++
      }

      // Move to next period
      checkDate = new Date(period.end.getTime() + 1)
    }

    console.log(`[payroll] Generated ${generated} historical periods for ${userId}`)
    return generated
  } finally {
    await redis.del(userLockKey)
  }
}

export default {
  generatePayrollPeriods,
  generateUserMissingPeriods,
}
