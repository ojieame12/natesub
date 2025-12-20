import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  scheduleReminder,
  cancelReminder,
  cancelAllRemindersForEntity,
  scheduleRequestReminders,
  processDueReminders,
} from '../../src/jobs/reminders.js'

// Mock database
const mockFindUnique = vi.fn()
const mockFindMany = vi.fn()
const mockFindFirst = vi.fn()
const mockCreate = vi.fn()
const mockUpdate = vi.fn()
const mockUpdateMany = vi.fn()
const mockUpsert = vi.fn()

vi.mock('../../src/db/client.js', () => ({
  db: {
    reminder: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
      findMany: (...args: any[]) => mockFindMany(...args),
      findFirst: (...args: any[]) => mockFindFirst(...args),
      create: (...args: any[]) => mockCreate(...args),
      update: (...args: any[]) => mockUpdate(...args),
      updateMany: (...args: any[]) => mockUpdateMany(...args),
      upsert: (...args: any[]) => mockUpsert(...args),
    },
    request: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
    },
    profile: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
    },
    user: {
      findUnique: (...args: any[]) => mockFindUnique(...args),
    },
  },
}))

// Mock lock service
const mockAcquireLock = vi.fn()
const mockReleaseLock = vi.fn()

vi.mock('../../src/services/lock.js', () => ({
  acquireLock: (...args: any[]) => mockAcquireLock(...args),
  releaseLock: (...args: any[]) => mockReleaseLock(...args),
}))

// Mock email service
vi.mock('../../src/services/email.js', () => ({
  sendRequestUnopenedEmail: vi.fn().mockResolvedValue(undefined),
  sendRequestUnpaidEmail: vi.fn().mockResolvedValue(undefined),
  sendRequestExpiringEmail: vi.fn().mockResolvedValue(undefined),
  sendInvoiceDueEmail: vi.fn().mockResolvedValue(undefined),
  sendInvoiceOverdueEmail: vi.fn().mockResolvedValue(undefined),
  sendPayoutCompletedEmail: vi.fn().mockResolvedValue(undefined),
  sendPayoutFailedEmail: vi.fn().mockResolvedValue(undefined),
  sendPayrollReadyEmail: vi.fn().mockResolvedValue(undefined),
  sendOnboardingIncompleteEmail: vi.fn().mockResolvedValue(undefined),
  sendBankSetupIncompleteEmail: vi.fn().mockResolvedValue(undefined),
  sendNoSubscribersEmail: vi.fn().mockResolvedValue(undefined),
}))

// Mock SMS service
vi.mock('../../src/services/sms.js', () => ({
  isSmsEnabled: vi.fn().mockReturnValue(false),
  shouldUseSms: vi.fn().mockReturnValue(false),
  sendRequestReminderSms: vi.fn().mockResolvedValue(undefined),
  sendInvoiceDueSms: vi.fn().mockResolvedValue(undefined),
  sendInvoiceOverdueSms: vi.fn().mockResolvedValue(undefined),
  sendPayoutCompletedSms: vi.fn().mockResolvedValue(undefined),
  sendPayoutFailedSms: vi.fn().mockResolvedValue(undefined),
  sendBankSetupReminderSms: vi.fn().mockResolvedValue(undefined),
}))

// Mock encryption
vi.mock('../../src/utils/encryption.js', () => ({
  decrypt: vi.fn().mockReturnValue('decrypted-token'),
  decryptAccountNumber: vi.fn().mockReturnValue('1234567890'),
}))

// Mock system log
vi.mock('../../src/services/systemLog.js', () => ({
  logReminderSent: vi.fn(),
  logReminderFailed: vi.fn(),
}))

// Mock env
vi.mock('../../src/config/env.js', () => ({
  env: {
    PUBLIC_PAGE_URL: 'https://test.natepay.com',
  },
}))

