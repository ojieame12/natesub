// Payroll Routes - Pay statement generation and verification

import { Hono } from 'hono'
import { requireAuth } from '../middleware/auth.js'
import { publicStrictRateLimit } from '../middleware/rateLimit.js'
import { db } from '../db/client.js'
import { env } from '../config/env.js'
import {
  getPayrollPeriods,
  getPayrollPeriod,
  generatePayrollPeriod,
  verifyDocument,
  setPdfUrl,
  getPeriodBoundaries,
  generateCustomStatement,
  aggregatePayments,
} from '../services/payroll.js'
import {
  generateAndUploadPayStatement,
  getPayStatementSignedUrl,
  type IncomeStatementData,
  type PaymentRecord,
} from '../services/pdf.js'

const payroll = new Hono()

// ============================================
// AUTHENTICATED ROUTES
// ============================================

// GET /payroll/periods - List all payroll periods for current user
payroll.get('/periods', requireAuth, async (c) => {
  const userId = c.get('userId')
  const now = new Date()

  // Fetch existing periods immediately (no blocking generation)
  // Period generation happens via:
  // 1. Scheduled cron job (primary)
  // 2. POST /payroll/generate endpoint (manual trigger)
  const periods = await getPayrollPeriods(userId)

  // Check if user has address for warning
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { address: true },
  })

  const warnings: Array<{ type: string; message: string }> = []
  if (!profile?.address) {
    warnings.push({
      type: 'missing_address',
      message: 'Add your address in Settings for complete income statements',
    })
  }

  // Calculate YTD totals per currency (current year)
  // YTD must be per-currency to be mathematically valid
  const currentYear = now.getFullYear()
  const ytdByCurrency: Record<string, number> = {}

  periods
    .filter((p) => p.periodStart.getFullYear() === currentYear)
    .forEach((p) => {
      ytdByCurrency[p.currency] = (ytdByCurrency[p.currency] || 0) + p.netCents
    })

  // Return with pagination-ready structure
  return c.json({
    periods: periods.map((p) => {
      // Determine status: current (ongoing), pending (completed but not paid), paid
      // Status logic consistent with detail view - uses payoutDate
      const isPeriodComplete = p.periodEnd < now
      let status: 'current' | 'pending' | 'paid' = 'current'
      if (isPeriodComplete) {
        // If payoutDate exists, it's paid; otherwise pending
        status = p.payoutDate ? 'paid' : 'pending'
      }

      return {
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
        status,
        verificationCode: p.verificationCode,
        createdAt: p.createdAt.toISOString(),
      }
    }),
    ytdByCurrency, // YTD per currency: { "USD": 50000, "NGN": 1000000 }
    total: periods.length,
    warnings,
  })
})

// POST /payroll/generate - Manually trigger period generation (non-blocking)
// This backfills any missing periods without blocking the list endpoint
payroll.post('/generate', requireAuth, async (c) => {
  const userId = c.get('userId')

  // Import dynamically to avoid circular deps
  const { generateMissingPeriods } = await import('../services/payroll.js')

  // Run backfill in background - don't await
  // This generates all missing periods without blocking the response
  generateMissingPeriods(userId).catch((err: Error) => {
    console.error('[payroll] Background generation failed:', err)
  })

  return c.json({
    message: 'Period generation started',
    status: 'processing',
  })
})

// GET /payroll/periods/:id - Get single period with payment details
payroll.get('/periods/:id', requireAuth, async (c) => {
  const userId = c.get('userId')
  const periodId = c.req.param('id')

  const period = await getPayrollPeriod(userId, periodId)

  if (!period) {
    return c.json({ error: 'Period not found' }, 404)
  }

  // Determine status based on period completion and payout
  const now = new Date()
  const isPeriodComplete = period.periodEnd < now
  let status: 'current' | 'pending' | 'paid' = 'current'
  if (isPeriodComplete) {
    // If payoutDate exists, it's paid; otherwise pending
    status = period.payoutDate ? 'paid' : 'pending'
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
      status,
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
        amountCents: p.amount,
        type: p.type,
      })),
    },
  })
})

