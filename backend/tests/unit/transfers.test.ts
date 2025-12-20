import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  monitorStuckTransfers,
  getStuckTransfers,
  getTransferStats,
} from '../../src/jobs/transfers.js'

// Mock database
const mockCount = vi.fn()
const mockFindMany = vi.fn()

vi.mock('../../src/db/client.js', () => ({
  db: {
    payment: {
      count: (...args: any[]) => mockCount(...args),
      findMany: (...args: any[]) => mockFindMany(...args),
    },
  },
}))

// Mock alerts service
const mockCheckAndAlertStuckTransfers = vi.fn()
const mockSendHighFailureRateAlert = vi.fn()

vi.mock('../../src/services/alerts.js', () => ({
  checkAndAlertStuckTransfers: (...args: any[]) => mockCheckAndAlertStuckTransfers(...args),
  sendHighFailureRateAlert: (...args: any[]) => mockSendHighFailureRateAlert(...args),
}))

describe('Transfer Jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('monitorStuckTransfers', () => {
    it('should check for stuck transfers and return counts', async () => {
      mockCheckAndAlertStuckTransfers.mockResolvedValue({ stuckCount: 2, alerted: false })
      // Mock the various count calls in order
      mockCount
        .mockResolvedValueOnce(3) // failed 24h
        .mockResolvedValueOnce(5) // pending
        .mockResolvedValueOnce(10) // recent total (last hour)
        .mockResolvedValueOnce(1) // recent failed (last hour)

      const result = await monitorStuckTransfers()

      expect(mockCheckAndAlertStuckTransfers).toHaveBeenCalledWith(1) // 1 hour threshold
      expect(result).toEqual({
        stuckTransfers: 2,
        failedTransfers: 3,
        pendingTransfers: 5,
        alertsSent: 0,
      })
    })

    it('should increment alertsSent when stuck alert is sent', async () => {
      mockCheckAndAlertStuckTransfers.mockResolvedValue({ stuckCount: 5, alerted: true })
      mockCount
        .mockResolvedValueOnce(2) // failed 24h
        .mockResolvedValueOnce(3) // pending
        .mockResolvedValueOnce(4) // recent total (below threshold)
        .mockResolvedValueOnce(0) // recent failed

      const result = await monitorStuckTransfers()

      expect(result.alertsSent).toBe(1)
    })

    it('should send high failure rate alert when rate > 20% with 5+ transfers', async () => {
      mockCheckAndAlertStuckTransfers.mockResolvedValue({ stuckCount: 0, alerted: false })
      mockCount
        .mockResolvedValueOnce(10) // failed 24h
        .mockResolvedValueOnce(2) // pending
        .mockResolvedValueOnce(10) // recent total (>= 5)
        .mockResolvedValueOnce(3) // recent failed (30% failure rate)

      const result = await monitorStuckTransfers()

      expect(mockSendHighFailureRateAlert).toHaveBeenCalledWith('transfers', 3, 10, 60)
      expect(result.alertsSent).toBe(1)
    })

    it('should not send high failure rate alert when under threshold', async () => {
      mockCheckAndAlertStuckTransfers.mockResolvedValue({ stuckCount: 0, alerted: false })
      mockCount
        .mockResolvedValueOnce(5) // failed 24h
        .mockResolvedValueOnce(1) // pending
        .mockResolvedValueOnce(10) // recent total
        .mockResolvedValueOnce(1) // recent failed (10% - below 20%)

      const result = await monitorStuckTransfers()

      expect(mockSendHighFailureRateAlert).not.toHaveBeenCalled()
      expect(result.alertsSent).toBe(0)
    })

    it('should not alert on high failure rate with fewer than 5 transfers', async () => {
      mockCheckAndAlertStuckTransfers.mockResolvedValue({ stuckCount: 0, alerted: false })
      mockCount
        .mockResolvedValueOnce(3) // failed 24h
        .mockResolvedValueOnce(0) // pending
        .mockResolvedValueOnce(4) // recent total (< 5)
        .mockResolvedValueOnce(2) // recent failed (50% but too few)

      const result = await monitorStuckTransfers()

      expect(mockSendHighFailureRateAlert).not.toHaveBeenCalled()
      expect(result.alertsSent).toBe(0)
    })

    it('should count both stuck alert and failure rate alert', async () => {
      mockCheckAndAlertStuckTransfers.mockResolvedValue({ stuckCount: 3, alerted: true })
      mockCount
        .mockResolvedValueOnce(8) // failed 24h
        .mockResolvedValueOnce(4) // pending
        .mockResolvedValueOnce(6) // recent total
        .mockResolvedValueOnce(3) // recent failed (50%)

      const result = await monitorStuckTransfers()

      expect(mockSendHighFailureRateAlert).toHaveBeenCalled()
      expect(result.alertsSent).toBe(2) // Both alerts sent
    })
  })

  describe('getStuckTransfers', () => {
    it('should return stuck transfers without age filter', async () => {
      const mockTransfer = {
        id: 'pmt-123',
        creatorId: 'user-123',
        amountCents: 10000,
        netCents: 9200,
        currency: 'USD',
        status: 'otp_pending',
        paystackTransferCode: 'TRF_abc123',
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        subscription: {
          creator: {
            id: 'user-123',
            email: 'creator@example.com',
            profile: {
              displayName: 'Test Creator',
              username: 'testcreator',
            },
          },
        },
      }

      mockFindMany.mockResolvedValue([mockTransfer])

      const result = await getStuckTransfers()

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'otp_pending',
            type: 'payout',
          },
          orderBy: { createdAt: 'asc' },
        })
      )

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        id: 'pmt-123',
        creatorId: 'user-123',
        creatorName: 'Test Creator',
        creatorEmail: 'creator@example.com',
        amountCents: 10000,
        netCents: 9200,
        currency: 'USD',
        status: 'otp_pending',
        transferCode: 'TRF_abc123',
        createdAt: mockTransfer.createdAt,
        ageHours: 2,
      })
    })

    it('should filter by max age hours when provided', async () => {
      mockFindMany.mockResolvedValue([])

      await getStuckTransfers(3) // 3 hours

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'otp_pending',
            type: 'payout',
            createdAt: { lte: expect.any(Date) },
          },
        })
      )
    })

    it('should use username as fallback when displayName is missing', async () => {
      const mockTransfer = {
        id: 'pmt-456',
        creatorId: 'user-456',
        amountCents: 5000,
        netCents: 4600,
        currency: 'NGN',
        status: 'otp_pending',
        paystackTransferCode: 'TRF_def456',
        createdAt: new Date(),
        subscription: {
          creator: {
            id: 'user-456',
            email: 'creator2@example.com',
            profile: {
              displayName: null,
              username: 'fallbackuser',
            },
          },
        },
      }

      mockFindMany.mockResolvedValue([mockTransfer])

      const result = await getStuckTransfers()

      expect(result[0].creatorName).toBe('fallbackuser')
    })

    it('should return Unknown when no profile exists', async () => {
      const mockTransfer = {
        id: 'pmt-789',
        creatorId: 'user-789',
        amountCents: 2000,
        netCents: 1840,
        currency: 'USD',
        status: 'otp_pending',
        paystackTransferCode: null,
        createdAt: new Date(),
        subscription: {
          creator: {
            id: 'user-789',
            email: 'creator3@example.com',
            profile: null,
          },
        },
      }

      mockFindMany.mockResolvedValue([mockTransfer])

      const result = await getStuckTransfers()

      expect(result[0].creatorName).toBe('Unknown')
    })

    it('should handle missing subscription gracefully', async () => {
      const mockTransfer = {
        id: 'pmt-orphan',
        creatorId: 'user-orphan',
        amountCents: 1000,
        netCents: 920,
        currency: 'USD',
        status: 'otp_pending',
        paystackTransferCode: 'TRF_orphan',
        createdAt: new Date(),
        subscription: null,
      }

      mockFindMany.mockResolvedValue([mockTransfer])

      const result = await getStuckTransfers()

      expect(result[0].creatorName).toBe('Unknown')
      expect(result[0].creatorEmail).toBeUndefined()
    })
  })

  describe('getTransferStats', () => {
    it('should return comprehensive transfer statistics', async () => {
      mockCount
        .mockResolvedValueOnce(5) // totalPending
        .mockResolvedValueOnce(2) // totalOtpPending
        .mockResolvedValueOnce(3) // failed24h
        .mockResolvedValueOnce(47) // succeeded24h
        .mockResolvedValueOnce(1) // failed1h
        .mockResolvedValueOnce(9) // succeeded1h

      const result = await getTransferStats()

      expect(result).toEqual({
        pending: 5,
        otpPending: 2,
        last24h: {
          succeeded: 47,
          failed: 3,
          total: 50,
          failureRate: '6.0%',
        },
        last1h: {
          succeeded: 9,
          failed: 1,
          total: 10,
          failureRate: '10.0%',
        },
      })
    })

    it('should return 0% failure rate when no transfers', async () => {
      mockCount
        .mockResolvedValueOnce(0) // totalPending
        .mockResolvedValueOnce(0) // totalOtpPending
        .mockResolvedValueOnce(0) // failed24h
        .mockResolvedValueOnce(0) // succeeded24h
        .mockResolvedValueOnce(0) // failed1h
        .mockResolvedValueOnce(0) // succeeded1h

      const result = await getTransferStats()

      expect(result.last24h.failureRate).toBe('0%')
      expect(result.last1h.failureRate).toBe('0%')
    })

    it('should query correct time ranges', async () => {
      mockCount.mockResolvedValue(0)

      await getTransferStats()

      // Verify all count queries were made
      expect(mockCount).toHaveBeenCalledTimes(6)

      // Check pending queries (no date filter)
      expect(mockCount).toHaveBeenCalledWith({ where: { type: 'payout', status: 'pending' } })
      expect(mockCount).toHaveBeenCalledWith({ where: { type: 'payout', status: 'otp_pending' } })

      // Check 24h and 1h queries have date filters
      const calls = mockCount.mock.calls
      const dateFilterCalls = calls.filter(
        call => call[0]?.where?.createdAt?.gte instanceof Date
      )
      expect(dateFilterCalls.length).toBe(4) // 4 time-filtered queries
    })

    it('should calculate 100% failure rate when all transfers fail', async () => {
      mockCount
        .mockResolvedValueOnce(0) // totalPending
        .mockResolvedValueOnce(0) // totalOtpPending
        .mockResolvedValueOnce(10) // failed24h
        .mockResolvedValueOnce(0) // succeeded24h
        .mockResolvedValueOnce(5) // failed1h
        .mockResolvedValueOnce(0) // succeeded1h

      const result = await getTransferStats()

      expect(result.last24h.failureRate).toBe('100.0%')
      expect(result.last1h.failureRate).toBe('100.0%')
    })
  })
})
