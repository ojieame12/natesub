/**
 * Admin Payments Tests
 *
 * Tests for payment management endpoints:
 * - GET /admin/payments
 * - GET /admin/payments/:id
 * - POST /admin/payments/:id/refund
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../../src/app.js'
import { db } from '../../../src/db/client.js'
import { resetDatabase, disconnectDatabase } from '../../helpers/db.js'

// Mock Stripe
const mockStripeRefund = vi.fn()

vi.mock('../../../src/services/stripe.js', async () => {
  const actual = await vi.importActual('../../../src/services/stripe.js')
  return {
    ...actual,
    stripe: {
      refunds: {
        create: (...args: any[]) => mockStripeRefund(...args),
      },
    },
  }
})

const adminHeaders = {
  'x-admin-api-key': 'test-admin-key-12345',
}

describe('admin payments', () => {
  beforeEach(async () => {
    await resetDatabase()
    vi.clearAllMocks()
  })

  afterAll(async () => {
    await resetDatabase()
    await disconnectDatabase()
  })

  async function createTestPayments() {
    const creator = await db.user.create({
      data: { email: 'creator@test.com' },
    })

    await db.profile.create({
      data: {
        userId: creator.id,
        username: 'creator',
        displayName: 'Test Creator',
        paymentProvider: 'stripe',
      },
    })

    const subscriber = await db.user.create({
      data: { email: 'subscriber@test.com' },
    })

    const subscription = await db.subscription.create({
      data: {
        creatorId: creator.id,
        subscriberId: subscriber.id,
        amount: 1000,
        currency: 'USD',
        interval: 'month',
        status: 'active',
      },
    })

    const successfulPayment = await db.payment.create({
      data: {
        subscriptionId: subscription.id,
        creatorId: creator.id,
        subscriberId: subscriber.id,
        grossCents: 1040,
        amountCents: 1000,
        feeCents: 80,
        netCents: 960,
        currency: 'USD',
        type: 'recurring',
        status: 'succeeded',
        stripePaymentIntentId: 'pi_test_123',
      },
    })

    const failedPayment = await db.payment.create({
      data: {
        subscriptionId: subscription.id,
        creatorId: creator.id,
        subscriberId: subscriber.id,
        grossCents: 1040,
        amountCents: 1000,
        feeCents: 80,
        netCents: 960,
        currency: 'USD',
        type: 'recurring',
        status: 'failed',
      },
    })

    const refundedPayment = await db.payment.create({
      data: {
        subscriptionId: subscription.id,
        creatorId: creator.id,
        subscriberId: subscriber.id,
        grossCents: 2000,
        amountCents: 2000,
        feeCents: 160,
        netCents: 1840,
        currency: 'USD',
        type: 'recurring',
        status: 'refunded',
        stripePaymentIntentId: 'pi_refunded_456',
      },
    })

    return {
      creator,
      subscriber,
      subscription,
      successfulPayment,
      failedPayment,
      refundedPayment,
    }
  }

  describe('GET /admin/payments', () => {
    it('lists all payments', async () => {
      await createTestPayments()

      const res = await app.fetch(
        new Request('http://localhost/admin/payments', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.payments).toHaveLength(3)
      expect(body.total).toBe(3)
    })

    it('filters by status', async () => {
      await createTestPayments()

      const res = await app.fetch(
        new Request('http://localhost/admin/payments?status=succeeded', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.payments).toHaveLength(1)
      expect(body.payments[0].status).toBe('succeeded')
    })

    it('returns payment with all fields and nested creator/subscriber', async () => {
      await createTestPayments()

      const res = await app.fetch(
        new Request('http://localhost/admin/payments?status=succeeded', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      // Check payment has expected fields
      const payment = body.payments[0]
      expect(payment).toHaveProperty('id')
      expect(payment).toHaveProperty('status', 'succeeded')
      expect(payment).toHaveProperty('grossCents')
      expect(payment).toHaveProperty('currency')
      // Check nested creator and subscriber
      expect(payment).toHaveProperty('creator')
      expect(payment.creator).toHaveProperty('id')
      expect(payment.creator).toHaveProperty('email')
      expect(payment.creator).toHaveProperty('username')
      expect(payment).toHaveProperty('subscriber')
      expect(payment.subscriber).toHaveProperty('id')
      expect(payment.subscriber).toHaveProperty('email')
      // Check provider field
      expect(payment).toHaveProperty('provider')
      expect(['stripe', 'paystack', 'unknown']).toContain(payment.provider)
    })

    it('includes fee breakdown', async () => {
      await createTestPayments()

      const res = await app.fetch(
        new Request('http://localhost/admin/payments?status=succeeded', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      const payment = body.payments[0]
      expect(payment.grossCents).toBe(1040)
      expect(payment.amountCents).toBe(1000)
      expect(payment.feeCents).toBe(80)
      expect(payment.netCents).toBe(960)
    })

    it('paginates results', async () => {
      await createTestPayments()

      const res = await app.fetch(
        new Request('http://localhost/admin/payments?limit=2&page=1', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.payments).toHaveLength(2)
      expect(body.page).toBe(1)
      expect(body.total).toBe(3)
      expect(body.totalPages).toBe(2)
    })
  })

  describe('GET /admin/payments/:id', () => {
    it('returns payment details', async () => {
      const { successfulPayment } = await createTestPayments()

      const res = await app.fetch(
        new Request(`http://localhost/admin/payments/${successfulPayment.id}`, {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.payment.id).toBe(successfulPayment.id)
      expect(body.payment.status).toBe('succeeded')
      expect(body.payment.subscription).not.toBeNull()
    })

    it('returns 404 for non-existent payment', async () => {
      const res = await app.fetch(
        new Request('http://localhost/admin/payments/non-existent-id', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(404)
    })
  })

  describe('POST /admin/payments/:id/refund', () => {
    it('refunds a Stripe payment', async () => {
      const { successfulPayment } = await createTestPayments()

      mockStripeRefund.mockResolvedValue({
        id: 're_test_123',
        amount: 1040,
        status: 'succeeded',
      })

      const res = await app.fetch(
        new Request(`http://localhost/admin/payments/${successfulPayment.id}/refund`, {
          method: 'POST',
          headers: {
            ...adminHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reason: 'Customer requested refund' }),
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.refund.id).toBe('re_test_123')

      // Verify payment status updated
      const payment = await db.payment.findUnique({
        where: { id: successfulPayment.id },
      })
      expect(payment?.status).toBe('refunded')

      // Verify Stripe was called correctly (now includes idempotencyKey option)
      expect(mockStripeRefund).toHaveBeenCalledWith(
        {
          payment_intent: 'pi_test_123',
          amount: undefined, // Full refund
          reason: 'requested_by_customer',
        },
        expect.objectContaining({ idempotencyKey: expect.any(String) })
      )
    })

    it('supports partial refunds', async () => {
      const { successfulPayment } = await createTestPayments()

      mockStripeRefund.mockResolvedValue({
        id: 're_partial_123',
        amount: 500,
        status: 'succeeded',
      })

      const res = await app.fetch(
        new Request(`http://localhost/admin/payments/${successfulPayment.id}/refund`, {
          method: 'POST',
          headers: {
            ...adminHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ amount: 500 }),
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      // The refund response includes amountCents from the Stripe response
      expect(body.refund).toHaveProperty('id', 're_partial_123')
      expect(mockStripeRefund).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 500 }),
        expect.objectContaining({ idempotencyKey: expect.any(String) })
      )
    })

    it('creates activity log for refund', async () => {
      const { successfulPayment, creator } = await createTestPayments()

      mockStripeRefund.mockResolvedValue({
        id: 're_test_123',
        amount: 1040,
        status: 'succeeded',
      })

      await app.fetch(
        new Request(`http://localhost/admin/payments/${successfulPayment.id}/refund`, {
          method: 'POST',
          headers: {
            ...adminHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reason: 'Test refund' }),
        })
      )

      const activity = await db.activity.findFirst({
        where: {
          userId: creator.id,
          type: 'admin_refund',
        },
      })

      expect(activity).not.toBeNull()
      expect((activity?.payload as any).reason).toBe('Test refund')
    })

    it('rejects refund for already refunded payment', async () => {
      const { refundedPayment } = await createTestPayments()

      const res = await app.fetch(
        new Request(`http://localhost/admin/payments/${refundedPayment.id}/refund`, {
          method: 'POST',
          headers: {
            ...adminHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        })
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('Already refunded')
    })

    it('rejects refund for failed payment', async () => {
      const { failedPayment } = await createTestPayments()

      const res = await app.fetch(
        new Request(`http://localhost/admin/payments/${failedPayment.id}/refund`, {
          method: 'POST',
          headers: {
            ...adminHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        })
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('succeeded payments')
    })

    it('returns 404 for non-existent payment', async () => {
      const res = await app.fetch(
        new Request('http://localhost/admin/payments/non-existent-id/refund', {
          method: 'POST',
          headers: {
            ...adminHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        })
      )

      expect(res.status).toBe(404)
    })
  })
})