// POST /payroll/periods/:id/pdf - Generate PDF for a period
payroll.post('/periods/:id/pdf', requireAuth, async (c) => {
  const userId = c.get('userId')
  const periodId = c.req.param('id')

  // Get period with details
  const period = await getPayrollPeriod(userId, periodId)

  if (!period) {
    return c.json({ error: 'Period not found' }, 404)
  }

  // Check if PDF already exists (pdfUrl is the storage key)
  if (period.pdfUrl) {
    // Generate a time-limited signed URL for secure access
    const signedUrl = await getPayStatementSignedUrl(period.pdfUrl)
    return c.json({
      pdfUrl: signedUrl,
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
          address: true,
          city: true,
          state: true,
          zip: true,
        },
      },
    },
  })

  if (!user || !user.profile) {
    return c.json({ error: 'User profile not found' }, 404)
  }

  // Build PDF data
  const verificationUrl = `${env.APP_URL}/verify/${period.verificationCode}`

  // Get active subscriber count
  const activeSubscribers = await db.subscription.count({
    where: {
      creatorId: userId,
      status: { in: ['active', 'past_due'] },
    },
  })

  // Get first payment date for "earning since"
  const firstPayment = await db.payment.findFirst({
    where: { creatorId: userId, status: 'succeeded' },
    orderBy: { occurredAt: 'asc' },
    select: { occurredAt: true },
  })
  const earningsSince = firstPayment?.occurredAt || period.periodStart

  // Calculate months since first payment for average
  const monthsActive = Math.max(1, Math.ceil(
    (new Date().getTime() - earningsSince.getTime()) / (30 * 24 * 60 * 60 * 1000)
  ))
  const avgMonthlyEarnings = Math.round(period.ytdNetCents / monthsActive)

  // Build payments array from period payments (use formatted description from service)
  const payments: PaymentRecord[] = period.payments.map((p) => ({
    date: p.date,
    amount: p.amount,
    description: p.description || 'Subscription payment',
  }))

  // Count YTD payments (filter by period currency for accuracy)
  const ytdPaymentCount = await db.payment.count({
    where: {
      creatorId: userId,
      status: 'succeeded',
      currency: period.currency,
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
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    activeSubscribers,
    totalEarnings: period.netCents,
    payments,
    depositDate: period.payoutDate,
    depositMethod: period.payoutMethod || 'Bank Transfer',
    bankLast4: period.bankLast4,
    ytdEarnings: period.ytdNetCents,
    ytdPaymentCount,
    earningsSince,
    avgMonthlyEarnings,
    statementId: period.verificationCode,
    verificationUrl,
    currency: period.currency, // Use period's currency, not profile's (profile currency may have changed)
  }

  // Generate and upload PDF (returns storage key, not public URL)
  const pdfKey = await generateAndUploadPayStatement(userId, periodId, pdfData)

  // Store storage key in database
  await setPdfUrl(periodId, pdfKey)

  // Generate a time-limited signed URL for secure access
  const signedUrl = await getPayStatementSignedUrl(pdfKey)

  return c.json({
    pdfUrl: signedUrl,
    cached: false,
  })
})

// GET /payroll/current - Get current period info (even if incomplete)
payroll.get('/current', requireAuth, async (c) => {
  const userId = c.get('userId')

  const now = new Date()
  const { start, end } = getPeriodBoundaries(now)

  // Use DB-side aggregation for totals (scalable for high-volume creators)
  // This avoids loading all payments into memory
  const {
    grossCents,
    totalFeeCents,
    totalNetCents,
    paymentCount,
  } = await aggregatePayments(userId, start, now) // Up to now, not end of period

  // Processing fee is 0 in split model (absorbed by subscriber's portion)
  const processingFeeCents = 0

  return c.json({
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    isComplete: false,
    grossCents,
    platformFeeCents: totalFeeCents,
    processingFeeCents,
    netCents: totalNetCents,
    paymentCount,
  })
})

