/**
 * Admin Users Tests
 *
 * Tests for user management endpoints:
 * - GET /admin/users
 * - GET /admin/users/:id
 * - POST /admin/users/:id/block
 * - POST /admin/users/:id/unblock
 * - DELETE /admin/users/:id
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../../src/app.js'
import { db } from '../../../src/db/client.js'
import { resetDatabase, disconnectDatabase } from '../../helpers/db.js'

const adminHeaders = {
  'x-admin-api-key': 'test-admin-key-12345',
}

describe('admin users', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterAll(async () => {
    await resetDatabase()
    await disconnectDatabase()
  })

  async function createTestUsers() {
    const user1 = await db.user.create({
      data: { email: 'user1@test.com' },
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
      data: { email: 'user2@test.com' },
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

    const blockedUser = await db.user.create({
      data: {
        email: 'blocked@test.com',
        deletedAt: new Date(),
      },
    })

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

    return { user1, user2, blockedUser }
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

      expect(body.users).toHaveLength(3)
      expect(body.total).toBe(3)
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

      // Should return all 3 users
      expect(body.users.length).toBeGreaterThanOrEqual(1)
      // Users should have nested profile data
      const userWithProfile = body.users.find((u: any) => u.profile?.username === 'user1')
      expect(userWithProfile).toBeDefined()
      expect(userWithProfile.profile.displayName).toBe('User One')
      // Should have status as string
      expect(userWithProfile.status).toBe('active')
      // Should have revenueTotal
      expect(userWithProfile).toHaveProperty('revenueTotal')
      // Pagination at top level
      expect(body.total).toBeDefined()
      expect(body.page).toBeDefined()
      expect(body.totalPages).toBeDefined()
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
      // Check stats structure exists
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

      // Verify user is blocked
      const user = await db.user.findUnique({
        where: { id: user1.id },
      })
      expect(user?.deletedAt).not.toBeNull()
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

    it('deletes user with confirmation', async () => {
      // Create a user with no active subscriptions
      const user = await db.user.create({
        data: { email: 'deleteme@test.com' },
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

      // Verify soft delete
      const deletedUser = await db.user.findUnique({
        where: { id: user.id },
      })
      expect(deletedUser?.deletedAt).not.toBeNull()
    })

    it('prevents deletion of user with active subscriptions', async () => {
      const { user1 } = await createTestUsers()

      const res = await app.fetch(
        new Request(`http://localhost/admin/users/${user1.id}`, {
          method: 'DELETE',
          headers: {
            ...adminHeaders,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ confirm: 'DELETE' }),
        })
      )

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('active subscribers')
    })
  })
})
