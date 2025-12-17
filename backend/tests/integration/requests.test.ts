import { beforeEach, describe, expect, it, vi, afterAll } from 'vitest'
import { createHash, createHmac } from 'crypto'
import app from '../../src/app.js'
import { db } from '../../src/db/client.js'
import { dbStorage } from '../setup.js'
import { env } from '../../src/config/env.js'

// Mock email service
vi.mock('../../src/services/email.js', () => ({
  sendRequestEmail: vi.fn(),
  sendNewSubscriberEmail: vi.fn(),
}))

const mockCheckoutSession = {
  id: 'cs_test_123',
  url: 'https://checkout.stripe.com/test'
}

// Mock Stripe service
vi.mock('../../src/services/stripe.js', () => ({
  stripe: {
    webhooks: {
      constructEvent: vi.fn((body, sig, secret) => JSON.parse(body)),
    },
    checkout: {
      sessions: {
        retrieve: vi.fn(async () => ({ payment_status: 'paid' })),
      }
    }
  },
  createCheckoutSession: vi.fn(async () => mockCheckoutSession),
}))

// Hash function matching auth service
function hashToken(token: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex')
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
      stripeAccountId: 'acct_test123',
      payoutStatus: 'active',
    },
  })

  // Hash the session token the same way auth service does
  const rawToken = 'test-session-token'
  const hashedToken = hashToken(rawToken)

  const session = await db.session.create({
    data: {
      userId: user.id,
      token: hashedToken, // Store hashed version
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  // Store the relation reference for mock lookups
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

describe('request lifecycle', () => {
  beforeEach(() => {
    // Clear all storage before each test
    Object.values(dbStorage).forEach(store => store.clear())
  })

  afterAll(() => {
    Object.values(dbStorage).forEach(store => store.clear())
  })

  describe('create request', () => {
    it('creates a draft request', async () => {
      await createTestUserWithSession()

      const res = await authRequest('/requests', {
        method: 'POST',
        body: JSON.stringify({
          recipientName: 'John Doe',
          recipientEmail: 'john@test.com',
          relationship: 'friend',
          amountCents: 2500,
          currency: 'usd',
          isRecurring: false,
          message: 'Hey, would love your support!',
        }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.request).toBeDefined()
      expect(body.request.status).toBe('draft')
      expect(body.request.recipientName).toBe('John Doe')
    })
  })

  describe('send request', () => {
    it('sends a request via link', async () => {
      const { user } = await createTestUserWithSession()

      // Create a draft request
      const request = await db.request.create({
        data: {
          creatorId: user.id,
          recipientName: 'Jane Doe',
          recipientEmail: 'jane@test.com',
          relationship: 'friend',
          amountCents: 1500,
          currency: 'USD',
          isRecurring: false,
          status: 'draft',
        },
      })

      const res = await authRequest(`/requests/${request.id}/send`, {
        method: 'POST',
        body: JSON.stringify({ method: 'link' }),
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.requestLink).toBeDefined()

      // Verify status changed to sent
      const updated = await db.request.findUnique({ where: { id: request.id } })
      expect(updated?.status).toBe('sent')
      expect(updated?.publicTokenHash).toBeDefined()
    })
  })

  describe('accept request flow', () => {
    it('creates checkout session and sets pending_payment status', async () => {
      const { user, profile } = await createTestUserWithSession()

      // Create a sent request with token
      const publicToken = 'test-public-token-123'
      const tokenHash = createHash('sha256')
        .update(publicToken)
        .digest('hex')

      const request = await db.request.create({
        data: {
          creatorId: user.id,
          recipientName: 'Recipient',
          recipientEmail: 'recipient@test.com',
          relationship: 'friend',
          amountCents: 2000,
          currency: 'USD',
          isRecurring: false,
          status: 'sent',
          publicTokenHash: tokenHash,
          tokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      // Accept the request
      const res = await app.fetch(
        new Request(`http://localhost/requests/r/${publicToken}/accept`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'payer@test.com' }),
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.checkoutUrl).toBe(mockCheckoutSession.url)

      // Verify status changed to pending_payment
      const updated = await db.request.findUnique({ where: { id: request.id } })
      expect(updated?.status).toBe('pending_payment')
      expect(updated?.stripeCheckoutSessionId).toBe(mockCheckoutSession.id)
    })

    it('allows retry if status is pending_payment', async () => {
      const { user } = await createTestUserWithSession()

      const publicToken = 'retry-token-456'
      const tokenHash = createHash('sha256')
        .update(publicToken)
        .digest('hex')

      // Create request already in pending_payment (abandoned checkout)
      const request = await db.request.create({
        data: {
          creatorId: user.id,
          recipientName: 'Retry User',
          recipientEmail: 'retry@test.com',
          relationship: 'friend',
          amountCents: 3000,
          currency: 'USD',
          isRecurring: false,
          status: 'pending_payment',
          publicTokenHash: tokenHash,
          tokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          stripeCheckoutSessionId: 'cs_old_expired',
        },
      })

      // Should be able to retry
      const res = await app.fetch(
        new Request(`http://localhost/requests/r/${publicToken}/accept`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'retry@test.com' }),
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
    })

    it('rejects already accepted request', async () => {
      const { user } = await createTestUserWithSession()

      const publicToken = 'accepted-token-789'
      const tokenHash = createHash('sha256')
        .update(publicToken)
        .digest('hex')

      await db.request.create({
        data: {
          creatorId: user.id,
          recipientName: 'Already Accepted',
          recipientEmail: 'accepted@test.com',
          relationship: 'friend',
          amountCents: 1000,
          currency: 'USD',
          isRecurring: false,
          status: 'accepted', // Already accepted
          publicTokenHash: tokenHash,
          tokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      const res = await app.fetch(
        new Request(`http://localhost/requests/r/${publicToken}/accept`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@test.com' }),
        })
      )

      expect(res.status).toBe(410) // Gone
      const body = await res.json()
      expect(body.error).toContain('already been responded to')
    })
  })

  describe('decline request', () => {
    it('declines a sent request', async () => {
      const { user } = await createTestUserWithSession()

      const publicToken = 'decline-token'
      const tokenHash = createHash('sha256')
        .update(publicToken)
        .digest('hex')

      const request = await db.request.create({
        data: {
          creatorId: user.id,
          recipientName: 'Decliner',
          recipientEmail: 'decliner@test.com',
          relationship: 'friend',
          amountCents: 500,
          currency: 'USD',
          isRecurring: false,
          status: 'sent',
          publicTokenHash: tokenHash,
          tokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      const res = await app.fetch(
        new Request(`http://localhost/requests/r/${publicToken}/decline`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)

      const updated = await db.request.findUnique({ where: { id: request.id } })
      expect(updated?.status).toBe('declined')
      expect(updated?.respondedAt).toBeDefined()
    })
  })
})
