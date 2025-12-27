import { beforeEach, describe, expect, it, vi, afterAll } from 'vitest'
import app from '../../src/app.js'
import { db } from '../../src/db/client.js'
import { dbStorage } from '../setup.js'

// Mock email service
vi.mock('../../src/services/email.js', () => ({
  sendMagicLinkEmail: vi.fn(),
  sendWelcomeEmail: vi.fn(),
  sendNewSubscriberEmail: vi.fn(),
  sendSubscriptionConfirmationEmail: vi.fn(),
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

  describe('checkout.session.async_payment_succeeded', () => {
    it('creates one-time subscription with basePrice as amount and netCents as LTV', async () => {
      // Regression test: async one-time payments must store creator's base price
      // (not net amount) in subscription.amount for consistent tier display
      const creator = await db.user.create({
        data: { email: 'asynccreator@test.com' },
      })

      await db.profile.create({
        data: {
          userId: creator.id,
          username: 'asynccreator',
          displayName: 'Async Creator',
          country: 'NG',
          countryCode: 'NG',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 10000, // $100 base price
        },
      })

      // Simulate async payment (e.g., bank transfer) succeeding
      // Base: $100, Subscriber pays: $104 (with 4% fee), Creator nets: $96
      const event = {
        id: 'evt_async_payment_succeeded_1',
        type: 'checkout.session.async_payment_succeeded',
        data: {
          object: {
            id: 'cs_async_test',
            mode: 'payment', // One-time, not subscription
            payment_status: 'paid',
            amount_total: 10400, // $104.00 gross (base + subscriber fee)
            currency: 'usd',
            customer: 'cus_async_subscriber',
            customer_details: {
              email: 'asyncsubscriber@test.com',
              name: 'Async Subscriber',
            },
            metadata: {
              creatorId: creator.id,
              feeModel: 'split_v1',
              serviceFee: '800',        // 8% total fee
              netAmount: '9600',        // $96 - what creator receives
              subscriberFeeCents: '400',
              creatorFeeCents: '400',
              baseAmountCents: '10000', // $100 - creator's set price
            },
          },
        },
      }

      const res = await sendWebhook(event)
      expect(res.status).toBe(200)

      // Verify subscription was created with correct amounts
      const subscriptions = await db.subscription.findMany({
        where: { creatorId: creator.id },
      })
      expect(subscriptions.length).toBe(1)
      expect(subscriptions[0].interval).toBe('one_time')
      // CRITICAL: amount should be basePrice ($100), not netCents ($96)
      expect(subscriptions[0].amount).toBe(10000) // Base price for tier display
      // LTV should be netCents (actual creator earnings)
      expect(subscriptions[0].ltvCents).toBe(9600)

      // Verify payment was created with correct fee breakdown
      const payments = await db.payment.findMany({
        where: { stripeEventId: 'evt_async_payment_succeeded_1' },
      })
      expect(payments.length).toBe(1)
      expect(payments[0].grossCents).toBe(10400)
      expect(payments[0].netCents).toBe(9600)
      expect(payments[0].feeCents).toBe(800)
      expect(payments[0].subscriberFeeCents).toBe(400)
      expect(payments[0].creatorFeeCents).toBe(400)
    })

    it('falls back gracefully when baseAmountCents is missing', async () => {
      // Test the fallback chain: baseAmountCents → grossCents → netCents
      const creator = await db.user.create({
        data: { email: 'legacyasynccreator@test.com' },
      })

      await db.profile.create({
        data: {
          userId: creator.id,
          username: 'legacyasynccreator',
          displayName: 'Legacy Async Creator',
          country: 'US',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 5000,
        },
      })

      // Simulate older checkout without baseAmountCents in metadata
      const event = {
        id: 'evt_async_legacy_fallback',
        type: 'checkout.session.async_payment_succeeded',
        data: {
          object: {
            id: 'cs_async_legacy',
            mode: 'payment',
            payment_status: 'paid',
            amount_total: 5400, // $54 gross
            currency: 'usd',
            customer: 'cus_legacy_async',
            customer_details: {
              email: 'legacyasync@test.com',
              name: 'Legacy Async',
            },
            metadata: {
              creatorId: creator.id,
              feeModel: 'split_v1',
              serviceFee: '432',
              netAmount: '4968',
              subscriberFeeCents: '216',
              creatorFeeCents: '216',
              // NOTE: baseAmountCents intentionally missing
            },
          },
        },
      }

      const res = await sendWebhook(event)
      expect(res.status).toBe(200)

      const subscriptions = await db.subscription.findMany({
        where: { creatorId: creator.id },
      })
      expect(subscriptions.length).toBe(1)
      // Fallback: should use grossCents (5400) since baseAmountCents is missing
      expect(subscriptions[0].amount).toBe(5400)
      expect(subscriptions[0].ltvCents).toBe(4968)
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

  describe('split fee model', () => {
    it('stores split fee fields in Payment from checkout.session.completed', async () => {
      const creator = await db.user.create({
        data: { email: 'creator@test.com' },
      })

      await db.profile.create({
        data: {
          userId: creator.id,
          username: 'splitcreator',
          displayName: 'Split Creator',
          country: 'US',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 10000, // $100 to avoid processor buffer
        },
      })

      // Use $100 base to avoid processor buffer complications
      // $100 + 4% = $104 gross, $100 - 4% = $96 net
      const event = {
        id: 'evt_split_checkout',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_split_test',
            mode: 'payment',
            payment_status: 'paid',
            amount_total: 10400, // $104.00 (base + 4% subscriber fee)
            currency: 'usd',
            customer: 'cus_split_subscriber',
            customer_details: {
              email: 'splitsubscriber@test.com',
              name: 'Split Subscriber',
            },
            metadata: {
              creatorId: creator.id,
              feeModel: 'split_v1',
              serviceFee: '800', // Total platform fee (8%)
              netAmount: '9600', // What creator receives
              subscriberFeeCents: '400',
              creatorFeeCents: '400',
              baseAmountCents: '10000',
            },
          },
        },
      }

      const res = await sendWebhook(event)
      expect(res.status).toBe(200)

      // Verify payment was created with split fee fields
      const payments = await db.payment.findMany({
        where: { stripeEventId: 'evt_split_checkout' },
      })
      expect(payments.length).toBe(1)
      expect(payments[0].grossCents).toBe(10400)
      expect(payments[0].netCents).toBe(9600)
      expect(payments[0].feeCents).toBe(800) // 4% + 4% = 8%
      expect(payments[0].subscriberFeeCents).toBe(400)
      expect(payments[0].creatorFeeCents).toBe(400)
    })

    it('handles legacy subscriptions without split fee fields', async () => {
      const creator = await db.user.create({
        data: { email: 'legacycreator@test.com' },
      })

      await db.profile.create({
        data: {
          userId: creator.id,
          username: 'legacycreator',
          displayName: 'Legacy Creator',
          country: 'US',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 10000,
        },
      })

      const subscriber = await db.user.create({
        data: { email: 'legacysubscriber@test.com' },
      })

      // Create legacy subscription (no feeModel)
      // Use $100 base amount
      const subscription = await db.subscription.create({
        data: {
          creatorId: creator.id,
          subscriberId: subscriber.id,
          amount: 10000, // $100 base
          currency: 'USD',
          interval: 'month',
          status: 'active',
          stripeSubscriptionId: 'sub_legacy_renewal',
          stripeCustomerId: 'cus_legacy',
          feeModel: null, // Legacy - no fee model
          feeMode: 'pass_to_subscriber',
        },
      })

      const event = {
        id: 'evt_legacy_renewal',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'inv_legacy_123',
            subscription: 'sub_legacy_renewal',
            amount_paid: 10800, // Original price with 8% fee ($108)
            currency: 'usd',
            lines: {
              data: [{ period: { end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 } }],
            },
          },
        },
      }

      const res = await sendWebhook(event)
      expect(res.status).toBe(200)

      // Verify payment uses legacy fee calculation
      const payments = await db.payment.findMany({
        where: { subscriptionId: subscription.id },
      })
      expect(payments.length).toBe(1)
      // Legacy fee: 8% of invoice.amount_paid + 30¢ buffer
      // Note: Legacy calculation uses the gross amount (10800), not base (10000)
      // feeCents = round(10800 * 0.08) + 30 = 864 + 30 = 894
      expect(payments[0].feeCents).toBe(894)
      // Legacy doesn't use split fields
      expect(payments[0].subscriberFeeCents).toBeNull()
      expect(payments[0].creatorFeeCents).toBeNull()
    })

    it('stores split fee fields for recurring invoice.paid with feeModel', async () => {
      const creator = await db.user.create({
        data: { email: 'renewalcreator@test.com' },
      })

      await db.profile.create({
        data: {
          userId: creator.id,
          username: 'renewalcreator',
          displayName: 'Renewal Creator',
          country: 'US',
          countryCode: 'US',
          currency: 'USD',
          purpose: 'tips',
          pricingModel: 'single',
          singleAmount: 10000,
        },
      })

      const subscriber = await db.user.create({
        data: { email: 'renewalsubscriber@test.com' },
      })

      // Create subscription with split_v1 model using $100 base
      const subscription = await db.subscription.create({
        data: {
          creatorId: creator.id,
          subscriberId: subscriber.id,
          amount: 10000, // Creator's base price ($100)
          currency: 'USD',
          interval: 'month',
          status: 'active',
          stripeSubscriptionId: 'sub_split_renewal',
          stripeCustomerId: 'cus_split_renewal',
          feeModel: 'split_v1',
          feeMode: 'split',
        },
      })

      const event = {
        id: 'evt_split_renewal',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'inv_split_123',
            subscription: 'sub_split_renewal',
            amount_paid: 10400, // $104.00 gross
            currency: 'usd',
            application_fee_amount: 800, // 8% fee
            lines: {
              data: [{ period: { end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 } }],
            },
          },
        },
      }

      const res = await sendWebhook(event)
      expect(res.status).toBe(200)

      // Verify payment has split fee fields from fee calculation
      const payments = await db.payment.findMany({
        where: { subscriptionId: subscription.id },
      })
      expect(payments.length).toBe(1)
      expect(payments[0].feeCents).toBe(800) // 8% total
      expect(payments[0].subscriberFeeCents).toBe(400) // 4%
      expect(payments[0].creatorFeeCents).toBe(400) // 4%
      expect(payments[0].grossCents).toBe(10400)
      expect(payments[0].netCents).toBe(9600)
    })
  })
})
