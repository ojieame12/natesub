import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendDunningEmails, sendCancellationEmails } from '../../src/jobs/notifications.js'

// Mock dependencies
const mockFindMany = vi.fn()
const mockFindFirst = vi.fn()
const mockFindUnique = vi.fn()
const mockCreate = vi.fn()

vi.mock('../../src/db/client.js', () => ({
  db: {
    subscription: {
      findMany: (...args: any[]) => mockFindMany(...args),
    },
    payment: {
      findMany: (...args: any[]) => mockFindMany(...args),
      findFirst: (...args: any[]) => mockFindFirst(...args),
    },
    notificationLog: {
      findFirst: (...args: any[]) => mockFindFirst(...args),
      findUnique: (...args: any[]) => mockFindUnique(...args),
      create: (...args: any[]) => mockCreate(...args),
    },
  },
}))

const mockSendPaymentFailedEmail = vi.fn()
const mockSendSubscriptionCanceledEmail = vi.fn()

vi.mock('../../src/services/email.js', () => ({
  sendPaymentFailedEmail: (...args: any[]) => mockSendPaymentFailedEmail(...args),
  sendSubscriptionCanceledEmail: (...args: any[]) => mockSendSubscriptionCanceledEmail(...args),
}))

const mockAcquireLock = vi.fn()
const mockReleaseLock = vi.fn()

vi.mock('../../src/services/lock.js', () => ({
  acquireLock: (...args: any[]) => mockAcquireLock(...args),
  releaseLock: (...args: any[]) => mockReleaseLock(...args),
}))

describe('Notification Jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAcquireLock.mockResolvedValue('lock-token-123')
    mockReleaseLock.mockResolvedValue(true)
  })

  // NOTE: sendRenewalReminders was removed - renewal reminders are now handled
  // via scheduleSubscriptionRenewalReminders() in jobs/reminders.ts

  describe('sendDunningEmails', () => {
    it('should find failed payments from last 24 hours', async () => {
      mockFindMany.mockResolvedValue([])

      await sendDunningEmails()

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'failed',
            type: 'recurring',
            createdAt: expect.objectContaining({
              gte: expect.any(Date),
            }),
          }),
        })
      )
    })

    it('should calculate split fee for dunning emails', async () => {
      const failedAt = new Date()

      mockFindMany.mockResolvedValue([{
        id: 'payment-123',
        createdAt: failedAt,
        subscription: {
          id: 'sub-dunning',
          amount: 5000, // $50 base
          currency: 'USD',
          feeModel: 'split_v1',
          subscriber: { email: 'sub@example.com' },
          creator: {
            profile: {
              displayName: 'Creator',
              feeMode: 'split',
              purpose: 'personal',
            },
          },
        },
      }])
      mockFindFirst.mockResolvedValue(null)

      await sendDunningEmails()

      // Split model: $50 + 4% = $52 (5200 cents)
      expect(mockSendPaymentFailedEmail).toHaveBeenCalledWith(
        'sub@example.com',
        'Creator',
        5200,
        'USD',
        expect.any(Date) // retry date
      )
    })

    it('should use payment ID for idempotency', async () => {
      mockFindMany.mockResolvedValue([{
        id: 'payment-456',
        createdAt: new Date(),
        subscription: {
          id: 'sub-idempotent',
          amount: 5000,
          currency: 'USD',
          feeModel: 'split_v1',
          subscriber: { email: 'sub@example.com' },
          creator: {
            profile: { displayName: 'Test', feeMode: 'split', purpose: 'personal' },
          },
        },
      }])
      mockFindFirst.mockResolvedValue(null)

      await sendDunningEmails()

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          subscriptionId: 'sub-idempotent',
          type: 'payment_failed_payment-456',
        },
      })
    })
  })

  describe('sendCancellationEmails', () => {
    it('should find subscriptions canceled in last 24 hours', async () => {
      mockFindMany.mockResolvedValue([])

      await sendCancellationEmails()

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'canceled',
            canceledAt: expect.objectContaining({
              gte: expect.any(Date),
            }),
          }),
        })
      )
    })

    it('should detect payment_failed reason from recent failed payments', async () => {
      mockFindMany.mockResolvedValue([{
        id: 'sub-canceled',
        canceledAt: new Date(),
        subscriber: { email: 'sub@example.com' },
        creator: {
          profile: { displayName: 'Creator' },
        },
      }])
      mockFindUnique.mockResolvedValue(null) // No existing log
      mockFindFirst.mockResolvedValue({ id: 'failed-payment' }) // Has recent failed payment

      await sendCancellationEmails()

      expect(mockSendSubscriptionCanceledEmail).toHaveBeenCalledWith(
        'sub@example.com',
        'Creator',
        'payment_failed'
      )
    })

    it('should use other reason when no recent failed payments', async () => {
      mockFindMany.mockResolvedValue([{
        id: 'sub-canceled-manual',
        canceledAt: new Date(),
        subscriber: { email: 'sub@example.com' },
        creator: {
          profile: { displayName: 'Creator' },
        },
      }])
      mockFindUnique.mockResolvedValue(null)
      mockFindFirst.mockResolvedValue(null) // No failed payments

      await sendCancellationEmails()

      expect(mockSendSubscriptionCanceledEmail).toHaveBeenCalledWith(
        'sub@example.com',
        'Creator',
        'other'
      )
    })
  })
})
