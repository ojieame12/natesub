// Payroll Routes - Pay statement generation and verification
// For service branch creators only

import { Hono } from 'hono'
import { Context, Next } from 'hono'
import { requireAuth } from '../middleware/auth.js'
import { db } from '../db/client.js'
import { env } from '../config/env.js'
import {
  getPayrollPeriods,
  getPayrollPeriod,
  generatePayrollPeriod,
  generateMissingPeriods,
  verifyDocument,
  setPdfUrl,
  getPeriodBoundaries,
} from '../services/payroll.js'
import {
  generateAndUploadPayStatement,
  type PayStatementData,
} from '../services/pdf.js'

const payroll = new Hono()

// ============================================
// MIDDLEWARE
// ============================================

/**
 * Require user to have 'service' purpose for payroll access
 * This ensures only service providers can access pay statements
 */
async function requireServicePurpose(c: Context, next: Next) {
  const userId = c.get('userId')

  const profile = await db.profile.findUnique({
    where: { userId },
    select: { purpose: true },
  })

  if (!profile || profile.purpose !== 'service') {
    return c.json(
      { error: 'Payroll is only available for service providers' },
      403
    )
  }

  await next()
}

// ============================================
// AUTHENTICATED ROUTES
// ============================================

// GET /payroll/periods - List all payroll periods for current user
payroll.get('/periods', requireAuth, requireServicePurpose, async (c) => {
  const userId = c.get('userId')

  // First generate any missing periods
  await generateMissingPeriods(userId)

  // Then fetch all periods
  const periods = await getPayrollPeriods(userId)

  // Return with pagination-ready structure
  return c.json({
    periods: periods.map((p) => ({
      id: p.id,
      periodStart: p.periodStart.toISOString(),
      periodEnd: p.periodEnd.toISOString(),
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
      createdAt: p.createdAt.toISOString(),
    })),
    total: periods.length,
  })
})

// GET /payroll/periods/:id - Get single period with payment details
payroll.get('/periods/:id', requireAuth, requireServicePurpose, async (c) => {
  const userId = c.get('userId')
  const periodId = c.req.param('id')

  const period = await getPayrollPeriod(userId, periodId)

  if (!period) {
    return c.json({ error: 'Period not found' }, 404)
  }

  return c.json({
    period: {
      id: period.id,
      periodStart: period.periodStart.toISOString(),
      periodEnd: period.periodEnd.toISOString(),
      periodType: period.periodType,
      grossCents: period.grossCents,
      refundsCents: period.refundsCents,
      chargebacksCents: period.chargebacksCents,
      adjustedGrossCents: period.adjustedGrossCents,
      platformFeeCents: period.platformFeeCents,
      processingFeeCents: period.processingFeeCents,
      netCents: period.netCents,
      paymentCount: period.paymentCount,
      currency: period.currency,
      ytdGrossCents: period.ytdGrossCents,
      ytdNetCents: period.ytdNetCents,
      payoutDate: period.payoutDate?.toISOString() || null,
      payoutMethod: period.payoutMethod,
      bankLast4: period.bankLast4,
      pdfUrl: period.pdfUrl,
      verificationCode: period.verificationCode,
      createdAt: period.createdAt.toISOString(),
      payments: period.payments.map((p) => ({
        id: p.id,
        date: p.date.toISOString(),
        subscriberName: p.subscriberName,
        subscriberEmail: p.subscriberEmail,
        amount: p.amount,
        type: p.type,
      })),
    },
  })
})