// GET /payroll/summary - Get overall payroll summary
payroll.get('/summary', requireAuth, async (c) => {
  const userId = c.get('userId')

  // Get all completed periods
  const periods = await getPayrollPeriods(userId)

  // Calculate per-currency totals (mathematically valid)
  const totalsByCurrency: Record<string, { grossCents: number; netCents: number; paymentCount: number }> = {}
  for (const p of periods) {
    if (!totalsByCurrency[p.currency]) {
      totalsByCurrency[p.currency] = { grossCents: 0, netCents: 0, paymentCount: 0 }
    }
    totalsByCurrency[p.currency].grossCents += p.grossCents
    totalsByCurrency[p.currency].netCents += p.netCents
    totalsByCurrency[p.currency].paymentCount += p.paymentCount
  }

  // Get current year YTD per currency
  const now = new Date()
  const yearStart = new Date(now.getFullYear(), 0, 1)
  const ytdPeriods = periods.filter((p) => p.periodStart >= yearStart)

  const ytdByCurrency: Record<string, { grossCents: number; netCents: number }> = {}
  for (const p of ytdPeriods) {
    if (!ytdByCurrency[p.currency]) {
      ytdByCurrency[p.currency] = { grossCents: 0, netCents: 0 }
    }
    ytdByCurrency[p.currency].grossCents += p.grossCents
    ytdByCurrency[p.currency].netCents += p.netCents
  }

  return c.json({
    totalPeriods: periods.length,
    totalsByCurrency,
    ytdByCurrency,
    latestPeriod: periods[0]
      ? {
          id: periods[0].id,
          periodStart: periods[0].periodStart.toISOString(),
          periodEnd: periods[0].periodEnd.toISOString(),
          netCents: periods[0].netCents,
          currency: periods[0].currency,
        }
      : null,
  })
})

// GET /payroll/subscribers - List unique subscribers for filter selection
payroll.get('/subscribers', requireAuth, async (c) => {
  const userId = c.get('userId')

  // Get unique subscribers from payments
  // Order by occurredAt desc so distinct returns the most recent payment (current tier)
  const payments = await db.payment.findMany({
    where: {
      creatorId: userId,
      status: 'succeeded',
      type: { in: ['one_time', 'recurring'] },
    },
    select: {
      subscription: {
        select: {
          subscriber: {
            select: {
              id: true,
              email: true,
            },
          },
          tierName: true,
        },
      },
    },
    orderBy: { occurredAt: 'desc' }, // Get most recent tier for each subscriber
    distinct: ['subscriberId'],
    take: 200, // Cap to prevent unbounded queries
  })

  // Helper to mask email
  const maskEmail = (email: string): string => {
    if (!email || !email.includes('@')) return '****'
    const [local, domain] = email.split('@')
    if (local.length <= 2) return `${local[0]}***@${domain}`
    return `${local[0]}***${local.slice(-1)}@${domain}`
  }

  // Transform to unique subscriber list
  const subscriberMap = new Map<string, { id: string; email: string; displayName: string; tierName: string | null }>()

  payments.forEach((p) => {
    const subscriber = p.subscription?.subscriber
    if (subscriber && !subscriberMap.has(subscriber.id)) {
      subscriberMap.set(subscriber.id, {
        id: subscriber.id,
        email: maskEmail(subscriber.email),
        displayName: subscriber.email.split('@')[0],
        tierName: p.subscription?.tierName || null,
      })
    }
  })

  return c.json({
    subscribers: Array.from(subscriberMap.values()),
  })
})

