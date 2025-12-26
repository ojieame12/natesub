/**
 * Admin Dashboard Tests
 *
 * Tests for dashboard endpoint:
 * - GET /admin/dashboard
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import app from '../../../src/app.js'
import { db } from '../../../src/db/client.js'
import { resetDatabase, disconnectDatabase } from '../../helpers/db.js'
// @ts-ignore - mock module
import { __reset as resetRedis } from '../../../src/db/redis.js'

const adminHeaders = {
  'x-admin-api-key': 'test-admin-key-12345',
}

describe('admin dashboard', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetRedis?.()
  })

  afterAll(async () => {
    await resetDatabase()
    await disconnectDatabase()
  })

  describe('GET /admin/dashboard', () => {
    it('returns dashboard stats with freshness metadata', async () => {
      // Create test data
      const user = await db.user.create({
        data: { email: 'test@example.com' },
      })

      await db.profile.create({
        data: {
          userId: user.id,
          username: 'testuser',
          displayName: 'Test User',
        },
      })

      const res = await app.request(
        new Request('http://localhost/admin/dashboard', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const data = await res.json()

      // Verify structure
      expect(data).toHaveProperty('users')
      expect(data).toHaveProperty('subscriptions')
      expect(data).toHaveProperty('revenue')
      expect(data).toHaveProperty('flags')
      expect(data).toHaveProperty('freshness')

      // Verify users structure
      expect(data.users).toHaveProperty('total')
      expect(data.users).toHaveProperty('newToday')
      expect(data.users).toHaveProperty('newThisMonth')
      expect(typeof data.users.total).toBe('number')

      // Verify freshness metadata
      expect(data.freshness).toHaveProperty('businessTimezone')
      expect(data.freshness).toHaveProperty('lastPaymentAt')
      expect(data.freshness).toHaveProperty('lastWebhookProcessedAt')
      expect(data.freshness).toHaveProperty('lastWebhookProvider')
      expect(data.freshness.businessTimezone).toBe('UTC')
    })

    it('includes expanded revenue metrics', async () => {
      // Create a creator with a payment
      const creator = await db.user.create({
        data: { email: 'creator@test.com' },
      })

      await db.profile.create({
        data: {
          userId: creator.id,
          username: 'creator',
          displayName: 'Creator',
        },
      })

      const subscriber = await db.user.create({
        data: { email: 'subscriber@test.com' },
      })

      // Create a subscription and payment
      const subscription = await db.subscription.create({
        data: {
          creatorId: creator.id,
          subscriberId: subscriber.id,
          status: 'active',
          amountCents: 1000,
          currency: 'USD',
        },
      })

      await db.payment.create({
        data: {
          subscriptionId: subscription.id,
          creatorId: creator.id,
          subscriberId: subscriber.id,
          type: 'recurring',
          status: 'succeeded',
          amountCents: 1000,
          grossCents: 1000,
          feeCents: 80,
          netCents: 920,
          currency: 'USD',
          occurredAt: new Date(),
        },
      })

      const res = await app.request(
        new Request('http://localhost/admin/dashboard', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const data = await res.json()

      // Verify expanded revenue metrics
      expect(data.revenue).toHaveProperty('totalCents')
      expect(data.revenue).toHaveProperty('thisMonthCents')
      expect(data.revenue).toHaveProperty('totalVolumeCents')
      expect(data.revenue).toHaveProperty('thisMonthVolumeCents')
      expect(data.revenue).toHaveProperty('paymentCount')

      // Verify values
      expect(data.revenue.totalCents).toBe(80) // Platform fee
      expect(data.revenue.totalVolumeCents).toBe(1000) // Gross amount
      expect(data.revenue.paymentCount).toBe(1)
    })

    it('reflects last payment in freshness', async () => {
      const creator = await db.user.create({
        data: { email: 'creator@test.com' },
      })

      const subscriber = await db.user.create({
        data: { email: 'subscriber@test.com' },
      })

      const subscription = await db.subscription.create({
        data: {
          creatorId: creator.id,
          subscriberId: subscriber.id,
          status: 'active',
          amountCents: 500,
          currency: 'USD',
        },
      })

      const paymentTime = new Date()
      await db.payment.create({
        data: {
          subscriptionId: subscription.id,
          creatorId: creator.id,
          subscriberId: subscriber.id,
          type: 'recurring',
          status: 'succeeded',
          amountCents: 500,
          grossCents: 500,
          feeCents: 40,
          netCents: 460,
          currency: 'USD',
          occurredAt: paymentTime,
        },
      })

      const res = await app.request(
        new Request('http://localhost/admin/dashboard', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const data = await res.json()

      // Freshness should reflect the payment
      expect(data.freshness.lastPaymentAt).not.toBeNull()
      const lastPayment = new Date(data.freshness.lastPaymentAt)
      expect(lastPayment.getTime()).toBeCloseTo(paymentTime.getTime(), -3) // Within 1 second
    })

    it('returns null freshness when no payments exist', async () => {
      const res = await app.request(
        new Request('http://localhost/admin/dashboard', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const data = await res.json()

      expect(data.freshness.lastPaymentAt).toBeNull()
      expect(data.freshness.lastWebhookProcessedAt).toBeNull()
      expect(data.freshness.lastWebhookProvider).toBeNull()
    })
  })
})
