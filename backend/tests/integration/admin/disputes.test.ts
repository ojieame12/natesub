/**
 * Admin Disputes Tests
 *
 * Tests for dispute management endpoints:
 * - GET /admin/disputes/stats
 * - GET /admin/disputes
 * - GET /admin/blocked-subscribers
 * - POST /admin/blocked-subscribers/:id/unblock
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../../src/app.js'
import { db } from '../../../src/db/client.js'
import { resetDatabase, disconnectDatabase } from '../../helpers/db.js'

const adminHeaders = {
  'x-admin-api-key': 'test-admin-key-12345',
}

describe('admin disputes', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterAll(async () => {
    await resetDatabase()
    await disconnectDatabase()
  })

  async function createTestData() {
    // Create users
    const creator = await db.user.create({
      data: { email: 'creator@test.com' },
    })

    const subscriber1 = await db.user.create({
      data: {
        email: 'subscriber1@test.com',
        disputeCount: 2,
        blockedReason: 'Multiple chargebacks filed',
      },
    })

    const subscriber2 = await db.user.create({
      data: {
        email: 'subscriber2@test.com',
        disputeCount: 1,
      },
    })

    // Create profile for creator
    await db.profile.create({
      data: {
        userId: creator.id,
        username: 'testcreator',
        displayName: 'Test Creator',
      },
    })

    // Create subscriptions
    const subscription1 = await db.subscription.create({
      data: {
        creatorId: creator.id,
        subscriberId: subscriber1.id,
        amount: 1000,
        currency: 'USD',
        interval: 'month',
        status: 'canceled',
      },
    })

    const subscription2 = await db.subscription.create({
      data: {
        creatorId: creator.id,
        subscriberId: subscriber2.id,
        amount: 2000,
        currency: 'USD',
        interval: 'month',
        status: 'active',
      },
    })

    // Create dispute payments
    const disputeOpen = await db.payment.create({
      data: {
        subscriptionId: subscription2.id,
        creatorId: creator.id,
        subscriberId: subscriber2.id,
        amountCents: -5000,
        currency: 'USD',
        feeCents: 0,
        netCents: -5000,
        type: 'recurring',
        status: 'disputed',
        stripeDisputeId: 'dp_open_123',
      },
    })

    const disputeWon = await db.payment.create({
      data: {
        subscriptionId: subscription1.id,
        creatorId: creator.id,
        subscriberId: subscriber1.id,
        amountCents: -3000,
        currency: 'USD',
        feeCents: 0,
        netCents: -3000,
        type: 'recurring',
        status: 'dispute_won',
        stripeDisputeId: 'dp_won_456',
      },
    })

    const disputeLost = await db.payment.create({
      data: {
        subscriptionId: subscription1.id,
        creatorId: creator.id,
        subscriberId: subscriber1.id,
        amountCents: -2000,
        currency: 'USD',
        feeCents: 0,
        netCents: -2000,
        type: 'recurring',
        status: 'dispute_lost',
        paystackDisputeId: 'ps_lost_789',
      },
    })

    return {
      creator,
      subscriber1,
      subscriber2,
      subscription1,
      subscription2,
      disputeOpen,
      disputeWon,
      disputeLost,
    }
  }

  describe('GET /admin/disputes/stats', () => {
    it('returns dispute statistics', async () => {
      await createTestData()

      const res = await app.fetch(
        new Request('http://localhost/admin/disputes/stats', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.current).toMatchObject({
        open: 1,
        blockedSubscribers: 1,
      })

      expect(body.allTime).toMatchObject({
        total: 3,
        open: 1,
        won: 1,
        lost: 1,
      })

      expect(body.allTime.winRate).toBe('50.0%')
    })

    it('returns zero stats when no disputes exist', async () => {
      const res = await app.fetch(
        new Request('http://localhost/admin/disputes/stats', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.current.open).toBe(0)
      expect(body.allTime.total).toBe(0)
      expect(body.allTime.winRate).toBe('0%')
    })
  })

  describe('GET /admin/disputes', () => {
    it('lists all disputes', async () => {
      await createTestData()

      const res = await app.fetch(
        new Request('http://localhost/admin/disputes', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.disputes).toHaveLength(3)
      expect(body.total).toBe(3)
    })

    it('filters disputes by status', async () => {
      await createTestData()

      const res = await app.fetch(
        new Request('http://localhost/admin/disputes?status=disputed', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.disputes).toHaveLength(1)
      expect(body.disputes[0].status).toBe('disputed')
    })

    it('includes dispute details', async () => {
      await createTestData()

      const res = await app.fetch(
        new Request('http://localhost/admin/disputes?status=disputed', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      const dispute = body.disputes[0]
      expect(dispute).toHaveProperty('id')
      expect(dispute).toHaveProperty('status', 'disputed')
      expect(dispute).toHaveProperty('amountCents')
      expect(dispute).toHaveProperty('provider')
    })

    it('shows correct provider (stripe vs paystack)', async () => {
      await createTestData()

      const res = await app.fetch(
        new Request('http://localhost/admin/disputes', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      const stripeDispute = body.disputes.find((d: any) => d.stripeDisputeId)
      const paystackDispute = body.disputes.find((d: any) => d.paystackDisputeId)

      expect(stripeDispute.provider).toBe('stripe')
      expect(paystackDispute.provider).toBe('paystack')
    })

    it('paginates results', async () => {
      await createTestData()

      const res = await app.fetch(
        new Request('http://localhost/admin/disputes?limit=2&page=1', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.disputes).toHaveLength(2)
      expect(body.page).toBe(1)
      expect(body.total).toBe(3)
      expect(body.totalPages).toBe(2)
    })
  })

  describe('GET /admin/blocked-subscribers', () => {
    it('returns empty list when no blocked subscribers', async () => {
      const res = await app.fetch(
        new Request('http://localhost/admin/blocked-subscribers', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.blockedSubscribers).toHaveLength(0)
      expect(body.total).toBe(0)
    })
  })

  describe('POST /admin/blocked-subscribers/:id/unblock', () => {
    it('unblocks a subscriber', async () => {
      const data = await createTestData()

      const res = await app.fetch(
        new Request(`http://localhost/admin/blocked-subscribers/${data.subscriber1.id}/unblock`, {
          method: 'POST',
          headers: {
            ...adminHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reason: 'Customer appealed successfully' }),
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.success).toBe(true)
      expect(body.warning).toContain('multiple disputes')

      // Verify user is unblocked
      const user = await db.user.findUnique({
        where: { id: data.subscriber1.id },
      })
      expect(user?.blockedReason).toBeNull()
      expect(user?.disputeCount).toBe(2) // Count preserved for history
    })

    it('creates activity log on unblock', async () => {
      const data = await createTestData()

      await app.fetch(
        new Request(`http://localhost/admin/blocked-subscribers/${data.subscriber1.id}/unblock`, {
          method: 'POST',
          headers: {
            ...adminHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reason: 'Test unblock' }),
        })
      )

      const activity = await db.activity.findFirst({
        where: {
          userId: data.subscriber1.id,
          type: 'admin_unblock_subscriber',
        },
      })

      expect(activity).not.toBeNull()
      expect((activity?.payload as any).unblockReason).toBe('Test unblock')
      expect((activity?.payload as any).previousBlockReason).toBe('Multiple chargebacks filed')
    })

    it('returns 404 for non-existent user', async () => {
      const res = await app.fetch(
        new Request('http://localhost/admin/blocked-subscribers/non-existent-id/unblock', {
          method: 'POST',
          headers: {
            ...adminHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reason: 'Test' }),
        })
      )

      expect(res.status).toBe(404)
    })

    it('returns 400 for user not blocked', async () => {
      const data = await createTestData()

      const res = await app.fetch(
        new Request(`http://localhost/admin/blocked-subscribers/${data.subscriber2.id}/unblock`, {
          method: 'POST',
          headers: {
            ...adminHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reason: 'Test' }),
        })
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('not blocked')
    })
  })
})
