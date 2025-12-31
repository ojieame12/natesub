/**
 * Admin Users Tests
 *
 * Tests for user management endpoints:
 * - GET /admin/users (with blocked/deleted status distinction)
 * - GET /admin/users/:id
 * - POST /admin/users/:id/block
 * - POST /admin/users/:id/unblock
 * - DELETE /admin/users/:id (with Stripe/Paystack cleanup)
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../../src/app.js'
import { db } from '../../../src/db/client.js'
import { resetDatabase, disconnectDatabase } from '../../helpers/db.js'
// @ts-expect-error - test mock export
import { __reset as resetRedis } from '../../../src/db/redis.js'

// Mock Stripe
const mockStripeSubscriptionsCancel = vi.fn()

vi.mock('../../../src/services/stripe.js', async () => {
  const actual = await vi.importActual('../../../src/services/stripe.js')
  return {
    ...actual,
    stripe: {
      subscriptions: {
        cancel: (...args: any[]) => mockStripeSubscriptionsCancel(...args),
      },
    },
  }
})

const adminHeaders = {
  'x-admin-api-key': 'test-admin-key-12345',
}

describe('admin users', () => {
  beforeEach(async () => {
    await resetDatabase()
    vi.clearAllMocks()
    resetRedis() // Reset rate limit counters between tests
    mockStripeSubscriptionsCancel.mockResolvedValue({ id: 'sub_canceled' })
  })

  afterAll(async () => {
    await resetDatabase()
    await disconnectDatabase()
  })

  async function createTestUsers() {
    const user1 = await db.user.create({
      data: { email: 'user1@test.com', deletedAt: null },
    })

    await db.profile.create({
      data: {
        userId: user1.id,
        username: 'user1',
        displayName: 'User One',
        country: 'Nigeria',
        currency: 'NGN',
        payoutStatus: 'active',
      },
    })

    const user2 = await db.user.create({
      data: { email: 'user2@test.com', deletedAt: null },
    })

    await db.profile.create({
      data: {
        userId: user2.id,
        username: 'user2',
        displayName: 'User Two',
        country: 'USA',
        currency: 'USD',
      },
    })

    // Blocked user (has profile, just blocked)
    const blockedUser = await db.user.create({
      data: {
        email: 'blocked@test.com',
        deletedAt: new Date(),
      },
    })

    await db.profile.create({
      data: {
        userId: blockedUser.id,
        username: 'blockeduser',
        displayName: 'Blocked User',
        country: 'USA',
        currency: 'USD',
      },
    })

    // Deleted user (no profile, anonymized email)
    const deletedUser = await db.user.create({
      data: {
        email: 'deleted_xyz123@deleted.natepay.co',
        deletedAt: new Date(),
      },
    })
    // No profile for deleted user

    // Create subscription between users
    await db.subscription.create({
      data: {
        creatorId: user1.id,
        subscriberId: user2.id,
        amount: 1000,
        currency: 'NGN',
        interval: 'month',
        status: 'active',
      },
    })

    return { user1, user2, blockedUser, deletedUser }
  }

  describe('GET /admin/users', () => {
    it('lists all users', async () => {
      await createTestUsers()

      const res = await app.fetch(
        new Request('http://localhost/admin/users', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.users).toHaveLength(4)
      expect(body.total).toBe(4)
    })

    it('returns users with nested profile data', async () => {
      await createTestUsers()

      const res = await app.fetch(
        new Request('http://localhost/admin/users', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      const userWithProfile = body.users.find((u: any) => u.profile?.username === 'user1')
      expect(userWithProfile).toBeDefined()
      expect(userWithProfile.profile.displayName).toBe('User One')
      expect(userWithProfile.status).toBe('active')
      expect(userWithProfile).toHaveProperty('revenueTotal')
      expect(body.total).toBeDefined()
      expect(body.page).toBeDefined()
      expect(body.totalPages).toBeDefined()
    })

    it('distinguishes blocked vs deleted status', async () => {
      await createTestUsers()

      const res = await app.fetch(
        new Request('http://localhost/admin/users', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      // Find blocked user (has profile)
      const blockedUser = body.users.find((u: any) => u.email === 'blocked@test.com')
      expect(blockedUser).toBeDefined()
      expect(blockedUser.status).toBe('blocked')
      expect(blockedUser.profile).not.toBeNull()

      // Find deleted user (no profile)
      const deletedUser = body.users.find((u: any) => u.email.startsWith('deleted_'))
      expect(deletedUser).toBeDefined()
      expect(deletedUser.status).toBe('deleted')
      expect(deletedUser.profile).toBeNull()
    })

    it('filters by blocked status', async () => {
      await createTestUsers()

      const res = await app.fetch(
        new Request('http://localhost/admin/users?status=blocked', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      // Should only return blocked users (not deleted)
      expect(body.users.length).toBe(1)
      expect(body.users[0].status).toBe('blocked')
      expect(body.users[0].profile).not.toBeNull()
    })

    it('filters by deleted status', async () => {
      await createTestUsers()

      const res = await app.fetch(
        new Request('http://localhost/admin/users?status=deleted', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      // Should only return deleted users (no profile)
      expect(body.users.length).toBe(1)
      expect(body.users[0].status).toBe('deleted')
      expect(body.users[0].profile).toBeNull()
    })

    it('filters by active status', async () => {
      await createTestUsers()

      const res = await app.fetch(
        new Request('http://localhost/admin/users?status=active', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      // Should return only active users
      expect(body.users.length).toBe(2)
      body.users.forEach((u: any) => {
        expect(u.status).toBe('active')
      })
    })
  })

  describe('GET /admin/users/:id', () => {
    it('returns user details with stats', async () => {
      const { user1 } = await createTestUsers()

      const res = await app.fetch(
        new Request(`http://localhost/admin/users/${user1.id}`, {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.user.email).toBe('user1@test.com')
      expect(body.user.profile.username).toBe('user1')
      expect(body.user.stats).toBeDefined()
      expect(body.user.stats).toHaveProperty('totalRevenueCents')
    })

    it('returns 404 for non-existent user', async () => {
      const res = await app.fetch(
        new Request('http://localhost/admin/users/non-existent-id', {
          method: 'GET',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(404)
    })
  })

  describe('POST /admin/users/:id/block', () => {
    it('blocks a user', async () => {
      const { user1 } = await createTestUsers()

      const res = await app.fetch(
        new Request(`http://localhost/admin/users/${user1.id}/block`, {
          method: 'POST',
          headers: {
            ...adminHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reason: 'Violation of ToS' }),
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)

      // Verify user is blocked (but profile still exists)
      const user = await db.user.findUnique({
        where: { id: user1.id },
        include: { profile: true },
      })
      expect(user?.deletedAt).not.toBeNull()
      expect(user?.profile).not.toBeNull()
    })

    it('creates activity log', async () => {
      const { user1 } = await createTestUsers()

      await app.fetch(
        new Request(`http://localhost/admin/users/${user1.id}/block`, {
          method: 'POST',
          headers: {
            ...adminHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ reason: 'Test block' }),
        })
      )

      const activity = await db.activity.findFirst({
        where: {
          userId: user1.id,
          type: 'admin_block',
        },
      })

      expect(activity).not.toBeNull()
      expect((activity?.payload as any).reason).toBe('Test block')
    })
  })

  describe('POST /admin/users/:id/unblock', () => {
    it('unblocks a user', async () => {
      const { blockedUser } = await createTestUsers()

      const res = await app.fetch(
        new Request(`http://localhost/admin/users/${blockedUser.id}/unblock`, {
          method: 'POST',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)

      // Verify user is unblocked
      const user = await db.user.findUnique({
        where: { id: blockedUser.id },
      })
      expect(user?.deletedAt).toBeNull()
    })

    it('creates activity log', async () => {
      const { blockedUser } = await createTestUsers()

      await app.fetch(
        new Request(`http://localhost/admin/users/${blockedUser.id}/unblock`, {
          method: 'POST',
          headers: adminHeaders,
        })
      )

      const activity = await db.activity.findFirst({
        where: {
          userId: blockedUser.id,
          type: 'admin_unblock',
        },
      })

      expect(activity).not.toBeNull()
    })
  })

  describe('DELETE /admin/users/:id', () => {
    it('requires confirmation', async () => {
      const { user2 } = await createTestUsers()

      const res = await app.fetch(
        new Request(`http://localhost/admin/users/${user2.id}`, {
          method: 'DELETE',
          headers: {
            ...adminHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        })
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('confirm')
    })

    it('deletes user with full cleanup', async () => {
      const user = await db.user.create({
        data: { email: 'deleteme@test.com' },
      })

      await db.profile.create({
        data: {
          userId: user.id,
          username: 'deleteme',
          displayName: 'Delete Me',
        },
      })

      const res = await app.fetch(
        new Request(`http://localhost/admin/users/${user.id}`, {
          method: 'DELETE',
          headers: {
            ...adminHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ confirm: 'DELETE' }),
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)

      // Verify soft delete with anonymization
      const deletedUser = await db.user.findUnique({
        where: { id: user.id },
        include: { profile: true },
      })
      expect(deletedUser?.deletedAt).not.toBeNull()
      expect(deletedUser?.email).toContain('deleted_')
      expect(deletedUser?.email).toContain('@deleted.natepay.co')
      // Profile should be deleted
      expect(deletedUser?.profile).toBeNull()
    })

    it('cancels Stripe subscriptions and updates local status', async () => {
      // Create user with Stripe subscription as creator
      const creator = await db.user.create({
        data: { email: 'stripe-creator@test.com' },
      })

      await db.profile.create({
        data: {
          userId: creator.id,
          username: 'stripecreator',
          displayName: 'Stripe Creator',
          paymentProvider: 'stripe',
        },
      })

      const subscriber = await db.user.create({
        data: { email: 'sub@test.com' },
      })

      const subscription = await db.subscription.create({
        data: {
          creatorId: creator.id,
          subscriberId: subscriber.id,
          amount: 1000,
          currency: 'USD',
          interval: 'month',
          status: 'active',
          stripeSubscriptionId: 'sub_stripe123',
        },
      })

      const res = await app.fetch(
        new Request(`http://localhost/admin/users/${creator.id}`, {
          method: 'DELETE',
          headers: {
            ...adminHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ confirm: 'DELETE' }),
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)

      // Verify Stripe cancel was called
      expect(mockStripeSubscriptionsCancel).toHaveBeenCalledWith('sub_stripe123')

      // Verify local subscription status is updated
      const updatedSub = await db.subscription.findUnique({
        where: { id: subscription.id },
      })
      expect(updatedSub?.status).toBe('canceled')
      expect(updatedSub?.canceledAt).not.toBeNull()
    })

    it('neutralizes Paystack subscriptions', async () => {
      // Create user with Paystack subscription as creator
      const creator = await db.user.create({
        data: { email: 'paystack-creator@test.com' },
      })

      await db.profile.create({
        data: {
          userId: creator.id,
          username: 'paystackcreator',
          displayName: 'Paystack Creator',
          paymentProvider: 'paystack',
        },
      })

      const subscriber = await db.user.create({
        data: { email: 'psub@test.com' },
      })

      const subscription = await db.subscription.create({
        data: {
          creatorId: creator.id,
          subscriberId: subscriber.id,
          amount: 50000,
          currency: 'NGN',
          interval: 'month',
          status: 'active',
          paystackAuthorizationCode: 'AUTH_xyz123',
        },
      })

      const res = await app.fetch(
        new Request(`http://localhost/admin/users/${creator.id}`, {
          method: 'DELETE',
          headers: {
            ...adminHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ confirm: 'DELETE' }),
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.details.canceledSubscriptions.paystackCreator).toBe(1)

      // Verify Paystack subscription is neutralized
      const updatedSub = await db.subscription.findUnique({
        where: { id: subscription.id },
      })
      expect(updatedSub?.status).toBe('canceled')
      expect(updatedSub?.cancelAtPeriodEnd).toBe(true)
      expect(updatedSub?.canceledAt).not.toBeNull()
      expect(updatedSub?.paystackAuthorizationCode).toBeNull()
    })

    it('handles both creator and subscriber subscriptions', async () => {
      // Create a user who is both a creator and a subscriber
      const user = await db.user.create({
        data: { email: 'both@test.com' },
      })

      await db.profile.create({
        data: {
          userId: user.id,
          username: 'bothuser',
          displayName: 'Both User',
        },
      })

      const otherCreator = await db.user.create({
        data: { email: 'other-creator@test.com' },
      })

      const otherSubscriber = await db.user.create({
        data: { email: 'other-sub@test.com' },
      })

      // User as creator (Stripe)
      const creatorSub = await db.subscription.create({
        data: {
          creatorId: user.id,
          subscriberId: otherSubscriber.id,
          amount: 1000,
          currency: 'USD',
          interval: 'month',
          status: 'active',
          stripeSubscriptionId: 'sub_as_creator',
        },
      })

      // User as subscriber (Paystack)
      const subscriberSub = await db.subscription.create({
        data: {
          creatorId: otherCreator.id,
          subscriberId: user.id,
          amount: 50000,
          currency: 'NGN',
          interval: 'month',
          status: 'active',
          paystackAuthorizationCode: 'AUTH_as_subscriber',
        },
      })

      const res = await app.fetch(
        new Request(`http://localhost/admin/users/${user.id}`, {
          method: 'DELETE',
          headers: {
            ...adminHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ confirm: 'DELETE' }),
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)

      // Verify both sides are cleaned up
      expect(body.details.canceledSubscriptions.stripeCreator).toBe(1)
      expect(body.details.canceledSubscriptions.paystackSubscriber).toBe(1)

      // Verify creator subscription (Stripe)
      const updatedCreatorSub = await db.subscription.findUnique({
        where: { id: creatorSub.id },
      })
      expect(updatedCreatorSub?.status).toBe('canceled')
      expect(mockStripeSubscriptionsCancel).toHaveBeenCalledWith('sub_as_creator')

      // Verify subscriber subscription (Paystack)
      const updatedSubscriberSub = await db.subscription.findUnique({
        where: { id: subscriberSub.id },
      })
      expect(updatedSubscriberSub?.status).toBe('canceled')
      expect(updatedSubscriberSub?.paystackAuthorizationCode).toBeNull()
    })

    it('creates activity log with deletion details', async () => {
      const user = await db.user.create({
        data: { email: 'logtest@test.com' },
      })

      await db.profile.create({
        data: {
          userId: user.id,
          username: 'logtest',
          displayName: 'Log Test',
        },
      })

      await app.fetch(
        new Request(`http://localhost/admin/users/${user.id}`, {
          method: 'DELETE',
          headers: {
            ...adminHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ confirm: 'DELETE', reason: 'Test deletion' }),
        })
      )

      const activity = await db.activity.findFirst({
        where: {
          userId: user.id,
          type: 'admin_delete',
        },
      })

      expect(activity).not.toBeNull()
      const payload = activity?.payload as any
      expect(payload.reason).toBe('Test deletion')
      expect(payload.originalEmail).toBe('logtest@test.com')
      expect(payload.canceledSubscriptions).toBeDefined()
    })

    it('returns 404 for non-existent user', async () => {
      const res = await app.fetch(
        new Request('http://localhost/admin/users/non-existent-id', {
          method: 'DELETE',
          headers: {
            ...adminHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ confirm: 'DELETE' }),
        })
      )

      expect(res.status).toBe(404)
    })
  })
})
