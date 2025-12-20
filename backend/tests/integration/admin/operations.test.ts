/**
 * Admin Operations Tests
 *
 * Tests for admin ops endpoints:
 * - health + email checks
 * - webhooks monitoring
 * - metrics
 * - transfers monitoring
 * - reconciliation controls
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../../src/app.js'
import { db } from '../../../src/db/client.js'
import { resetDatabase, disconnectDatabase } from '../../helpers/db.js'
import { hashToken } from '../../../src/services/auth.js'

const mockCheckEmailHealth = vi.fn()
const mockSendTestEmail = vi.fn()
const mockGetTransferStats = vi.fn()
const mockGetStuckTransfers = vi.fn()
const mockGetMissingTransactions = vi.fn()
const mockReconcilePaystackTransactions = vi.fn()

vi.mock('../../../src/services/email.js', async () => {
  const actual = await vi.importActual('../../../src/services/email.js')
  return {
    ...actual,
    checkEmailHealth: (...args: any[]) => mockCheckEmailHealth(...args),
    sendTestEmail: (...args: any[]) => mockSendTestEmail(...args),
  }
})

vi.mock('../../../src/jobs/transfers.js', () => ({
  getTransferStats: (...args: any[]) => mockGetTransferStats(...args),
  getStuckTransfers: (...args: any[]) => mockGetStuckTransfers(...args),
}))

vi.mock('../../../src/jobs/reconciliation.js', () => ({
  getMissingTransactions: (...args: any[]) => mockGetMissingTransactions(...args),
  reconcilePaystackTransactions: (...args: any[]) => mockReconcilePaystackTransactions(...args),
}))

const adminHeaders = {
  'x-admin-api-key': 'test-admin-key-12345',
}

describe('admin operations', () => {
  beforeEach(async () => {
    await resetDatabase()
    vi.clearAllMocks()

    mockCheckEmailHealth.mockResolvedValue({ healthy: true })
    mockSendTestEmail.mockResolvedValue({
      success: true,
      attempts: 1,
      messageId: 'msg_test_123',
    })
    mockGetTransferStats.mockResolvedValue({
      pending: 2,
      otpPending: 1,
      last24h: { succeeded: 3, failed: 1, total: 4, failureRate: '25.0%' },
      last1h: { succeeded: 1, failed: 1, total: 2, failureRate: '50.0%' },
    })
    mockGetStuckTransfers.mockResolvedValue([])
    mockGetMissingTransactions.mockResolvedValue({
      count: 0,
      windowStart: '2024-01-01T00:00:00.000Z',
      windowEnd: '2024-01-02T00:00:00.000Z',
      transactions: [],
    })
    mockReconcilePaystackTransactions.mockResolvedValue({
      missingInDb: [],
      statusMismatches: [],
      alerts: [],
    })
  })

  afterAll(async () => {
    await resetDatabase()
    await disconnectDatabase()
  })

  it('returns health status with email checks', async () => {
    const res = await app.fetch(
      new Request('http://localhost/admin/health', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('healthy')
    expect(body.database).toBe('connected')
    expect(body.email).toBe('connected')
  })

  it('returns email health status and validates test emails', async () => {
    const healthRes = await app.fetch(
      new Request('http://localhost/admin/email/health', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(healthRes.status).toBe(200)
    const healthBody = await healthRes.json()
    expect(healthBody.healthy).toBe(true)

    const invalidRes = await app.fetch(
      new Request('http://localhost/admin/email/test', {
        method: 'POST',
        headers: {
          ...adminHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ to: 'invalid' }),
      })
    )

    expect(invalidRes.status).toBe(400)

    const validRes = await app.fetch(
      new Request('http://localhost/admin/email/test', {
        method: 'POST',
        headers: {
          ...adminHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ to: 'admin@test.com' }),
      })
    )

    expect(validRes.status).toBe(200)
    const validBody = await validRes.json()
    expect(validBody.success).toBe(true)
    expect(validBody.messageId).toBe('msg_test_123')
  })

  it('returns webhook stats', async () => {
    await db.webhookEvent.create({
      data: {
        provider: 'stripe',
        eventId: 'evt_failed_1',
        eventType: 'invoice.paid',
        status: 'failed',
        retryCount: 1,
      },
    })

    await db.webhookEvent.create({
      data: {
        provider: 'paystack',
        eventId: 'ps_failed_1',
        eventType: 'charge.success',
        status: 'failed',
        retryCount: 0,
      },
    })

    await db.webhookEvent.create({
      data: {
        provider: 'stripe',
        eventId: 'evt_dead_1',
        eventType: 'invoice.paid',
        status: 'dead_letter',
        retryCount: 5,
      },
    })

    await db.webhookEvent.create({
      data: {
        provider: 'stripe',
        eventId: 'evt_done_1',
        eventType: 'invoice.paid',
        status: 'processed',
        processedAt: new Date(),
      },
    })

    const res = await app.fetch(
      new Request('http://localhost/admin/webhooks/stats', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.failed).toEqual({ stripe: 1, paystack: 1, total: 2 })
    expect(body.deadLetter).toBe(1)
    expect(body.processedLast24h).toBe(1)
  })

  it('lists failed webhooks ready for retry', async () => {
    const processedAt = new Date(Date.now() - 2 * 60 * 1000)

    const readyEvent = await db.webhookEvent.create({
      data: {
        provider: 'stripe',
        eventId: 'evt_ready_1',
        eventType: 'invoice.paid',
        status: 'failed',
        retryCount: 0,
        processedAt,
      },
    })

    const res = await app.fetch(
      new Request('http://localhost/admin/webhooks/failed', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events.length).toBe(1)
    expect(body.events[0].id).toBe(readyEvent.id)
  })

  it('lists dead-letter webhooks', async () => {
    const deadEvent = await db.webhookEvent.create({
      data: {
        provider: 'stripe',
        eventId: 'evt_dead_2',
        eventType: 'invoice.paid',
        status: 'dead_letter',
        error: 'Exceeded retries',
      },
    })

    const res = await app.fetch(
      new Request('http://localhost/admin/webhooks/dead-letter', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events[0].id).toBe(deadEvent.id)
  })

  it('retries a webhook and updates status', async () => {
    const retryEvent = await db.webhookEvent.create({
      data: {
        provider: 'stripe',
        eventId: 'evt_retry_1',
        eventType: 'invoice.paid',
        status: 'failed',
        retryCount: 0,
      },
    })

    const res = await app.fetch(
      new Request(`http://localhost/admin/webhooks/${retryEvent.id}/retry`, {
        method: 'POST',
        headers: adminHeaders,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    const updated = await db.webhookEvent.findUnique({
      where: { id: retryEvent.id },
    })

    expect(updated?.status).toBe('pending_retry')
    expect(updated?.retryCount).toBe(1)
  })

  it('returns platform metrics', async () => {
    const creator = await db.user.create({
      data: { email: 'metrics_creator@test.com' },
    })
    const subscriber = await db.user.create({
      data: { email: 'metrics_sub@test.com' },
    })

    await db.profile.create({
      data: {
        userId: creator.id,
        username: 'metrics_creator',
        displayName: 'Metrics Creator',
      },
    })

    await db.profile.create({
      data: {
        userId: subscriber.id,
        username: 'metrics_sub',
        displayName: 'Metrics Subscriber',
      },
    })

    await db.subscription.create({
      data: {
        creatorId: creator.id,
        subscriberId: subscriber.id,
        amount: 1000,
        currency: 'USD',
        interval: 'month',
        status: 'active',
      },
    })

    await db.subscription.create({
      data: {
        creatorId: creator.id,
        subscriberId: subscriber.id,
        amount: 2000,
        currency: 'USD',
        interval: 'month',
        status: 'active',
      },
    })

    await db.subscription.create({
      data: {
        creatorId: creator.id,
        subscriberId: subscriber.id,
        amount: 500,
        currency: 'USD',
        interval: 'month',
        status: 'canceled',
      },
    })

    const res = await app.fetch(
      new Request('http://localhost/admin/metrics', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.users).toBe(2)
    expect(body.profiles).toBe(2)
    expect(body.activeSubscriptions).toBe(2)
    expect(body.monthlyRecurringRevenue).toBe(3000)
  })

  it('returns transfer stats and stuck transfers', async () => {
    mockGetStuckTransfers.mockResolvedValueOnce([
      {
        id: 'tr_1',
        creatorId: 'creator_1',
        creatorName: 'Test Creator',
        creatorEmail: 'creator@test.com',
        amountCents: 1000,
        netCents: 950,
        currency: 'NGN',
        status: 'otp_pending',
        transferCode: 'TRF_123',
        createdAt: new Date(),
        ageHours: 2,
      },
    ])

    const statsRes = await app.fetch(
      new Request('http://localhost/admin/transfers/stats', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(statsRes.status).toBe(200)
    const statsBody = await statsRes.json()
    expect(statsBody.pending).toBe(2)
    expect(statsBody.last24h.failureRate).toBe('25.0%')

    const stuckRes = await app.fetch(
      new Request('http://localhost/admin/transfers/stuck', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(stuckRes.status).toBe(200)
    const stuckBody = await stuckRes.json()
    expect(stuckBody.count).toBe(1)
    expect(stuckBody.warning).toContain('OTP')
  })

  it('lists all pending transfers', async () => {
    const creator = await db.user.create({
      data: { email: 'transfer_creator@test.com' },
    })

    await db.profile.create({
      data: {
        userId: creator.id,
        username: 'transfer_creator',
        displayName: 'Transfer Creator',
      },
    })

    const subscriber = await db.user.create({
      data: { email: 'transfer_sub@test.com' },
    })

    const subscription = await db.subscription.create({
      data: {
        creatorId: creator.id,
        subscriberId: subscriber.id,
        amount: 5000,
        currency: 'NGN',
        interval: 'month',
        status: 'active',
      },
    })

    const payout = await db.payment.create({
      data: {
        subscriptionId: subscription.id,
        creatorId: creator.id,
        subscriberId: subscriber.id,
        amountCents: 5000,
        grossCents: 5000,
        feeCents: 0,
        netCents: 4800,
        currency: 'NGN',
        type: 'payout',
        status: 'pending',
        paystackTransferCode: 'TRF_PENDING_1',
      },
    })

    const res = await app.fetch(
      new Request('http://localhost/admin/transfers/all-pending', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.count).toBe(1)
    expect(body.transfers[0].id).toBe(payout.id)
    expect(body.transfers[0].status).toBe('pending')
  })

  it('returns reconciliation results', async () => {
    // autoFix flow requires session auth + confirmation token
    const admin = await db.user.create({
      data: { email: 'superadmin@test.com', role: 'super_admin' },
    })
    const rawToken = 'superadmin-session-token'
    await db.session.create({
      data: {
        userId: admin.id,
        token: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 86400000),
      },
    })
    const sessionHeaders = { Cookie: `session=${rawToken}` }

    mockGetMissingTransactions.mockResolvedValueOnce({
      count: 1,
      windowStart: '2024-01-01T00:00:00.000Z',
      windowEnd: '2024-01-02T00:00:00.000Z',
      transactions: [
        {
          reference: 'ref_missing_1',
          amount: 1000,
          currency: 'NGN',
          paidAt: '2024-01-01T00:00:00.000Z',
          customerEmail: 'missing@test.com',
          metadata: null,
        },
      ],
    })

    const missingRes = await app.fetch(
      new Request('http://localhost/admin/reconciliation/missing?hours=12', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(missingRes.status).toBe(200)
    const missingBody = await missingRes.json()
    expect(missingBody.periodHours).toBe(12)
    expect(missingBody.count).toBe(1)
    expect(missingBody.warning).not.toBeNull()

    // Preview generates a confirmation token used for autoFix
    mockGetMissingTransactions.mockResolvedValueOnce({
      count: 1,
      windowStart: '2024-01-01T00:00:00.000Z',
      windowEnd: '2024-01-02T00:00:00.000Z',
      transactions: [
        {
          reference: 'ref_missing_1',
          amount: 1000,
          currency: 'NGN',
          paidAt: '2024-01-01T00:00:00.000Z',
          customerEmail: 'missing@test.com',
          metadata: null,
        },
      ],
    })

    const previewRes = await app.fetch(
      new Request('http://localhost/admin/reconciliation/preview', {
        method: 'POST',
        headers: {
          ...sessionHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ periodHours: 12 }),
      })
    )
    expect(previewRes.status).toBe(200)
    const previewBody = await previewRes.json()
    expect(previewBody.confirmationToken).toBeTruthy()

    mockReconcilePaystackTransactions.mockResolvedValueOnce({
      missingInDb: [],
      statusMismatches: [],
      alerts: ['ok'],
      fixedCount: 0,
    })

    const runRes = await app.fetch(
      new Request('http://localhost/admin/reconciliation/run', {
        method: 'POST',
        headers: {
          ...sessionHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ periodHours: 12, autoFix: true, confirmationToken: previewBody.confirmationToken }),
      })
    )

    expect(runRes.status).toBe(200)
    const runBody = await runRes.json()
    expect(runBody.success).toBe(true)
    expect(runBody.alerts).toContain('ok')
    expect(mockReconcilePaystackTransactions).toHaveBeenCalledWith(
      expect.objectContaining({
        periodHours: 12,
        autoFix: true,
        alertOnDiscrepancy: true,
      })
    )
  })
})
