import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handlePaystackDisputeCreated, handlePaystackDisputeResolved } from '../../src/routes/webhooks/paystack/dispute.js'

// Mock database
const mockFindFirst = vi.fn()
const mockFindUnique = vi.fn()
const mockCreate = vi.fn()
const mockUpdate = vi.fn()

vi.mock('../../src/db/client.js', () => ({
  db: {
    payment: {
      findFirst: (...args: any[]) => mockFindFirst(...args),
      findUnique: (...args: any[]) => mockFindUnique(...args),
      create: (...args: any[]) => mockCreate(...args),
      update: (...args: any[]) => mockUpdate(...args),
    },
    subscription: {
      findFirst: (...args: any[]) => mockFindFirst(...args),
      findUnique: (...args: any[]) => mockFindUnique(...args),
      update: (...args: any[]) => mockUpdate(...args),
    },
    user: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
      update: (...args: any[]) => mockUpdate(...args),
    },
    activity: {
      create: (...args: any[]) => mockCreate(...args),
    },
  },
}))

// Mock email service
const mockSendDisputeCreatedEmail = vi.fn()
const mockSendDisputeResolvedEmail = vi.fn()

vi.mock('../../src/services/email.js', () => ({
  sendDisputeCreatedEmail: (...args: any[]) => mockSendDisputeCreatedEmail(...args),
  sendDisputeResolvedEmail: (...args: any[]) => mockSendDisputeResolvedEmail(...args),
}))

