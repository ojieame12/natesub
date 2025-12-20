import { beforeEach, describe, expect, it, vi, afterAll } from 'vitest'
import { createHmac } from 'crypto'
import app from '../../src/app.js'
import { db } from '../../src/db/client.js'
import { dbStorage } from '../setup.js'
import { env } from '../../src/config/env.js'

// Mock payroll service
vi.mock('../../src/services/payroll.js', () => ({
  getPayrollPeriods: vi.fn(),
  getPayrollPeriod: vi.fn(),
  generateMissingPeriods: vi.fn(),
  verifyDocument: vi.fn(),
  setPdfUrl: vi.fn(),
  getPeriodBoundaries: vi.fn(),
}))

// Mock PDF service
vi.mock('../../src/services/pdf.js', () => ({
  generateAndUploadPayStatement: vi.fn(),
  getPayStatementSignedUrl: vi.fn(),
}))

import {
  getPayrollPeriods,
  getPayrollPeriod,
  generateMissingPeriods,
  verifyDocument,
  setPdfUrl,
  getPeriodBoundaries,
} from '../../src/services/payroll.js'
import {
  generateAndUploadPayStatement,
  getPayStatementSignedUrl,
} from '../../src/services/pdf.js'

const mockGetPayrollPeriods = vi.mocked(getPayrollPeriods)
const mockGetPayrollPeriod = vi.mocked(getPayrollPeriod)
const mockGenerateMissingPeriods = vi.mocked(generateMissingPeriods)
const mockVerifyDocument = vi.mocked(verifyDocument)
const mockSetPdfUrl = vi.mocked(setPdfUrl)
const mockGetPeriodBoundaries = vi.mocked(getPeriodBoundaries)
const mockGenerateAndUploadPayStatement = vi.mocked(generateAndUploadPayStatement)
const mockGetPayStatementSignedUrl = vi.mocked(getPayStatementSignedUrl)

// Hash function matching auth service
function hashToken(token: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex')
}

