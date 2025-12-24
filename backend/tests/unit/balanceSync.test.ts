/**
 * Balance Sync Service Tests
 *
 * Tests for balance syncing from Stripe/Paystack to cached Profile fields.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { db } from '../../src/db/client'
import { redis } from '../../src/db/redis'
import {
  syncCreatorBalance,
  isBalanceStale,
  PAYOUT_STATUS,
  normalizePayoutStatus,
  type PayoutStatus,
} from '../../src/services/balanceSync'
import * as stripeService from '../../src/services/stripe'

describe('balanceSync', () => {
  const mockUserId = 'user-123'
  const mockProfileId = 'profile-123'

  beforeEach(() => {
    vi.clearAllMocks()

    // Setup mock profile
    ;(db.profile.findUnique as any).mockResolvedValue({
      id: mockProfileId,
      userId: mockUserId,
      stripeAccountId: 'acct_123',
      paymentProvider: 'stripe',
      currency: 'USD',
    })

    // Setup mock Stripe balance
    vi.spyOn(stripeService, 'getAccountBalance').mockResolvedValue({
      available: 10000,
      pending: 5000,
      currency: 'USD',
    })

    // Mock Redis
    ;(redis.get as any).mockResolvedValue(null)
    ;(redis.set as any).mockResolvedValue('OK')
    ;(redis.del as any).mockResolvedValue(1)
    ;(redis.setex as any).mockResolvedValue('OK')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('syncCreatorBalance', () => {
    it('syncs Stripe balance and updates profile', async () => {
      const result = await syncCreatorBalance(mockUserId)

      expect(result).toEqual({
        available: 10000,
        pending: 5000,
        currency: 'USD',
      })

      expect(db.profile.update).toHaveBeenCalledWith({
        where: { id: mockProfileId },
        data: expect.objectContaining({
          balanceAvailableCents: 10000,
          balancePendingCents: 5000,
          balanceCurrency: 'USD',
        }),
      })
    })

    it('returns null when no profile exists', async () => {
      ;(db.profile.findUnique as any).mockResolvedValue(null)

      const result = await syncCreatorBalance('nonexistent-user')

      expect(result).toBeNull()
      expect(db.profile.update).not.toHaveBeenCalled()
    })

    it('returns null when no payment provider configured', async () => {
      ;(db.profile.findUnique as any).mockResolvedValue({
        id: mockProfileId,
        userId: mockUserId,
        stripeAccountId: null,
        paymentProvider: null,
        currency: 'USD',
      })

      const result = await syncCreatorBalance(mockUserId)

      expect(result).toBeNull()
    })

    it('respects rate limit cooldown', async () => {
      // First call should succeed
      await syncCreatorBalance(mockUserId)

      // Simulate cooldown active
      ;(redis.get as any).mockResolvedValue('1')

      const result = await syncCreatorBalance(mockUserId)

      // Should return null without calling Stripe
      expect(result).toBeNull()
      expect(stripeService.getAccountBalance).toHaveBeenCalledTimes(1) // Only first call
    })

    it('bypasses cooldown when force=true', async () => {
      // Simulate cooldown active
      ;(redis.get as any).mockResolvedValue('1')

      const result = await syncCreatorBalance(mockUserId, true)

      expect(result).toEqual({
        available: 10000,
        pending: 5000,
        currency: 'USD',
      })
    })

    it('handles Stripe API errors gracefully', async () => {
      vi.spyOn(stripeService, 'getAccountBalance').mockRejectedValue(
        new Error('Stripe API error')
      )

      const result = await syncCreatorBalance(mockUserId, true)

      expect(result).toBeNull()
    })
  })

  describe('syncCreatorBalance - Paystack', () => {
    beforeEach(() => {
      ;(db.profile.findUnique as any).mockResolvedValue({
        id: mockProfileId,
        userId: mockUserId,
        stripeAccountId: null,
        paymentProvider: 'paystack',
        currency: 'NGN',
      })

      // Mock payment aggregate for Paystack
      ;(db.payment.aggregate as any).mockResolvedValue({
        _sum: { netCents: 50000 },
      })
    })

    it('estimates Paystack pending balance from recent payments', async () => {
      const result = await syncCreatorBalance(mockUserId, true)

      expect(result).toEqual({
        available: 0,
        pending: 50000,
        currency: 'NGN',
      })

      expect(db.profile.update).toHaveBeenCalledWith({
        where: { id: mockProfileId },
        data: expect.objectContaining({
          balanceAvailableCents: 0,
          balancePendingCents: 50000,
          balanceCurrency: 'NGN',
        }),
      })
    })

    it('uses profile currency instead of hardcoded NGN', async () => {
      ;(db.profile.findUnique as any).mockResolvedValue({
        id: mockProfileId,
        userId: mockUserId,
        stripeAccountId: null,
        paymentProvider: 'paystack',
        currency: 'GHS', // Ghana
      })

      await syncCreatorBalance(mockUserId, true)

      expect(db.payment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            currency: 'GHS',
          }),
        })
      )

      expect(db.profile.update).toHaveBeenCalledWith({
        where: { id: mockProfileId },
        data: expect.objectContaining({
          balanceCurrency: 'GHS',
        }),
      })
    })
  })

  describe('isBalanceStale', () => {
    it('returns true when no sync timestamp', () => {
      expect(isBalanceStale(null)).toBe(true)
      expect(isBalanceStale(undefined)).toBe(true)
    })

    it('returns false for recent sync', () => {
      const recentSync = new Date(Date.now() - 1 * 60 * 1000) // 1 minute ago
      expect(isBalanceStale(recentSync)).toBe(false)
    })

    it('returns true for stale sync (default 5 min)', () => {
      const staleSync = new Date(Date.now() - 6 * 60 * 1000) // 6 minutes ago
      expect(isBalanceStale(staleSync)).toBe(true)
    })

    it('respects custom maxAge', () => {
      const sync = new Date(Date.now() - 2 * 60 * 1000) // 2 minutes ago
      expect(isBalanceStale(sync, 1 * 60 * 1000)).toBe(true) // 1 min max
      expect(isBalanceStale(sync, 5 * 60 * 1000)).toBe(false) // 5 min max
    })
  })

  describe('PAYOUT_STATUS', () => {
    it('has all expected status values', () => {
      expect(PAYOUT_STATUS.PENDING).toBe('pending')
      expect(PAYOUT_STATUS.IN_TRANSIT).toBe('in_transit')
      expect(PAYOUT_STATUS.PAID).toBe('paid')
      expect(PAYOUT_STATUS.FAILED).toBe('failed')
      expect(PAYOUT_STATUS.CANCELED).toBe('canceled')
    })
  })

  describe('normalizePayoutStatus', () => {
    it('normalizes valid status strings', () => {
      expect(normalizePayoutStatus('pending')).toBe('pending')
      expect(normalizePayoutStatus('PAID')).toBe('paid')
      expect(normalizePayoutStatus('Failed')).toBe('failed')
    })

    it('returns null for invalid status', () => {
      expect(normalizePayoutStatus('invalid')).toBeNull()
      expect(normalizePayoutStatus('typo_status')).toBeNull()
    })

    it('returns null for empty/null input', () => {
      expect(normalizePayoutStatus(null)).toBeNull()
      expect(normalizePayoutStatus(undefined)).toBeNull()
      expect(normalizePayoutStatus('')).toBeNull()
    })
  })
})
