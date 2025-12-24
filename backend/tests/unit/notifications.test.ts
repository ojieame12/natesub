import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendRenewalReminders, sendDunningEmails, sendCancellationEmails } from '../../src/jobs/notifications.js'

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

const mockSendRenewalReminderEmail = vi.fn()
const mockSendPaymentFailedEmail = vi.fn()
const mockSendSubscriptionCanceledEmail = vi.fn()

vi.mock('../../src/services/email.js', () => ({
  sendRenewalReminderEmail: (...args: any[]) => mockSendRenewalReminderEmail(...args),
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

  // DEPRECATED: sendRenewalReminders is replaced by scheduled reminders (jobs/reminders.ts)
  // These tests are skipped but kept for reference if legacy code needs to be re-enabled
  describe.skip('sendRenewalReminders (DEPRECATED)', () => {
    it('should find subscriptions expiring in 3-4 days', async () => {
      mockFindMany.mockResolvedValue([])

      await sendRenewalReminders()

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'active',
            interval: 'month',
            currentPeriodEnd: expect.objectContaining({
              gte: expect.any(Date),
              lt: expect.any(Date),
            }),
          }),
        })
      )
    })

    it('should calculate split fee amount for split_v1 subscriptions', async () => {
      const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)

      mockFindMany.mockResolvedValue([{
        id: 'sub-123',
        amount: 10000, // $100 base
        currency: 'USD',
        feeModel: 'split_v1',
        currentPeriodEnd: threeDaysFromNow,
        subscriber: { email: 'sub@example.com' },
        creator: {
          profile: {
            displayName: 'Test Creator',
            feeMode: 'split',
            purpose: 'personal',
          },
        },
      }])
      mockFindFirst.mockResolvedValue(null) // No existing log

      await sendRenewalReminders()

      // With split model: $100 + 4% = $104 (10400 cents)
      expect(mockSendRenewalReminderEmail).toHaveBeenCalledWith(
        'sub@example.com',
        'Test Creator',
        10400, // grossCents with 4% subscriber fee
        'USD',
        threeDaysFromNow
      )
    })

    it('should calculate legacy fee amount for non-split subscriptions', async () => {
      const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)

      mockFindMany.mockResolvedValue([{
        id: 'sub-456',
        amount: 10000, // $100 base
        currency: 'USD',
        feeModel: 'flat', // Legacy model
        currentPeriodEnd: threeDaysFromNow,
        subscriber: { email: 'sub@example.com' },
        creator: {
          profile: {
            displayName: 'Test Creator',
            feeMode: 'pass_to_subscriber', // Legacy: subscriber pays 8%
            purpose: 'personal',
          },
        },
      }])
      mockFindFirst.mockResolvedValue(null)

      await sendRenewalReminders()

      // Legacy pass_to_subscriber: $100 + 8% = $108 (10800 cents)
      expect(mockSendRenewalReminderEmail).toHaveBeenCalledWith(
        'sub@example.com',
        'Test Creator',
        10800,
        'USD',
        threeDaysFromNow
      )
    })

    it('should skip if reminder already sent for this period', async () => {
      const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)

      mockFindMany.mockResolvedValue([{
        id: 'sub-789',
        amount: 10000,
        currency: 'USD',
        feeModel: 'split_v1',
        currentPeriodEnd: threeDaysFromNow,
        subscriber: { email: 'sub@example.com' },
        creator: {
          profile: {
            displayName: 'Test Creator',
            feeMode: 'split',
            purpose: 'personal',
          },
        },
      }])
      mockFindFirst.mockResolvedValue({ id: 'log-123' }) // Already sent

      const result = await sendRenewalReminders()

      expect(mockSendRenewalReminderEmail).not.toHaveBeenCalled()
      expect(result.sent).toBe(0)
    })

    it('should skip if lock cannot be acquired', async () => {
      const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)

      mockFindMany.mockResolvedValue([{
        id: 'sub-locked',
        amount: 10000,
        currency: 'USD',
        feeModel: 'split_v1',
        currentPeriodEnd: threeDaysFromNow,
        subscriber: { email: 'sub@example.com' },
        creator: {
          profile: { displayName: 'Test', feeMode: 'split', purpose: 'personal' },
        },
      }])
      mockAcquireLock.mockResolvedValue(null) // Lock failed

      const result = await sendRenewalReminders()

      expect(mockSendRenewalReminderEmail).not.toHaveBeenCalled()
      expect(result.sent).toBe(0)
    })

    it('should create notification log after sending', async () => {
      const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      const periodKey = threeDaysFromNow.toISOString().slice(0, 10)

      mockFindMany.mockResolvedValue([{
        id: 'sub-log-test',
        amount: 5000,
        currency: 'USD',
        feeModel: 'split_v1',
        currentPeriodEnd: threeDaysFromNow,
        subscriber: { email: 'sub@example.com' },
        creator: {
          profile: { displayName: 'Test', feeMode: 'split', purpose: 'personal' },
        },
      }])
      mockFindFirst.mockResolvedValue(null)

      await sendRenewalReminders()

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          subscriptionId: 'sub-log-test',
          type: `renewal_reminder_${periodKey}`,
        },
      })
    })
  })

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