// Helper to create a test service provider with session
async function createServiceProviderWithSession(email?: string) {
  const user = await db.user.create({
    data: { email: email || `service-${Date.now()}@test.com` },
  })

  const profile = await db.profile.create({
    data: {
      userId: user.id,
      username: `service${Date.now()}`,
      displayName: 'Test Service Provider',
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      purpose: 'service', // Service purpose for payroll access
      pricingModel: 'single',
      singleAmount: 10000,
      stripeAccountId: 'acct_test123',
      payoutStatus: 'active',
    },
  })

  const rawToken = `test-session-${Date.now()}-${Math.random()}`
  const hashedToken = hashToken(rawToken)

  const session = await db.session.create({
    data: {
      userId: user.id,
      token: hashedToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  dbStorage.sessions.set(session.id, { ...session, user })

  return { user, profile, session, rawToken }
}

// Helper to create a non-service user (tips/personal purpose)
async function createNonServiceUserWithSession(email?: string) {
  const user = await db.user.create({
    data: { email: email || `tips-${Date.now()}@test.com` },
  })

  const profile = await db.profile.create({
    data: {
      userId: user.id,
      username: `tips${Date.now()}`,
      displayName: 'Test Tips User',
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      purpose: 'tips', // Non-service purpose
      pricingModel: 'single',
      singleAmount: 1000,
    },
  })

  const rawToken = `test-session-${Date.now()}-${Math.random()}`
  const hashedToken = hashToken(rawToken)

  const session = await db.session.create({
    data: {
      userId: user.id,
      token: hashedToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  dbStorage.sessions.set(session.id, { ...session, user })

  return { user, profile, session, rawToken }
}

// Helper to make authenticated request
function authRequest(path: string, options: RequestInit = {}, rawToken: string) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session=${rawToken}`,
        ...options.headers,
      },
    })
  )
}

// Helper to make public request
function publicRequest(path: string, options: RequestInit = {}) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
  )
}

// Sample period data
function createMockPeriod(overrides: any = {}) {
  const now = new Date()
  return {
    id: `period-${Date.now()}`,
    userId: 'user-123',
    periodStart: new Date(now.getFullYear(), now.getMonth(), 1),
    periodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59),
    periodType: 'monthly',
    grossCents: 100000,
    refundsCents: 0,
    chargebacksCents: 0,
    adjustedGrossCents: 100000,
    platformFeeCents: 20000,
    processingFeeCents: 5000,
    netCents: 75000,
    paymentCount: 10,
    currency: 'USD',
    ytdGrossCents: 500000,
    ytdNetCents: 375000,
    payoutDate: null,
    payoutMethod: null,
    bankLast4: null,
    pdfUrl: null,
    verificationCode: 'VERIFY123ABC',
    createdAt: new Date(),
    payments: [],
    ...overrides,
  }
}

describe('payroll routes', () => {
  beforeEach(() => {
    Object.values(dbStorage).forEach(store => store.clear())
    vi.clearAllMocks()
  })

  afterAll(() => {
    Object.values(dbStorage).forEach(store => store.clear())
  })

  describe('GET /payroll/periods', () => {
    it('requires authentication', async () => {
      const res = await publicRequest('/payroll/periods', { method: 'GET' })
      expect(res.status).toBe(401)
    })

    it('returns 403 for non-service purpose users', async () => {
      const { rawToken } = await createNonServiceUserWithSession()

      const res = await authRequest('/payroll/periods', { method: 'GET' }, rawToken)
      expect(res.status).toBe(403)

      const body = await res.json()
      expect(body.error).toContain('service providers')
    })

    it('returns empty list when no periods exist', async () => {
      const { user, rawToken } = await createServiceProviderWithSession()

      mockGenerateMissingPeriods.mockResolvedValue(undefined)
      mockGetPayrollPeriods.mockResolvedValue([])

      const res = await authRequest('/payroll/periods', { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.periods).toEqual([])
      expect(body.ytdTotalCents).toBe(0)
      expect(body.total).toBe(0)

      expect(mockGenerateMissingPeriods).toHaveBeenCalledWith(user.id)
    })

    it('returns list of periods with correct status', async () => {
      const { user, rawToken } = await createServiceProviderWithSession()

      const now = new Date()
      const pastPeriod = createMockPeriod({
        id: 'period-past',
        periodEnd: new Date(now.getTime() - 86400000), // Yesterday
        payoutDate: new Date(), // Paid
      })
      const pendingPeriod = createMockPeriod({
        id: 'period-pending',
        periodEnd: new Date(now.getTime() - 86400000), // Yesterday
        payoutDate: null, // Not paid yet
      })
      const currentPeriod = createMockPeriod({
        id: 'period-current',
        periodEnd: new Date(now.getTime() + 86400000), // Tomorrow
      })

      mockGenerateMissingPeriods.mockResolvedValue(undefined)
      mockGetPayrollPeriods.mockResolvedValue([currentPeriod, pendingPeriod, pastPeriod])

      const res = await authRequest('/payroll/periods', { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.periods).toHaveLength(3)

      // Find each period and check status
      const current = body.periods.find((p: any) => p.id === 'period-current')
      const pending = body.periods.find((p: any) => p.id === 'period-pending')
      const paid = body.periods.find((p: any) => p.id === 'period-past')

      expect(current.status).toBe('current')
      expect(pending.status).toBe('pending')
      expect(paid.status).toBe('paid')
    })

    it('calculates YTD total correctly', async () => {
      const { rawToken } = await createServiceProviderWithSession()

      const currentYear = new Date().getFullYear()
      const periods = [
        createMockPeriod({
          id: 'period-1',
          periodStart: new Date(currentYear, 0, 1),
          netCents: 50000,
        }),
        createMockPeriod({
          id: 'period-2',
          periodStart: new Date(currentYear, 1, 1),
          netCents: 75000,
        }),
        createMockPeriod({
          id: 'period-last-year',
          periodStart: new Date(currentYear - 1, 11, 1),
          netCents: 100000, // Should not be included
        }),
      ]

      mockGenerateMissingPeriods.mockResolvedValue(undefined)
      mockGetPayrollPeriods.mockResolvedValue(periods)

      const res = await authRequest('/payroll/periods', { method: 'GET' }, rawToken)
      const body = await res.json()

      expect(body.ytdTotalCents).toBe(125000) // 50000 + 75000
    })
  })

  describe('GET /payroll/periods/:id', () => {
    it('requires authentication', async () => {
      const res = await publicRequest('/payroll/periods/period-123', { method: 'GET' })
      expect(res.status).toBe(401)
    })

    it('returns 403 for non-service users', async () => {
      const { rawToken } = await createNonServiceUserWithSession()

      const res = await authRequest('/payroll/periods/period-123', { method: 'GET' }, rawToken)
      expect(res.status).toBe(403)
    })

    it('returns 404 for non-existent period', async () => {
      const { user, rawToken } = await createServiceProviderWithSession()

      mockGetPayrollPeriod.mockResolvedValue(null)

      const res = await authRequest('/payroll/periods/period-123', { method: 'GET' }, rawToken)
      expect(res.status).toBe(404)
    })

    it('returns period details with payments', async () => {
      const { user, rawToken } = await createServiceProviderWithSession()

      const period = createMockPeriod({
        id: 'period-123',
        payments: [
          {
            id: 'payment-1',
            date: new Date(),
            subscriberName: 'John Doe',
            subscriberEmail: 'john@test.com',
            amount: 10000,
            type: 'recurring',
          },
        ],
      })

      mockGetPayrollPeriod.mockResolvedValue(period)

      const res = await authRequest('/payroll/periods/period-123', { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.period.id).toBe('period-123')
      expect(body.period.payments).toHaveLength(1)
      expect(body.period.payments[0].subscriberName).toBe('John Doe')
    })
  })

  describe('POST /payroll/periods/:id/pdf', () => {
    it('requires authentication', async () => {
      const res = await publicRequest('/payroll/periods/period-123/pdf', { method: 'POST' })
      expect(res.status).toBe(401)
    })

    it('returns 403 for non-service users', async () => {
      const { rawToken } = await createNonServiceUserWithSession()

      const res = await authRequest('/payroll/periods/period-123/pdf', { method: 'POST' }, rawToken)
      expect(res.status).toBe(403)
    })

    it('returns 404 for non-existent period', async () => {
      const { rawToken } = await createServiceProviderWithSession()

      mockGetPayrollPeriod.mockResolvedValue(null)

      const res = await authRequest('/payroll/periods/period-123/pdf', { method: 'POST' }, rawToken)
      expect(res.status).toBe(404)
    })

    it('returns cached PDF URL if already exists', async () => {
      const { rawToken } = await createServiceProviderWithSession()

      const period = createMockPeriod({
        id: 'period-123',
        pdfUrl: 'payroll/user-123/period-123.pdf', // Already generated
      })

      mockGetPayrollPeriod.mockResolvedValue(period)
      mockGetPayStatementSignedUrl.mockResolvedValue('https://signed-url.example.com/pdf')

      const res = await authRequest('/payroll/periods/period-123/pdf', { method: 'POST' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.pdfUrl).toBe('https://signed-url.example.com/pdf')
      expect(body.cached).toBe(true)

      // Should not generate new PDF
      expect(mockGenerateAndUploadPayStatement).not.toHaveBeenCalled()
    })

    it('generates new PDF if not cached', async () => {
      const { user, rawToken } = await createServiceProviderWithSession()

      const period = createMockPeriod({
        id: 'period-123',
        pdfUrl: null, // Not generated yet
      })

      mockGetPayrollPeriod.mockResolvedValue(period)
      mockGenerateAndUploadPayStatement.mockResolvedValue('payroll/user-123/period-123.pdf')
      mockSetPdfUrl.mockResolvedValue(undefined)
      mockGetPayStatementSignedUrl.mockResolvedValue('https://signed-url.example.com/new-pdf')

      const res = await authRequest('/payroll/periods/period-123/pdf', { method: 'POST' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.pdfUrl).toBe('https://signed-url.example.com/new-pdf')
      expect(body.cached).toBe(false)

      expect(mockGenerateAndUploadPayStatement).toHaveBeenCalled()
      expect(mockSetPdfUrl).toHaveBeenCalledWith('period-123', 'payroll/user-123/period-123.pdf')
    })
  })

  describe('GET /payroll/current', () => {
    it('requires authentication', async () => {
      const res = await publicRequest('/payroll/current', { method: 'GET' })
      expect(res.status).toBe(401)
    })

    it('returns 403 for non-service users', async () => {
      const { rawToken } = await createNonServiceUserWithSession()

      const res = await authRequest('/payroll/current', { method: 'GET' }, rawToken)
      expect(res.status).toBe(403)
    })

    it('returns current period info with aggregated payments', async () => {
      const { user, profile, rawToken } = await createServiceProviderWithSession()

      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

      mockGetPeriodBoundaries.mockReturnValue({ start, end })

      // Create test payments
      await db.payment.create({
        data: {
          profileId: profile.id,
          creatorId: user.id,
          amountCents: 10000,
          feeCents: 1000,
          netCents: 9000,
          currency: 'USD',
          status: 'succeeded',
          type: 'recurring',
          occurredAt: new Date(),
        },
      })

      const res = await authRequest('/payroll/current', { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.periodStart).toBeDefined()
      expect(body.periodEnd).toBeDefined()
      expect(body.isComplete).toBe(false)
      expect(body.grossCents).toBe(10000)
      expect(body.netCents).toBe(9000)
      expect(body.paymentCount).toBe(1)
    })
  })

  describe('GET /payroll/summary', () => {
    it('requires authentication', async () => {
      const res = await publicRequest('/payroll/summary', { method: 'GET' })
      expect(res.status).toBe(401)
    })

    it('returns 403 for non-service users', async () => {
      const { rawToken } = await createNonServiceUserWithSession()

      const res = await authRequest('/payroll/summary', { method: 'GET' }, rawToken)
      expect(res.status).toBe(403)
    })

    it('returns summary with totals', async () => {
      const { rawToken } = await createServiceProviderWithSession()

      const currentYear = new Date().getFullYear()
      const periods = [
        createMockPeriod({
          id: 'period-1',
          periodStart: new Date(currentYear, 0, 1),
          grossCents: 100000,
          netCents: 75000,
          paymentCount: 10,
        }),
        createMockPeriod({
          id: 'period-2',
          periodStart: new Date(currentYear, 1, 1),
          grossCents: 150000,
          netCents: 112500,
          paymentCount: 15,
        }),
      ]

      mockGetPayrollPeriods.mockResolvedValue(periods)

      const res = await authRequest('/payroll/summary', { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.totalPeriods).toBe(2)
      expect(body.totalGrossCents).toBe(250000)
      expect(body.totalNetCents).toBe(187500)
      expect(body.totalPayments).toBe(25)
      expect(body.latestPeriod).toBeDefined()
    })

    it('returns null latestPeriod when no periods exist', async () => {
      const { rawToken } = await createServiceProviderWithSession()

      mockGetPayrollPeriods.mockResolvedValue([])

      const res = await authRequest('/payroll/summary', { method: 'GET' }, rawToken)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.totalPeriods).toBe(0)
      expect(body.latestPeriod).toBeNull()
    })
  })

  describe('GET /payroll/verify/:code', () => {
    it('returns 400 for invalid verification code', async () => {
      const res = await publicRequest('/payroll/verify/short', { method: 'GET' })
      expect(res.status).toBe(400)

      const body = await res.json()
      expect(body.error).toContain('Invalid verification code')
    })

    it('returns 404 for non-existent document', async () => {
      mockVerifyDocument.mockResolvedValue(null)

      const res = await publicRequest('/payroll/verify/ABCDEF123456', { method: 'GET' })
      expect(res.status).toBe(404)

      const body = await res.json()
      expect(body.error).toContain('not found')
    })

    it('returns verified document info', async () => {
      const documentInfo = {
        creatorName: 'John Service Provider',
        periodStart: new Date(2024, 0, 1),
        periodEnd: new Date(2024, 0, 31),
        grossCents: 100000,
        netCents: 75000,
        currency: 'USD',
        createdAt: new Date(),
        verificationCode: 'VERIFY123ABC',
      }

      mockVerifyDocument.mockResolvedValue(documentInfo)

      const res = await publicRequest('/payroll/verify/VERIFY123ABC', { method: 'GET' })
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.verified).toBe(true)
      expect(body.document.creatorName).toBe('John Service Provider')
      expect(body.document.grossCents).toBe(100000)
      expect(body.document.verificationCode).toBe('VERIFY123ABC')
    })
  })
})