// POST /payroll/periods/:id/pdf - Generate PDF for a period
payroll.post('/periods/:id/pdf', requireAuth, requireServicePurpose, async (c) => {
  const userId = c.get('userId')
  const periodId = c.req.param('id')

  // Get period with details
  const period = await getPayrollPeriod(userId, periodId)

  if (!period) {
    return c.json({ error: 'Period not found' }, 404)
  }

  // Check if PDF already exists
  if (period.pdfUrl) {
    return c.json({
      pdfUrl: period.pdfUrl,
      cached: true,
    })
  }

  // Get user and profile info for PDF
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      profile: {
        select: {
          displayName: true,
          currency: true,
        },
      },
    },
  })

  if (!user || !user.profile) {
    return c.json({ error: 'User profile not found' }, 404)
  }

  // Build PDF data
  const verificationUrl = `${env.APP_URL}/verify/${period.verificationCode}`

  const pdfData: PayStatementData = {
    creatorName: user.profile.displayName,
    creatorEmail: user.email,
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
    verificationCode: period.verificationCode,
    verificationUrl,
    currency: user.profile.currency,
  }

  // Generate and upload PDF
  const pdfUrl = await generateAndUploadPayStatement(userId, periodId, pdfData)

  // Store URL in database
  await setPdfUrl(periodId, pdfUrl)

  return c.json({
    pdfUrl,
    cached: false,
  })
})

// GET /payroll/current - Get current period info (even if incomplete)
payroll.get('/current', requireAuth, requireServicePurpose, async (c) => {
  const userId = c.get('userId')

  const now = new Date()
  const { start, end } = getPeriodBoundaries(now)

  // Aggregate current period payments
  const payments = await db.payment.findMany({
    where: {
      creatorId: userId,
      status: 'succeeded',
      occurredAt: {
        gte: start,
        lte: now, // Up to now, not end of period
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
  const platformFeeCents = Math.round(grossCents * 0.08)
  const processingFeeCents = Math.round(grossCents * 0.02)
  const netCents = grossCents - platformFeeCents - processingFeeCents

  return c.json({
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    isComplete: false,
    grossCents,
    platformFeeCents,
    processingFeeCents,
    netCents,
    paymentCount: payments.length,
  })
})

// GET /payroll/summary - Get overall payroll summary
payroll.get('/summary', requireAuth, requireServicePurpose, async (c) => {
  const userId = c.get('userId')

  // Get all completed periods
  const periods = await getPayrollPeriods(userId)

  // Calculate totals
  const totalGrossCents = periods.reduce((sum, p) => sum + p.grossCents, 0)
  const totalNetCents = periods.reduce((sum, p) => sum + p.netCents, 0)
  const totalPayments = periods.reduce((sum, p) => sum + p.paymentCount, 0)

  // Get current year YTD
  const now = new Date()
  const yearStart = new Date(now.getFullYear(), 0, 1)

  const ytdPeriods = periods.filter((p) => p.periodStart >= yearStart)
  const ytdGrossCents = ytdPeriods.reduce((sum, p) => sum + p.grossCents, 0)
  const ytdNetCents = ytdPeriods.reduce((sum, p) => sum + p.netCents, 0)

  return c.json({
    totalPeriods: periods.length,
    totalGrossCents,
    totalNetCents,
    totalPayments,
    ytdGrossCents,
    ytdNetCents,
    latestPeriod: periods[0]
      ? {
          id: periods[0].id,
          periodStart: periods[0].periodStart.toISOString(),
          periodEnd: periods[0].periodEnd.toISOString(),
          netCents: periods[0].netCents,
        }
      : null,
  })
})

// ============================================
// PUBLIC ROUTES
// ============================================

// GET /payroll/verify/:code - Public verification endpoint
payroll.get('/verify/:code', async (c) => {
  const code = c.req.param('code')

  if (!code || code.length < 10) {
    return c.json({ error: 'Invalid verification code' }, 400)
  }

  const result = await verifyDocument(code)

  if (!result) {
    return c.json({ error: 'Document not found' }, 404)
  }

  return c.json({
    verified: true,
    document: {
      creatorName: result.creatorName,
      periodStart: result.periodStart.toISOString(),
      periodEnd: result.periodEnd.toISOString(),
      grossCents: result.grossCents,
      netCents: result.netCents,
      currency: result.currency,
      createdAt: result.createdAt.toISOString(),
      verificationCode: result.verificationCode,
    },
  })
})

export default payroll
