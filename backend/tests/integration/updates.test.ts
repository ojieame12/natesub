import { beforeEach, describe, expect, it, vi, afterAll } from 'vitest'
import { createHash } from 'crypto'
import app from '../../src/app.js'
import { db } from '../../src/db/client.js'
import { dbStorage } from '../setup.js'

// Mock email service
vi.mock('../../src/services/email.js', () => ({
  sendMagicLinkEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  sendNewSubscriberEmail: vi.fn(),
  sendRequestEmail: vi.fn(),
  sendUpdateEmail: vi.fn(),
}))

// Mock Stripe service
vi.mock('../../src/services/stripe.js', () => ({
  stripe: {
    webhooks: {
      constructEvent: vi.fn((body, sig, secret) => JSON.parse(body)),
    },
  },
  createCheckoutSession: vi.fn(),
}))

// Hash function matching auth service
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// Helper to create a test user with session
async function createTestUserWithSession() {
  const user = await db.user.create({
    data: { email: 'creator@test.com' },
  })

  const profile = await db.profile.create({
    data: {
      userId: user.id,
      username: 'testcreator',
      displayName: 'Test Creator',
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      purpose: 'tips',
      pricingModel: 'single',
      singleAmount: 1000,
    },
  })

  const rawToken = 'test-session-token'
  const hashedToken = hashToken(rawToken)

  const session = await db.session.create({
    data: {
      userId: user.id,
      token: hashedToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  dbStorage.sessions.set(session.id, { ...session, user })

  return { user, profile, session, rawToken }
}

// Helper to make authenticated request
function authRequest(path: string, options: RequestInit = {}, rawToken = 'test-session-token') {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session=${rawToken}`,
        ...options.headers,
      },
    })
  )
}

describe('updates lifecycle', () => {
  beforeEach(() => {
    Object.values(dbStorage).forEach(store => store.clear())
  })

  afterAll(() => {
    Object.values(dbStorage).forEach(store => store.clear())
  })

  describe('create update', () => {
    it('creates a draft update', async () => {
      await createTestUserWithSession()

      const res = await authRequest('/updates', {
        method: 'POST',
        body: JSON.stringify({
          title: 'My First Update',
          body: 'Hello subscribers! This is my first update.',
          audience: 'all',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.update).toBeDefined()
      expect(body.update.status).toBe('draft')
      expect(body.update.title).toBe('My First Update')
    })

    it('creates update without title', async () => {
      await createTestUserWithSession()

      const res = await authRequest('/updates', {
        method: 'POST',
        body: JSON.stringify({
          body: 'Just a quick note to my supporters.',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.update.title).toBeNull()
      expect(body.update.body).toBe('Just a quick note to my supporters.')
    })
  })

  describe('list updates', () => {
    it('returns creator updates', async () => {
      const { user } = await createTestUserWithSession()

      // Create some updates
      await db.update.create({
        data: {
          creatorId: user.id,
          body: 'Update 1',
          audience: 'all',
          status: 'sent',
        },
      })
      await db.update.create({
        data: {
          creatorId: user.id,
          body: 'Update 2',
          audience: 'all',
          status: 'draft',
        },
      })

      const res = await authRequest('/updates')

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.updates).toHaveLength(2)
    })
  })

  describe('send update', () => {
    it('sends update to subscribers', async () => {
      const { user } = await createTestUserWithSession()

      // Create subscriber
      const subscriber = await db.user.create({
        data: { email: 'subscriber@test.com' },
      })

      // Create active subscription
      await db.subscription.create({
        data: {
          creatorId: user.id,
          subscriberId: subscriber.id,
          amount: 1000,
          currency: 'USD',
          interval: 'month',
          status: 'active',
        },
      })

      // Create draft update
      const update = await db.update.create({
        data: {
          creatorId: user.id,
          title: 'Test Update',
          body: 'Hello subscribers!',
          audience: 'all',
          status: 'draft',
        },
      })

      const res = await authRequest(`/updates/${update.id}/send`, {
        method: 'POST',
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.recipientCount).toBe(1)

      // Verify update status changed
      const updated = await db.update.findUnique({ where: { id: update.id } })
      expect(updated?.status).toBe('sent')
      expect(updated?.sentAt).toBeDefined()
    })

    it('rejects sending already sent update', async () => {
      const { user } = await createTestUserWithSession()

      // Create already sent update
      const update = await db.update.create({
        data: {
          creatorId: user.id,
          body: 'Already sent',
          audience: 'all',
          status: 'sent',
          sentAt: new Date(),
        },
      })

      const res = await authRequest(`/updates/${update.id}/send`, {
        method: 'POST',
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('already been sent')
    })
  })

  describe('delete update', () => {
    it('deletes a draft update', async () => {
      const { user } = await createTestUserWithSession()

      const update = await db.update.create({
        data: {
          creatorId: user.id,
          body: 'Delete me',
          audience: 'all',
          status: 'draft',
        },
      })

      const res = await authRequest(`/updates/${update.id}`, {
        method: 'DELETE',
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
    })

    it('prevents deleting sent update', async () => {
      const { user } = await createTestUserWithSession()

      const update = await db.update.create({
        data: {
          creatorId: user.id,
          body: 'Cannot delete',
          audience: 'all',
          status: 'sent',
        },
      })

      const res = await authRequest(`/updates/${update.id}`, {
        method: 'DELETE',
      })

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('Cannot delete')
    })
  })
})
