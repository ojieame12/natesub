import { beforeEach, describe, expect, it, vi, afterAll } from 'vitest'
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

// Store for controlling stripe mock behavior
let mockStripeEvent: any = null

// Mock Stripe
vi.mock('../../src/services/stripe.js', () => ({
  stripe: {
    webhooks: {
      constructEvent: vi.fn((body, sig, secret) => {
        if (!mockStripeEvent) {
          return JSON.parse(body)
        }
        return mockStripeEvent
      }),
    },
    charges: {
      retrieve: vi.fn(async () => ({ customer: 'cus_test123' })),
    },
  },
  createCheckoutSession: vi.fn(),
}))

function setMockStripeEvent(event: any) {
  mockStripeEvent = event
}

// Helper to send webhook
async function sendWebhook(event: any) {
  setMockStripeEvent(event)
  return app.fetch(
    new Request('http://localhost/webhooks/stripe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 'test-signature',
      },
      body: JSON.stringify(event),
    })
  )
}

describe('stripe webhooks', () => {
  beforeEach(() => {
    Object.values(dbStorage).forEach(store => store.clear())
    mockStripeEvent = null
  })

  afterAll(() => {
    Object.values(dbStorage).forEach(store => store.clear())
  })

  describe('checkout.session.completed', () => {
    it('creates subscription and payment on checkout completion', async () => {
      // Create creator
      const creator = await db.user.create({
        data: { email: 'creator@test.com' },
      })

      await db.profile.create({
        data: {
          userId: creator.id,
          username: 'creator',
          displayName: 'Creator',
          country: 'US',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 1000,
        },
      })

      const event = {
        id: 'evt_checkout_completed_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            mode: 'payment', // Changed from subscription to trigger immediate payment creation
            payment_status: 'paid',
            amount_total: 1000,
            currency: 'usd',
            customer: 'cus_test_subscriber',
            subscription: null, // No subscription ID for one-time payment
            customer_details: {
              email: 'subscriber@test.com',
              name: 'Test Subscriber',
            },
            metadata: {
              creatorId: creator.id,
              tierId: 'tier-1',
            },
          },
        },
      }

      const res = await sendWebhook(event)
      expect(res.status).toBe(200)

      // Verify subscription was created
      const subscriptions = await db.subscription.findMany({})
      expect(subscriptions.length).toBe(1)
      expect(subscriptions[0].creatorId).toBe(creator.id)
      expect(subscriptions[0].stripeSubscriptionId).toBeNull()

      // Verify payment was created
      const payments = await db.payment.findMany({})
      expect(payments.length).toBe(1)
      expect(payments[0].stripeEventId).toBe('evt_checkout_completed_1')
    })

    it('finalizes request on checkout completion with requestId', async () => {
      const creator = await db.user.create({
        data: { email: 'creator@test.com' },
      })

      await db.profile.create({
        data: {
          userId: creator.id,
          username: 'creator',
          displayName: 'Creator',
          country: 'US',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 1000,
        },
      })

      // Create a pending_payment request
      const request = await db.request.create({
        data: {
          creatorId: creator.id,
          recipientName: 'Payer',
          recipientEmail: 'payer@test.com',
          relationship: 'friend',
          amountCents: 2000,
          currency: 'USD',
          isRecurring: false,
          status: 'pending_payment',
          stripeCheckoutSessionId: 'cs_request_123',
        },
      })

      const event = {
        id: 'evt_checkout_request',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_request_123',
            mode: 'payment',
            payment_status: 'paid',
            amount_total: 2000,
            currency: 'usd',
            customer: 'cus_payer',
            customer_details: {
              email: 'payer@test.com',
              name: 'Payer',
            },
            metadata: {
              creatorId: creator.id,
              requestId: request.id,
            },
          },
        },
      }

      const res = await sendWebhook(event)
      expect(res.status).toBe(200)

      // Verify request was finalized
      const updated = await db.request.findUnique({ where: { id: request.id } })
      expect(updated?.status).toBe('accepted')
      expect(updated?.respondedAt).toBeDefined()

      // Verify activity was created
      const activities = await db.activity.findMany({
        where: { type: 'request_accepted' },
      })
      expect(activities.length).toBe(1)
    })
  })

  describe('checkout.session.expired', () => {
    it('reverts request to sent status on expired checkout', async () => {
      const creator = await db.user.create({
        data: { email: 'creator@test.com' },
      })

      // Create a pending_payment request
      const request = await db.request.create({
        data: {
          creatorId: creator.id,
          recipientName: 'Abandoned',
          recipientEmail: 'abandoned@test.com',
          relationship: 'friend',
          amountCents: 1500,
          currency: 'USD',
          isRecurring: false,
          status: 'pending_payment',
          stripeCheckoutSessionId: 'cs_expired_123',
        },
      })

      const event = {
        id: 'evt_expired_1',
        type: 'checkout.session.expired',
        data: {
          object: {
            id: 'cs_expired_123',
            metadata: {
              requestId: request.id,
            },
          },
        },
      }

      const res = await sendWebhook(event)
      expect(res.status).toBe(200)

      // Verify request was reverted to sent
      const updated = await db.request.findUnique({ where: { id: request.id } })
      expect(updated?.status).toBe('sent')
      expect(updated?.stripeCheckoutSessionId).toBeNull()
    })
  })

  describe('idempotency', () => {
    it('skips already processed events', async () => {
      const creator = await db.user.create({
        data: { email: 'creator@test.com' },
      })

      await db.profile.create({
        data: {
          userId: creator.id,
          username: 'creator',
          displayName: 'Creator',
          country: 'US',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 1000,
        },
      })

      // Create existing payment with this event ID (already processed)
      await db.payment.create({
        data: {
          creatorId: creator.id,
          amountCents: 1000,
          currency: 'USD',
          feeCents: 100,
          netCents: 900,
          type: 'one_time',
          status: 'succeeded',
          stripeEventId: 'evt_duplicate_test',
        },
      })

      const event = {
        id: 'evt_duplicate_test', // Same event ID
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_dup',
            mode: 'payment',
            amount_total: 1000,
            currency: 'usd',
            customer_details: { email: 'test@test.com' },
            metadata: { creatorId: creator.id },
          },
        },
      }

      const res = await sendWebhook(event)
      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.status).toBe('already_processed')

      // Should still have only 1 payment
      const payments = await db.payment.findMany({})
      expect(payments.length).toBe(1)
    })
  })

  describe('invoice.paid', () => {
    it('creates payment for recurring subscription', async () => {
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
          amount: 1000,
          currency: 'USD',
          interval: 'month',
          status: 'active',
          stripeSubscriptionId: 'sub_recurring_123',
          stripeCustomerId: 'cus_recurring',
        },
      })

      const event = {
        id: 'evt_invoice_paid_1',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'inv_123',
            subscription: 'sub_recurring_123',
            amount_paid: 1000,
            currency: 'usd',
            lines: {
              data: [{ period: { end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 } }],
            },
          },
        },
      }

      const res = await sendWebhook(event)
      expect(res.status).toBe(200)

      // Verify payment was created
      const payments = await db.payment.findMany({
        where: { subscriptionId: subscription.id },
      })
      expect(payments.length).toBe(1)
      expect(payments[0].type).toBe('recurring')
      expect(payments[0].stripeEventId).toBe('evt_invoice_paid_1')
    })
  })

  describe('customer.subscription.deleted', () => {
    it('cancels subscription', async () => {
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
          amount: 500,
          currency: 'USD',
          interval: 'month',
          status: 'active',
          stripeSubscriptionId: 'sub_to_cancel',
        },
      })

      const event = {
        id: 'evt_sub_deleted',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_to_cancel',
          },
        },
      }

      const res = await sendWebhook(event)
      expect(res.status).toBe(200)

      const updated = await db.subscription.findUnique({ where: { id: subscription.id } })
      expect(updated?.status).toBe('canceled')
      expect(updated?.canceledAt).toBeDefined()
    })
  })
})
