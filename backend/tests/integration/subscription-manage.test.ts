/**
 * Subscription Manage Routes Tests
 *
 * Tests for the public subscription management routes:
 * - GET /subscription/manage/:token - Get subscription details
 * - POST /subscription/manage/:token/cancel - Cancel subscription
 * - GET /subscription/manage/:token/portal - Get Stripe portal URL
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import app from '../../src/app.js'
import { dbStorage } from '../setup.js'
import { generateManageToken } from '../../src/utils/cancelToken.js'

// Mock Stripe service
vi.mock('../../src/services/stripe.js', () => ({
  cancelSubscription: vi.fn(),
  createSubscriberPortalSession: vi.fn(),
}))

// Mock email service
vi.mock('../../src/services/email.js', () => ({
  sendCancellationConfirmationEmail: vi.fn().mockResolvedValue(undefined),
}))

// Mock system log service
vi.mock('../../src/services/systemLog.js', () => ({
  logSubscriptionEvent: vi.fn().mockResolvedValue(undefined),
}))

import { cancelSubscription, createSubscriberPortalSession } from '../../src/services/stripe.js'

const mockCancelSubscription = vi.mocked(cancelSubscription)
const mockCreatePortalSession = vi.mocked(createSubscriberPortalSession)

// Test data IDs
const creatorId = 'creator-manage-test-123'
const subscriberId = 'subscriber-manage-test-456'
const subscriptionId = '11111111-1111-1111-1111-111111111111'
const profileId = 'profile-manage-test-789'

describe('Subscription Manage Routes', () => {
  beforeEach(() => {
    // Clear all stores
    Object.values(dbStorage).forEach(store => store.clear())
    vi.clearAllMocks()

    // Set up test data
    dbStorage.users.set(creatorId, {
      id: creatorId,
      email: 'creator@test.com',
      role: 'user',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    dbStorage.users.set(subscriberId, {
      id: subscriberId,
      email: 'subscriber@test.com',
      role: 'user',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    dbStorage.profiles.set(profileId, {
      id: profileId,
      userId: creatorId,
      displayName: 'Test Creator',
      username: 'testcreator',
      avatarUrl: 'https://example.com/avatar.jpg',
      country: 'United States',
      currency: 'USD',
    })
  })

  describe('GET /subscription/manage/:token', () => {
    it('returns subscription details with valid token', async () => {
      // Create subscription
      dbStorage.subscriptions.set(subscriptionId, {
        id: subscriptionId,
        creatorId,
        subscriberId,
        amount: 1000,
        currency: 'USD',
        interval: 'month',
        status: 'active',
        startedAt: new Date('2024-01-01'),
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date(),
        stripeSubscriptionId: 'sub_test123',
        stripeCustomerId: 'cus_test123',
      })

      // Create payments with gross amounts
      dbStorage.payments.set('pay_1', {
        id: 'pay_1',
        subscriptionId,
        grossCents: 1100, // $11 (price + fee)
        amountCents: 1000,
        subscriberFeeCents: 100,
        currency: 'USD',
        status: 'succeeded',
        createdAt: new Date('2024-01-15'),
        type: 'recurring',
      })

      const token = generateManageToken(subscriptionId)

      const res = await app.fetch(
        new Request(`http://localhost/subscription/manage/${token}`)
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.subscription.id).toBe(subscriptionId)
      expect(body.subscription.status).toBe('active')
      expect(body.subscription.provider).toBe('stripe')
      expect(body.creator.displayName).toBe('Test Creator')
      expect(body.stats.paymentCount).toBe(1)
    })

    it('returns 400 for invalid/expired token', async () => {
      const res = await app.fetch(
        new Request('http://localhost/subscription/manage/invalid-token')
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.code).toBe('INVALID_TOKEN')
    })

    it('returns 404 for non-existent subscription', async () => {
      // Generate valid token but subscription doesn't exist
      const token = generateManageToken(subscriptionId)

      const res = await app.fetch(
        new Request(`http://localhost/subscription/manage/${token}`)
      )

      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.code).toBe('NOT_FOUND')
    })

    it('returns gross amounts (not net) in totalSupported', async () => {
      dbStorage.subscriptions.set(subscriptionId, {
        id: subscriptionId,
        creatorId,
        subscriberId,
        amount: 1000,
        currency: 'USD',
        interval: 'month',
        status: 'active',
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Create payment with grossCents (what subscriber paid)
      dbStorage.payments.set('pay_gross', {
        id: 'pay_gross',
        subscriptionId,
        grossCents: 1100, // $11.00 (price + subscriber fee)
        amountCents: 1000, // $10.00 (creator's price)
        subscriberFeeCents: 100, // $1.00 (subscriber's fee)
        currency: 'USD',
        status: 'succeeded',
        createdAt: new Date(),
        type: 'recurring',
      })

      const token = generateManageToken(subscriptionId)
      const res = await app.fetch(
        new Request(`http://localhost/subscription/manage/${token}`)
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      // Should show gross amount ($11), not net ($10)
      expect(body.stats.totalSupported).toBe(11)
    })

    it('returns gross amounts in payment history', async () => {
      dbStorage.subscriptions.set(subscriptionId, {
        id: subscriptionId,
        creatorId,
        subscriberId,
        amount: 1000,
        currency: 'USD',
        interval: 'month',
        status: 'active',
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      dbStorage.payments.set('pay_1', {
        id: 'pay_1',
        subscriptionId,
        grossCents: 1100,
        amountCents: 1000,
        subscriberFeeCents: 100,
        currency: 'USD',
        status: 'succeeded',
        createdAt: new Date(),
        type: 'recurring',
      })

      const token = generateManageToken(subscriptionId)
      const res = await app.fetch(
        new Request(`http://localhost/subscription/manage/${token}`)
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      // Payment amount should be gross ($11), not net ($10)
      expect(body.payments[0].amount).toBe(11)
    })

    it('falls back to amountCents + subscriberFeeCents when grossCents is null', async () => {
      dbStorage.subscriptions.set(subscriptionId, {
        id: subscriptionId,
        creatorId,
        subscriberId,
        amount: 1000,
        currency: 'USD',
        interval: 'month',
        status: 'active',
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Legacy payment without grossCents
      dbStorage.payments.set('pay_legacy', {
        id: 'pay_legacy',
        subscriptionId,
        grossCents: null,
        amountCents: 1000,
        subscriberFeeCents: 100,
        currency: 'USD',
        status: 'succeeded',
        createdAt: new Date(),
        type: 'recurring',
      })

      const token = generateManageToken(subscriptionId)
      const res = await app.fetch(
        new Request(`http://localhost/subscription/manage/${token}`)
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      // Should fall back to amountCents + subscriberFeeCents = $11
      expect(body.stats.totalSupported).toBe(11)
      expect(body.payments[0].amount).toBe(11)
    })

    it('limits payment history to 5 items', async () => {
      dbStorage.subscriptions.set(subscriptionId, {
        id: subscriptionId,
        creatorId,
        subscriberId,
        amount: 1000,
        currency: 'USD',
        interval: 'month',
        status: 'active',
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      // Create 10 payments
      for (let i = 0; i < 10; i++) {
        dbStorage.payments.set(`pay_${i}`, {
          id: `pay_${i}`,
          subscriptionId,
          grossCents: 1100,
          amountCents: 1000,
          subscriberFeeCents: 100,
          currency: 'USD',
          status: 'succeeded',
          createdAt: new Date(Date.now() - i * 86400000), // Each day earlier
          type: 'recurring',
        })
      }

      const token = generateManageToken(subscriptionId)
      const res = await app.fetch(
        new Request(`http://localhost/subscription/manage/${token}`)
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      // Should only return 5 payments for display
      expect(body.payments.length).toBe(5)
      // But total count should be 10
      expect(body.stats.paymentCount).toBe(10)
    })

    it('shows cancelAtPeriodEnd status correctly', async () => {
      dbStorage.subscriptions.set(subscriptionId, {
        id: subscriptionId,
        creatorId,
        subscriberId,
        amount: 1000,
        currency: 'USD',
        interval: 'month',
        status: 'active',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date(Date.now() + 7 * 86400000), // 7 days from now
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const token = generateManageToken(subscriptionId)
      const res = await app.fetch(
        new Request(`http://localhost/subscription/manage/${token}`)
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.subscription.status).toBe('active')
      expect(body.subscription.cancelAtPeriodEnd).toBe(true)
    })
  })

  describe('POST /subscription/manage/:token/cancel', () => {
    it('cancels Stripe subscription at period end', async () => {
      dbStorage.subscriptions.set(subscriptionId, {
        id: subscriptionId,
        creatorId,
        subscriberId,
        amount: 1000,
        currency: 'USD',
        interval: 'month',
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        stripeSubscriptionId: 'sub_test123',
        stripeCustomerId: 'cus_test123',
      })

      mockCancelSubscription.mockResolvedValue({
        status: 'active',
        cancelAtPeriodEnd: true,
        canceledAt: new Date(),
      })

      const token = generateManageToken(subscriptionId)
      const res = await app.fetch(
        new Request(`http://localhost/subscription/manage/${token}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'too_expensive' }),
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(mockCancelSubscription).toHaveBeenCalledWith('sub_test123', true)
    })

    it('cancels Paystack subscription locally', async () => {
      dbStorage.subscriptions.set(subscriptionId, {
        id: subscriptionId,
        creatorId,
        subscriberId,
        amount: 500000, // 5000 NGN
        currency: 'NGN',
        interval: 'month',
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        paystackSubscriptionCode: 'SUB_test123',
        // No stripeSubscriptionId - this is Paystack
      })

      const token = generateManageToken(subscriptionId)
      const res = await app.fetch(
        new Request(`http://localhost/subscription/manage/${token}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      // Should NOT call Stripe
      expect(mockCancelSubscription).not.toHaveBeenCalled()

      // Verify subscription was updated locally
      const updated = dbStorage.subscriptions.get(subscriptionId)
      expect(updated.cancelAtPeriodEnd).toBe(true)
    })

    it('returns idempotent success if already canceled', async () => {
      dbStorage.subscriptions.set(subscriptionId, {
        id: subscriptionId,
        creatorId,
        subscriberId,
        amount: 1000,
        currency: 'USD',
        interval: 'month',
        status: 'canceled',
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      const token = generateManageToken(subscriptionId)
      const res = await app.fetch(
        new Request(`http://localhost/subscription/manage/${token}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.alreadyCanceled).toBe(true)
    })

    it('records cancel feedback in activity', async () => {
      dbStorage.subscriptions.set(subscriptionId, {
        id: subscriptionId,
        creatorId,
        subscriberId,
        amount: 1000,
        currency: 'USD',
        interval: 'month',
        status: 'active',
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        stripeSubscriptionId: 'sub_test123',
      })

      mockCancelSubscription.mockResolvedValue({
        status: 'active',
        cancelAtPeriodEnd: true,
        canceledAt: new Date(),
      })

      const token = generateManageToken(subscriptionId)
      await app.fetch(
        new Request(`http://localhost/subscription/manage/${token}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'not_enough_value', comment: 'Test feedback' }),
        })
      )

      // Check activity was created
      const activities = Array.from(dbStorage.activities.values())
      const feedbackActivity = activities.find(a => a.type === 'subscription_cancel_feedback')
      expect(feedbackActivity).toBeDefined()
      expect(feedbackActivity.payload.reason).toBe('not_enough_value')
      expect(feedbackActivity.payload.comment).toBe('Test feedback')
    })

    it('returns 400 for invalid token', async () => {
      const res = await app.fetch(
        new Request('http://localhost/subscription/manage/invalid-token/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.code).toBe('INVALID_TOKEN')
    })
  })

  describe('GET /subscription/manage/:token/portal', () => {
    it('returns Stripe portal URL for Stripe customers', async () => {
      dbStorage.subscriptions.set(subscriptionId, {
        id: subscriptionId,
        creatorId,
        subscriberId,
        amount: 1000,
        currency: 'USD',
        interval: 'month',
        status: 'active',
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        stripeSubscriptionId: 'sub_test123',
        stripeCustomerId: 'cus_test123',
      })

      mockCreatePortalSession.mockResolvedValue({
        url: 'https://billing.stripe.com/session/test123',
      })

      const token = generateManageToken(subscriptionId)
      const res = await app.fetch(
        new Request(`http://localhost/subscription/manage/${token}/portal`)
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.url).toBe('https://billing.stripe.com/session/test123')
      expect(mockCreatePortalSession).toHaveBeenCalledWith(
        'cus_test123',
        expect.stringContaining('/subscription/manage/')
      )
    })

    it('returns error with resubscribe hint for Paystack', async () => {
      dbStorage.subscriptions.set(subscriptionId, {
        id: subscriptionId,
        creatorId,
        subscriberId,
        amount: 500000,
        currency: 'NGN',
        interval: 'month',
        status: 'active',
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        paystackSubscriptionCode: 'SUB_test123',
        // No stripeCustomerId - this is Paystack
      })

      const token = generateManageToken(subscriptionId)
      const res = await app.fetch(
        new Request(`http://localhost/subscription/manage/${token}/portal`)
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.code).toBe('NO_PORTAL')
      expect(body.instructions).toContain('cancel')
      expect(body.resubscribeUrl).toBeDefined()
    })

    it('returns 400 for invalid token', async () => {
      const res = await app.fetch(
        new Request('http://localhost/subscription/manage/invalid-token/portal')
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.code).toBe('INVALID_TOKEN')
    })
  })
})
