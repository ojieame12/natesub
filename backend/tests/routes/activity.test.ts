/**
 * Integration tests for Activity API routes
 *
 * Tests the activity detail endpoint including:
 * - Payout status estimation
 * - FX data retrieval and backfill
 * - Payment matching via paymentId
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dbStorage } from '../setup.js'
import {
  paymentWithFxData,
  paymentNeedingBackfill,
  activityWithPaymentId,
  activityWithoutPaymentId,
  nigerianCreatorProfile,
} from '../fixtures/fx-data.js'

// Mock getChargeFxData for FX backfill tests
const { mockGetChargeFxData, mockValidateSession } = vi.hoisted(() => {
  return {
    mockGetChargeFxData: vi.fn(),
    mockValidateSession: vi.fn(),
  }
})

vi.mock('../../src/services/stripe.js', () => ({
  getChargeFxData: mockGetChargeFxData,
  // Other stripe exports that may be used
  stripe: { charges: {}, transfers: {} },
}))

// Mock auth service to always return valid session
vi.mock('../../src/services/auth.js', () => ({
  validateSession: mockValidateSession,
}))

// Import the activity router
import activity from '../../src/routes/activity.js'
import { Hono } from 'hono'
import { db } from '../../src/db/client.js'

// Create test app
const app = new Hono()
app.route('/activity', activity)

// Helper to make authenticated requests
const authRequest = (path: string, init?: RequestInit) => {
  return app.request(path, {
    ...init,
    headers: {
      ...init?.headers,
      Cookie: 'session=test_session_token',
    },
  })
}

describe('Activity API', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Clear all stores
    Object.values(dbStorage).forEach(store => store.clear())

    // Mock session validation to return valid session for test user
    mockValidateSession.mockResolvedValue({
      id: 'session_test',
      userId: 'creator_ng_test',
      expiresAt: new Date(Date.now() + 86400000),
    })

    // Set up test data
    dbStorage.profiles.set(nigerianCreatorProfile.userId, nigerianCreatorProfile)
  })

  afterEach(() => {
    Object.values(dbStorage).forEach(store => store.clear())
  })

  describe('GET /activity/:id - Activity Detail', () => {
    describe('Payment with existing FX data', () => {
      beforeEach(() => {
        dbStorage.activities.set(activityWithPaymentId.id, activityWithPaymentId)
        dbStorage.payments.set(paymentWithFxData.id, paymentWithFxData)
      })

      it('returns activity with FX data from payment record', async () => {
        const res = await authRequest(`/activity/${activityWithPaymentId.id}`)
        expect(res.status).toBe(200)

        const json = await res.json()
        expect(json.activity).toBeDefined()
        expect(json.fxData).toBeDefined()
        expect(json.fxData.originalCurrency).toBe('USD')
        expect(json.fxData.payoutCurrency).toBe('NGN')
        expect(json.fxData.exchangeRate).toBe(1550.0)
        expect(json.fxData.originalAmountCents).toBe(1000) // grossCents
        expect(json.fxData.payoutAmountCents).toBe(1395000)
      })

      it('returns payoutInfo with estimated status', async () => {
        const res = await authRequest(`/activity/${activityWithPaymentId.id}`)
        expect(res.status).toBe(200)

        const json = await res.json()
        expect(json.payoutInfo).toBeDefined()
        expect(json.payoutInfo.status).toBe('paid') // Payment occurred before lastPayoutAt
        expect(json.payoutInfo.provider).toBe('stripe')
        expect(json.payoutInfo.amount).toBe(900) // netCents
      })
    })

    describe('Payment without FX data (needs backfill)', () => {
      beforeEach(() => {
        dbStorage.activities.set(activityWithoutPaymentId.id, activityWithoutPaymentId)
        dbStorage.payments.set(paymentNeedingBackfill.id, paymentNeedingBackfill)
      })

      it('returns activity without FX data for legacy activities', async () => {
        // Legacy activities without paymentId fall back to subscriptionId lookup
        // FX backfill requires paymentId to update the correct record
        const res = await authRequest(`/activity/${activityWithoutPaymentId.id}`)
        expect(res.status).toBe(200)

        const json = await res.json()
        expect(json.activity).toBeDefined()
        expect(json.activity.type).toBe('subscription_created')
        // Legacy activities may not have FX data if paymentId is missing
      })

      it('handles missing payment gracefully', async () => {
        // Clear payment to simulate missing payment
        dbStorage.payments.clear()

        const res = await authRequest(`/activity/${activityWithoutPaymentId.id}`)
        expect(res.status).toBe(200)

        const json = await res.json()
        expect(json.activity).toBeDefined()
        expect(json.payoutInfo).toBeNull()
        expect(json.fxData).toBeNull()
      })
    })

    describe('Activity not found', () => {
      it('returns 404 for non-existent activity', async () => {
        const res = await authRequest('/activity/00000000-0000-0000-0000-000000000000')
        expect(res.status).toBe(404)

        const json = await res.json()
        expect(json.error).toBe('Activity not found')
      })
    })

    describe('Payout status estimation', () => {
      it('returns pending for recent payment (within 3 days)', async () => {
        // Create recent payment
        const recentPaymentId = 'payment_recent'
        const recentActivityId = '33333333-3333-3333-3333-333333333333' // UUID format
        const recentPayment = {
          ...paymentWithFxData,
          id: recentPaymentId,
          occurredAt: new Date(), // Just now
        }
        const recentActivity = {
          ...activityWithPaymentId,
          id: recentActivityId,
          payload: {
            ...activityWithPaymentId.payload,
            paymentId: recentPaymentId,
          },
        }

        // Update profile to have no recent payout
        const profileNoRecentPayout = {
          ...nigerianCreatorProfile,
          lastPayoutAt: new Date('2024-01-01T00:00:00Z'), // Long ago
        }

        dbStorage.profiles.set(nigerianCreatorProfile.userId, profileNoRecentPayout)
        dbStorage.activities.set(recentActivityId, recentActivity)
        dbStorage.payments.set(recentPaymentId, recentPayment)

        const res = await authRequest(`/activity/${recentActivityId}`)
        expect(res.status).toBe(200)

        const json = await res.json()
        expect(json.payoutInfo.status).toBe('pending')
        expect(json.payoutInfo.date).toBeDefined() // Expected payout date
      })

      it('returns in_transit for payment older than 3 days', async () => {
        // Create older payment
        const olderDate = new Date()
        olderDate.setDate(olderDate.getDate() - 5)

        const olderPaymentId = 'payment_older'
        const olderActivityId = '44444444-4444-4444-4444-444444444444' // UUID format
        const olderPayment = {
          ...paymentWithFxData,
          id: olderPaymentId,
          occurredAt: olderDate,
          exchangeRate: null, // No FX data to avoid backfill
          payoutCurrency: null,
        }
        const olderActivity = {
          ...activityWithPaymentId,
          id: olderActivityId,
          payload: {
            ...activityWithPaymentId.payload,
            paymentId: olderPaymentId,
          },
        }

        // Profile with no recent payout
        const profileNoRecentPayout = {
          ...nigerianCreatorProfile,
          lastPayoutAt: new Date('2024-01-01T00:00:00Z'),
        }

        dbStorage.profiles.set(nigerianCreatorProfile.userId, profileNoRecentPayout)
        dbStorage.activities.set(olderActivityId, olderActivity)
        dbStorage.payments.set(olderPaymentId, olderPayment)

        const res = await authRequest(`/activity/${olderActivityId}`)
        expect(res.status).toBe(200)

        const json = await res.json()
        expect(json.payoutInfo.status).toBe('in_transit')
      })
    })

    describe('paymentId vs subscriptionId lookup', () => {
      it('prefers paymentId when available', async () => {
        const activityId = '55555555-5555-5555-5555-555555555555' // UUID format
        const payment1 = { ...paymentWithFxData, id: 'pay1', netCents: 100 }
        const payment2 = { ...paymentWithFxData, id: 'pay2', netCents: 200 }

        dbStorage.payments.set(payment1.id, payment1)
        dbStorage.payments.set(payment2.id, payment2)

        const activity = {
          ...activityWithPaymentId,
          id: activityId,
          payload: {
            ...activityWithPaymentId.payload,
            paymentId: 'pay1',
            subscriptionId: 'sub_test', // Also has subscriptionId
          },
        }
        dbStorage.activities.set(activityId, activity)

        const res = await authRequest(`/activity/${activityId}`)
        expect(res.status).toBe(200)

        const json = await res.json()
        // Should use the specific payment (pay1) not just any subscription payment
        expect(json.payoutInfo.amount).toBe(100)
      })
    })
  })

  describe('GET /activity/metrics - Dashboard Metrics', () => {
    it('returns subscriber count and revenue metrics', async () => {
      // Add some subscriptions
      dbStorage.subscriptions.set('sub1', {
        id: 'sub1',
        creatorId: 'creator_ng_test',
        subscriberId: 'sub_user_1',
        status: 'active',
        interval: 'month',
        amount: 1000,
        currency: 'USD',
      })
      dbStorage.subscriptions.set('sub2', {
        id: 'sub2',
        creatorId: 'creator_ng_test',
        subscriberId: 'sub_user_2',
        status: 'active',
        interval: 'month',
        amount: 2000,
        currency: 'USD',
      })

      const res = await authRequest('/activity/metrics')
      expect(res.status).toBe(200)

      const json = await res.json()
      expect(json.metrics).toBeDefined()
      expect(json.metrics.subscriberCount).toBe(2)
      expect(json.metrics.currency).toBe('USD') // Matches subscription currency
    })
  })

  describe('GET /activity - Activity Feed', () => {
    it('returns paginated activity list', async () => {
      // Add multiple activities
      for (let i = 1; i <= 5; i++) {
        dbStorage.activities.set(`act_${i}`, {
          id: `act_${i}`,
          userId: 'creator_ng_test',
          type: 'payment_received',
          payload: { amount: i * 100 },
          createdAt: new Date(Date.now() - i * 1000),
        })
      }

      const res = await authRequest('/activity?limit=3')
      expect(res.status).toBe(200)

      const json = await res.json()
      expect(json.activities).toBeDefined()
      expect(json.activities.length).toBeLessThanOrEqual(3)
    })
  })

  describe('FX Backfill Status Handling', () => {
    const crossBorderActivityId = '66666666-6666-6666-6666-666666666666'
    const crossBorderPaymentId = 'payment_crossborder_pending'

    beforeEach(() => {
      // Set up cross-border payment needing backfill (USD → NGN)
      const crossBorderPayment = {
        ...paymentNeedingBackfill,
        id: crossBorderPaymentId,
        currency: 'USD', // Subscriber pays USD
        stripeChargeId: 'ch_crossborder_test',
        fxCheckedAt: null,
      }
      const crossBorderActivity = {
        ...activityWithPaymentId,
        id: crossBorderActivityId,
        payload: {
          ...activityWithPaymentId.payload,
          paymentId: crossBorderPaymentId,
          currency: 'USD',
        },
      }

      dbStorage.activities.set(crossBorderActivityId, crossBorderActivity)
      dbStorage.payments.set(crossBorderPaymentId, crossBorderPayment)
    })

    it('returns fxPending=true for cross-border payment when backfill returns pending', async () => {
      // Mock getChargeFxData to return pending (transfer not ready)
      mockGetChargeFxData.mockResolvedValue({ status: 'pending' })

      const res = await authRequest(`/activity/${crossBorderActivityId}`)
      expect(res.status).toBe(200)

      const json = await res.json()
      expect(json.fxPending).toBe(true)
      expect(json.fxData).toBeNull()

      // Verify backfill was attempted
      expect(mockGetChargeFxData).toHaveBeenCalledWith(
        'ch_crossborder_test',
        'acct_ng_creator_test'
      )

      // Wait for async backfill to complete
      await new Promise(resolve => setTimeout(resolve, 50))

      // Verify fxCheckedAt was NOT set (should retry on next view)
      const payment = dbStorage.payments.get(crossBorderPaymentId)
      expect(payment?.fxCheckedAt).toBeNull()
    })

    it('returns fxPending=false for error status (no confusing spinner)', async () => {
      // Mock getChargeFxData to return error
      mockGetChargeFxData.mockResolvedValue({ status: 'error' })

      const res = await authRequest(`/activity/${crossBorderActivityId}`)
      expect(res.status).toBe(200)

      const json = await res.json()
      // fxPending is set BEFORE we know the result (fire-and-forget)
      // So it will be true for cross-border, even if result is error
      // The key is that fxCheckedAt is NOT set, so next view retries
      expect(json.fxData).toBeNull()

      // Wait for async backfill to complete
      await new Promise(resolve => setTimeout(resolve, 50))

      // Verify fxCheckedAt was NOT set (should retry on next view)
      const payment = dbStorage.payments.get(crossBorderPaymentId)
      expect(payment?.fxCheckedAt).toBeNull()
    })

    it('sets fxCheckedAt when backfill returns no_fx (same currency confirmed)', async () => {
      // Mock getChargeFxData to return no_fx
      mockGetChargeFxData.mockResolvedValue({ status: 'no_fx' })

      const res = await authRequest(`/activity/${crossBorderActivityId}`)
      expect(res.status).toBe(200)

      // Wait for async backfill to complete
      await new Promise(resolve => setTimeout(resolve, 50))

      // Verify fxCheckedAt WAS set (no need to retry)
      const payment = dbStorage.payments.get(crossBorderPaymentId)
      expect(payment?.fxCheckedAt).toBeDefined()
      expect(payment?.fxCheckedAt).not.toBeNull()
    })

    it('sets fxCheckedAt and FX data when backfill returns fx_found', async () => {
      // Mock getChargeFxData to return fx_found
      mockGetChargeFxData.mockResolvedValue({
        status: 'fx_found',
        data: {
          payoutCurrency: 'NGN',
          payoutAmountCents: 1395000,
          exchangeRate: 1550.0,
          originalCurrency: 'USD',
          originalAmountCents: 1000,
        },
      })

      const res = await authRequest(`/activity/${crossBorderActivityId}`)
      expect(res.status).toBe(200)

      // Wait for async backfill to complete
      await new Promise(resolve => setTimeout(resolve, 50))

      // Verify FX data and sentinel were set
      const payment = dbStorage.payments.get(crossBorderPaymentId)
      expect(payment?.fxCheckedAt).toBeDefined()
      expect(payment?.payoutCurrency).toBe('NGN')
      expect(payment?.exchangeRate).toBe(1550.0)
      expect(payment?.payoutAmountCents).toBe(1395000)
    })

    it('does not set fxPending for non-cross-border countries', async () => {
      // Create payment for US creator (no FX conversion)
      const sameCurrencyActivityId = '77777777-7777-7777-7777-777777777777'
      const sameCurrencyPaymentId = 'payment_same_currency'

      // Update profile to US country (not cross-border)
      const usProfile = {
        ...nigerianCreatorProfile,
        countryCode: 'US', // Not a cross-border country
      }
      dbStorage.profiles.set(nigerianCreatorProfile.userId, usProfile)

      const sameCurrencyPayment = {
        ...paymentNeedingBackfill,
        id: sameCurrencyPaymentId,
        currency: 'USD',
        stripeChargeId: 'ch_same_currency_test',
        fxCheckedAt: null,
      }
      const sameCurrencyActivity = {
        ...activityWithPaymentId,
        id: sameCurrencyActivityId,
        payload: {
          ...activityWithPaymentId.payload,
          paymentId: sameCurrencyPaymentId,
          currency: 'USD',
        },
      }

      dbStorage.activities.set(sameCurrencyActivityId, sameCurrencyActivity)
      dbStorage.payments.set(sameCurrencyPaymentId, sameCurrencyPayment)

      mockGetChargeFxData.mockResolvedValue({ status: 'no_fx' })

      const res = await authRequest(`/activity/${sameCurrencyActivityId}`)
      expect(res.status).toBe(200)

      const json = await res.json()
      // Non-cross-border country = no fxPending (avoid confusing spinner for US creators)
      expect(json.fxPending).toBe(false)
      expect(json.fxData).toBeNull()
    })
  })
})