// POST /payroll/custom-statement - Generate custom statement with filters
payroll.post('/custom-statement', requireAuth, async (c) => {
  const userId = c.get('userId')

  // Parse JSON body with error handling
  let body: { startDate?: string; endDate?: string; subscriberIds?: string[] }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Validate required fields
  const { startDate, endDate, subscriberIds } = body

  if (!startDate || !endDate) {
    return c.json({ error: 'startDate and endDate are required' }, 400)
  }

  // Parse dates
  const start = new Date(startDate)
  const end = new Date(endDate)

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return c.json({ error: 'Invalid date format' }, 400)
  }

  if (start > end) {
    return c.json({ error: 'startDate must be before endDate' }, 400)
  }

  // Validate date range (max 1 year)
  const oneYearMs = 365 * 24 * 60 * 60 * 1000
  if (end.getTime() - start.getTime() > oneYearMs) {
    return c.json({ error: 'Date range cannot exceed 1 year' }, 400)
  }

  // Validate subscriberIds if provided
  if (subscriberIds && (!Array.isArray(subscriberIds) || subscriberIds.some((id: unknown) => typeof id !== 'string'))) {
    return c.json({ error: 'subscriberIds must be an array of strings' }, 400)
  }

  // Generate custom statement
  const statement = await generateCustomStatement(userId, {
    startDate: start,
    endDate: end,
    subscriberIds: subscriberIds || undefined,
  })

  if (!statement) {
    return c.json({ error: 'Failed to generate statement' }, 500)
  }

  // Check if user has address for warning
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { address: true },
  })

  // Custom statements are ephemeral (not stored) and cannot be independently verified
  // The frontend should display this clearly to users
  const hasFilters = subscriberIds && subscriberIds.length > 0

  // Build warnings array
  const warnings: Array<{ type: string; message: string }> = []

  if (!profile?.address) {
    warnings.push({
      type: 'missing_address',
      message: 'Add your address in Settings for complete income statements',
    })
  }

  if (statement.otherCurrencies.length > 0) {
    warnings.push({
      type: 'multi_currency',
      message: `Payments in ${statement.otherCurrencies.join(', ')} were excluded. This statement only includes ${statement.currency} payments.`,
    })
  }

  return c.json({
    statement: {
      periodStart: statement.periodStart.toISOString(),
      periodEnd: statement.periodEnd.toISOString(),
      grossCents: statement.grossCents,
      refundsCents: statement.refundsCents,
      chargebacksCents: statement.chargebacksCents,
      totalFeeCents: statement.totalFeeCents,
      netCents: statement.netCents,
      paymentCount: statement.paymentCount,
      currency: statement.currency,
      ytdGrossCents: statement.ytdGrossCents,
      ytdNetCents: statement.ytdNetCents,
      payments: statement.payments.map((p) => ({
        id: p.id,
        date: p.date.toISOString(),
        subscriberName: p.subscriberName,
        subscriberEmail: p.subscriberEmail,
        description: p.description,
        amountCents: p.amount,
        type: p.type,
      })),
      // Custom statements cannot be verified - no verification code generated
      isVerifiable: false,
      isFiltered: hasFilters, // Indicates subscriber filtering was applied
      paymentsTruncated: statement.paymentsTruncated, // True if > 100 payments
    },
    warnings,
  })
})

// ============================================
// PUBLIC ROUTES
// ============================================

// GET /payroll/verify/:code - Public verification endpoint
payroll.get('/verify/:code', publicStrictRateLimit, async (c) => {
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
      // Enhanced fields
      paymentCount: result.paymentCount,
      payoutDate: result.payoutDate?.toISOString() || null,
      payoutMethod: result.payoutMethod || 'Bank Transfer',
      platformConfirmed: true,
    },
  })
})

// GET /payroll/verify/:code/pdf - Download verification PDF (public)
payroll.get('/verify/:code/pdf', publicStrictRateLimit, async (c) => {
  const code = c.req.param('code')

  if (!code || code.length < 10) {
    return c.json({ error: 'Invalid verification code' }, 400)
  }

  const result = await verifyDocument(code)

  if (!result) {
    return c.json({ error: 'Document not found' }, 404)
  }

  // Import dynamically to avoid circular dependency
  const { generateVerificationPdf } = await import('../services/pdf.js')

  const pdfBuffer = await generateVerificationPdf({
    creatorName: result.creatorName,
    periodStart: result.periodStart,
    periodEnd: result.periodEnd,
    grossCents: result.grossCents,
    netCents: result.netCents,
    currency: result.currency,
    paymentCount: result.paymentCount,
    payoutDate: result.payoutDate,
    payoutMethod: result.payoutMethod,
    verificationCode: result.verificationCode,
    verifiedAt: new Date(),
  })

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="verification-${code}.pdf"`,
    },
  })
})

export default payroll