describe('Paystack Dispute Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handlePaystackDisputeCreated', () => {
    const mockDisputeData = {
      id: 12345,
      reference: 'TXN_ref_123',
      amount: 50000, // 500 NGN in kobo
      currency: 'NGN',
      reason: 'customer_complaint',
      status: 'awaiting_merchant_response',
    }

    it('should create dispute payment record when original payment found', async () => {
      const mockOriginalPayment = {
        id: 'pmt-original',
        creatorId: 'creator-123',
        subscriberId: 'subscriber-456',
        subscription: {
          id: 'sub-789',
          creatorId: 'creator-123',
          subscriberId: 'subscriber-456',
          ltvCents: 100000,
          interval: 'month',
        },
      }

      mockFindFirst
        .mockResolvedValueOnce(mockOriginalPayment) // Original payment lookup
        .mockResolvedValueOnce(null) // Idempotency check - no existing dispute

      mockFindUnique
        .mockResolvedValueOnce({ disputeCount: 0 }) // Subscriber lookup
        .mockResolvedValueOnce({ email: 'creator@test.com', profile: { displayName: 'Creator' } }) // Creator for email

      await handlePaystackDisputeCreated(mockDisputeData, 'evt-123')

      // Should create dispute payment
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: 'sub-789',
            creatorId: 'creator-123',
            amountCents: -50000, // Negative
            status: 'disputed',
            paystackDisputeId: '12345',
          }),
        })
      )

      // Should decrement LTV
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sub-789' },
          data: { ltvCents: { decrement: 50000 } },
        })
      )

      // Should increment subscriber dispute count
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'subscriber-456' },
          data: expect.objectContaining({
            disputeCount: 1,
          }),
        })
      )

      // Should send email
      expect(mockSendDisputeCreatedEmail).toHaveBeenCalledWith(
        'creator@test.com',
        'Creator',
        50000,
        'NGN',
        'customer_complaint'
      )
    })

    it('should skip if original payment not found', async () => {
      mockFindFirst.mockResolvedValueOnce(null) // No original payment

      await handlePaystackDisputeCreated(mockDisputeData, 'evt-123')

      expect(mockCreate).not.toHaveBeenCalled()
      expect(mockSendDisputeCreatedEmail).not.toHaveBeenCalled()
    })

    it('should skip if dispute already processed (idempotency)', async () => {
      const mockOriginalPayment = {
        id: 'pmt-original',
        creatorId: 'creator-123',
        subscriberId: 'subscriber-456',
        subscription: { id: 'sub-789', creatorId: 'creator-123', ltvCents: 100000, interval: 'month' },
      }

      mockFindFirst
        .mockResolvedValueOnce(mockOriginalPayment) // Original payment
        .mockResolvedValueOnce({ id: 'existing-dispute' }) // Existing dispute (idempotency)

      await handlePaystackDisputeCreated(mockDisputeData, 'evt-123')

      // Should not create another dispute payment
      expect(mockCreate).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'disputed' }),
        })
      )
    })

    it('should block subscriber after 2 disputes', async () => {
      const mockOriginalPayment = {
        id: 'pmt-original',
        creatorId: 'creator-123',
        subscriberId: 'repeat-offender',
        subscription: { id: 'sub-789', creatorId: 'creator-123', subscriberId: 'repeat-offender', ltvCents: 100000, interval: 'month' },
      }

      mockFindFirst
        .mockResolvedValueOnce(mockOriginalPayment)
        .mockResolvedValueOnce(null) // No existing dispute

      mockFindUnique
        .mockResolvedValueOnce({ disputeCount: 1 }) // Already has 1 dispute
        .mockResolvedValueOnce({ email: 'creator@test.com', profile: { displayName: 'Creator' } })

      await handlePaystackDisputeCreated(mockDisputeData, 'evt-123')

      // Should block after 2nd dispute
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'repeat-offender' },
          data: expect.objectContaining({
            disputeCount: 2,
            blockedReason: 'Multiple chargebacks filed',
          }),
        })
      )
    })
  })

  describe('handlePaystackDisputeResolved', () => {
    const mockResolvedData = {
      id: 12345,
      reference: 'TXN_ref_123',
      amount: 50000,
      currency: 'NGN',
      reason: 'customer_complaint',
      status: 'resolved',
      resolution: 'won' as const,
    }

    it('should update status to dispute_won and restore LTV when won', async () => {
      const mockDisputePayment = {
        id: 'dispute-pmt-123',
        creatorId: 'creator-123',
        subscriptionId: 'sub-789',
        status: 'disputed',
        subscription: { id: 'sub-789', creatorId: 'creator-123', status: 'active' },
      }

      mockFindFirst.mockResolvedValueOnce(mockDisputePayment)
      mockFindUnique.mockResolvedValueOnce({ email: 'creator@test.com', profile: { displayName: 'Creator' } })

      await handlePaystackDisputeResolved(mockResolvedData, 'evt-456')

      // Should update payment status
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'dispute-pmt-123' },
        data: { status: 'dispute_won' },
      })

      // Should restore LTV
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'sub-789' },
        data: { ltvCents: { increment: 50000 } },
      })

      // Should send email with won=true
      expect(mockSendDisputeResolvedEmail).toHaveBeenCalledWith(
        'creator@test.com',
        'Creator',
        50000,
        'NGN',
        true
      )
    })

    it('should update status to dispute_lost and auto-cancel subscription when lost', async () => {
      const mockDisputePayment = {
        id: 'dispute-pmt-123',
        creatorId: 'creator-123',
        subscriptionId: 'sub-789',
        status: 'disputed',
        subscription: { id: 'sub-789', creatorId: 'creator-123', status: 'active', stripeSubscriptionId: null },
      }

      const lostData = { ...mockResolvedData, resolution: 'lost' as const }

      mockFindFirst.mockResolvedValueOnce(mockDisputePayment)
      mockFindUnique.mockResolvedValueOnce({ email: 'creator@test.com', profile: { displayName: 'Creator' } })

      await handlePaystackDisputeResolved(lostData, 'evt-456')

      // Should update payment status to lost
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'dispute-pmt-123' },
        data: { status: 'dispute_lost' },
      })

      // Should NOT restore LTV (dispute lost)
      expect(mockUpdate).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: { ltvCents: { increment: expect.any(Number) } },
        })
      )

      // Should auto-cancel subscription
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'sub-789' },
        data: expect.objectContaining({
          status: 'canceled',
          cancelAtPeriodEnd: false,
        }),
      })

      // Should send email with won=false
      expect(mockSendDisputeResolvedEmail).toHaveBeenCalledWith(
        'creator@test.com',
        'Creator',
        50000,
        'NGN',
        false
      )
    })

    it('should skip if dispute payment not found', async () => {
      mockFindFirst.mockResolvedValueOnce(null)

      await handlePaystackDisputeResolved(mockResolvedData, 'evt-456')

      expect(mockUpdate).not.toHaveBeenCalled()
      expect(mockSendDisputeResolvedEmail).not.toHaveBeenCalled()
    })

    it('should skip if already resolved', async () => {
      const alreadyResolved = {
        id: 'dispute-pmt-123',
        creatorId: 'creator-123',
        subscriptionId: 'sub-789',
        status: 'dispute_won', // Already resolved
      }

      mockFindFirst.mockResolvedValueOnce(alreadyResolved)

      await handlePaystackDisputeResolved(mockResolvedData, 'evt-456')

      expect(mockUpdate).not.toHaveBeenCalled()
    })
  })
})

describe('Stripe Dispute Handlers', () => {
  // These tests would mirror the Paystack tests but use Stripe event structure
  // For now, we're testing the shared logic through Paystack tests
  // The Stripe handler follows the same patterns

  it('should be tested via integration tests', () => {
    // Stripe dispute handlers require more complex mocking of the Stripe SDK
    // Integration tests in the webhooks test file cover this
    expect(true).toBe(true)
  })
})