describe('Reminder Jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAcquireLock.mockResolvedValue('lock-token-123')
    mockReleaseLock.mockResolvedValue(true)
  })

  describe('scheduleReminder', () => {
    it('should upsert a reminder with scheduled status', async () => {
      mockFindUnique.mockResolvedValue(null) // No existing reminder

      await scheduleReminder({
        userId: 'user-123',
        entityType: 'request',
        entityId: 'req-456',
        type: 'request_unopened_24h',
        scheduledFor: new Date('2025-01-01'),
      })

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            entityType_entityId_type: {
              entityType: 'request',
              entityId: 'req-456',
              type: 'request_unopened_24h',
            },
          },
          create: expect.objectContaining({
            userId: 'user-123',
            entityType: 'request',
            entityId: 'req-456',
            type: 'request_unopened_24h',
            status: 'scheduled',
          }),
        })
      )
    })

    it('should not resurrect already-sent reminders', async () => {
      mockFindUnique.mockResolvedValue({ id: 'rem-123', status: 'sent' })

      await scheduleReminder({
        userId: 'user-123',
        entityType: 'request',
        entityId: 'req-456',
        type: 'request_unopened_24h',
        scheduledFor: new Date('2025-01-01'),
      })

      expect(mockUpsert).not.toHaveBeenCalled()
    })

    it('should skip if lock cannot be acquired', async () => {
      mockAcquireLock.mockResolvedValue(null)

      await scheduleReminder({
        userId: 'user-123',
        entityType: 'request',
        entityId: 'req-456',
        type: 'request_unopened_24h',
        scheduledFor: new Date('2025-01-01'),
      })

      expect(mockUpsert).not.toHaveBeenCalled()
    })

    it('should default to email channel', async () => {
      mockFindUnique.mockResolvedValue(null)

      await scheduleReminder({
        userId: 'user-123',
        entityType: 'request',
        entityId: 'req-456',
        type: 'request_unopened_24h',
        scheduledFor: new Date('2025-01-01'),
      })

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            channel: 'email',
          }),
        })
      )
    })
  })

  describe('cancelReminder', () => {
    it('should update scheduled reminders to canceled', async () => {
      await cancelReminder({
        entityType: 'request',
        entityId: 'req-123',
        type: 'request_unopened_24h',
      })

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: {
          entityType: 'request',
          entityId: 'req-123',
          type: 'request_unopened_24h',
          status: 'scheduled',
        },
        data: {
          status: 'canceled',
        },
      })
    })
  })

  describe('cancelAllRemindersForEntity', () => {
    it('should cancel all scheduled reminders for entity', async () => {
      await cancelAllRemindersForEntity({
        entityType: 'request',
        entityId: 'req-123',
      })

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: {
          entityType: 'request',
          entityId: 'req-123',
          status: 'scheduled',
        },
        data: {
          status: 'canceled',
        },
      })
    })
  })

  describe('scheduleRequestReminders', () => {
    it('should schedule 24h, 72h, and expiry reminders', async () => {
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

      mockFindUnique.mockResolvedValue({
        id: 'req-123',
        creatorId: 'user-123',
        sendMethod: 'email',
        recipientEmail: 'recipient@example.com',
        tokenExpiresAt: expiresAt,
        dueDate: null,
        creator: { profile: {} },
      })

      await scheduleRequestReminders('req-123')

      // Should schedule 3 reminders: 24h, 72h, and expiry
      expect(mockUpsert).toHaveBeenCalledTimes(3)
    })

    it('should skip reminders for link sendMethod', async () => {
      mockFindUnique.mockResolvedValue({
        id: 'req-link',
        creatorId: 'user-123',
        sendMethod: 'link', // Share by link
        recipientEmail: 'recipient@example.com',
        creator: { profile: {} },
      })

      await scheduleRequestReminders('req-link')

      expect(mockUpsert).not.toHaveBeenCalled()
    })

    it('should schedule invoice reminders when dueDate is set', async () => {
      const dueDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000) // 10 days

      mockFindUnique.mockResolvedValue({
        id: 'req-invoice',
        creatorId: 'user-123',
        sendMethod: 'email',
        recipientEmail: 'recipient@example.com',
        tokenExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        dueDate: dueDate,
        creator: { profile: {} },
      })

      await scheduleRequestReminders('req-invoice')

      // Should schedule: 24h, 72h, expiry + invoice reminders (7d, 3d, 1d before, 1d, 7d after)
      expect(mockUpsert).toHaveBeenCalledTimes(8)
    })
  })

  describe('processDueReminders', () => {
    it('should find and process due reminders', async () => {
      mockFindMany.mockResolvedValue([])

      const result = await processDueReminders()

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'scheduled',
            scheduledFor: { lte: expect.any(Date) },
          },
          orderBy: { scheduledFor: 'asc' },
          take: 100,
        })
      )

      expect(result).toEqual({
        processed: 0,
        sent: 0,
        failed: 0,
        errors: [],
      })
    })

    it('should skip reminders locked by another worker', async () => {
      mockFindMany.mockResolvedValue([{
        id: 'rem-locked',
        userId: 'user-123',
        entityType: 'request',
        entityId: 'req-123',
        type: 'request_unopened_24h',
        channel: 'email',
      }])
      mockAcquireLock.mockResolvedValue(null) // Lock failed

      const result = await processDueReminders()

      expect(result.processed).toBe(0)
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('should mark reminder as sent after successful processing', async () => {
      const reminder = {
        id: 'rem-success',
        userId: 'user-123',
        entityType: 'profile',
        entityId: 'user-123',
        type: 'onboarding_incomplete_24h',
        channel: 'email',
        status: 'scheduled',
        retryCount: 0,
      }

      mockFindMany.mockResolvedValue([reminder])
      mockFindUnique
        .mockResolvedValueOnce(reminder) // Double-check reminder
        .mockResolvedValueOnce({ id: 'user-123', email: 'test@example.com', profile: null }) // User lookup

      const result = await processDueReminders()

      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'rem-success' },
        data: expect.objectContaining({
          status: 'sent',
        }),
      })
      expect(result.sent).toBe(1)
    })

    it('should mark as canceled when entity no longer valid', async () => {
      const reminder = {
        id: 'rem-invalid',
        userId: 'user-123',
        entityType: 'request',
        entityId: 'req-invalid',
        type: 'request_unopened_24h',
        channel: 'email',
        status: 'scheduled',
        retryCount: 0,
      }

      mockFindMany.mockResolvedValue([reminder])
      mockFindUnique
        .mockResolvedValueOnce(reminder) // Double-check reminder
        .mockResolvedValueOnce(null) // Profile lookup for notification prefs (returns null = default prefs)
        .mockResolvedValueOnce(null) // Request not found - returns false, not error

      const result = await processDueReminders()

      // When entity is invalid, reminder is canceled (not failed)
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'rem-invalid' },
        data: { status: 'canceled' },
      })
      expect(result.sent).toBe(0) // Not sent
    })

    it('should mark as canceled when entity no longer valid (max retries)', async () => {
      // Even with max retries reached, if entity is just invalid (not error),
      // status becomes 'canceled' not 'failed'
      const reminder = {
        id: 'rem-max-retry',
        userId: 'user-123',
        entityType: 'request',
        entityId: 'req-invalid',
        type: 'request_unopened_24h',
        channel: 'email',
        status: 'scheduled',
        retryCount: 2, // Already retried twice
      }

      mockFindMany.mockResolvedValue([reminder])
      mockFindUnique
        .mockResolvedValueOnce(reminder) // Double-check reminder
        .mockResolvedValueOnce(null) // Profile lookup for notification prefs
        .mockResolvedValueOnce(null) // Request not found

      await processDueReminders()

      // Invalid entity = canceled, not failed (failed requires thrown error)
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: 'rem-max-retry' },
        data: { status: 'canceled' },
      })
    })
  })
})
