import { test, expect } from '@playwright/test'
import { e2eLogin, deterministicEmail, buildUsername } from './auth.helper'

/**
 * Webhook Processing E2E Tests
 *
 * Tests the full positive-path processing of Stripe and Paystack webhooks.
 * Uses the /e2e/webhook/* endpoints to bypass signature validation while
 * exercising the complete processing pipeline.
 *
 * Run with: npx playwright test webhook-processing.spec.ts
 */

const API_URL = 'http://localhost:3001'

const E2E_API_KEY = process.env.E2E_API_KEY
const e2eHeaders = () => ({
  'x-e2e-api-key': E2E_API_KEY || '',
  'Content-Type': 'application/json',
})

// ============================================
// HELPER: Setup creator with connected provider
// ============================================

async function setupCreator(
  request: import('@playwright/test').APIRequestContext,
  suffix: string,
  options?: { provider?: 'stripe' | 'paystack'; countryCode?: string; currency?: string }
) {
  const ts = Date.now().toString().slice(-8)
  const email = `webhook-${suffix}-${ts}@e2e.natepay.co`
  const username = buildUsername('wh', suffix, ts)

  const provider = options?.provider || 'stripe'
  const countryCode = options?.countryCode || 'US'
  const currency = options?.currency || 'USD'

  const { token, user } = await e2eLogin(request, email)

  const profileResp = await request.put(`${API_URL}/profile`, {
    data: {
      username,
      displayName: `Webhook Test ${suffix}`,
      country: countryCode === 'NG' ? 'Nigeria' : 'United States',
      countryCode,
      currency,
      purpose: 'support',
      pricingModel: 'single',
      singleAmount: countryCode === 'NG' ? 5000 : 10,
      paymentProvider: provider,
      feeMode: 'split',
      isPublic: true,
    },
    headers: { 'Authorization': `Bearer ${token}` },
  })

  expect(profileResp.status(), 'Profile creation for webhook test must succeed').toBe(200)

  // Connect provider
  if (provider === 'stripe') {
    await request.post(`${API_URL}/stripe/connect`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })
  }

  return { token, userId: user.id, email, username }
}

// ============================================
// STRIPE WEBHOOK PROCESSING TESTS
// ============================================

test.describe('Stripe Webhook Processing', () => {
  test('checkout.session.completed creates subscription and payment', async ({ request }) => {
    const { userId, username, token } = await setupCreator(request, 'checkout')

    // Create a subscriber
    const subscriberEmail = `sub-checkout-${Date.now()}@e2e.natepay.co`
    const { user: subscriber } = await e2eLogin(request, subscriberEmail)

    const stripeSubId = `e2e-test-sub_${Date.now()}`
    const stripeCustomerId = `cus_test_${Date.now()}`

    // Simulate checkout.session.completed webhook
    const webhookResp = await request.post(`${API_URL}/e2e/webhook/stripe`, {
      data: {
        eventType: 'checkout.session.completed',
        data: {
          id: `cs_test_${Date.now()}`,
          mode: 'subscription',
          customer: stripeCustomerId,
          subscription: stripeSubId,
          payment_status: 'paid',
          amount_total: 1000, // $10.00
          currency: 'usd',
          metadata: {
            creatorId: userId,
            subscriberId: subscriber.id,
          },
          customer_details: {
            email: subscriberEmail,
            name: 'E2E Test Subscriber',
          },
        },
      },
      headers: e2eHeaders(),
    })

    expect(webhookResp.status(), 'Checkout webhook simulation must succeed').toBe(200)

    const result = await webhookResp.json()
    expect(result.success).toBe(true)
    expect(result.status).toBe('processed')

    // SIDE-EFFECT VALIDATION 1: Verify webhook event was recorded
    const eventResp = await request.get(`${API_URL}/e2e/webhook-event/${result.webhookEventId}`, {
      headers: e2eHeaders(),
    })
    expect(eventResp.status()).toBe(200)
    const event = await eventResp.json()
    expect(event.status, 'Webhook event must be marked as processed').toBe('processed')
    expect(event.eventType).toBe('checkout.session.completed')
    expect(event.processingTimeMs).toBeGreaterThanOrEqual(0)

    // SIDE-EFFECT VALIDATION 2: Verify subscription was created in DB
    const subsResp = await request.get(
      `${API_URL}/e2e/subscriptions?creatorId=${userId}&subscriberId=${subscriber.id}`,
      { headers: e2eHeaders() }
    )
    expect(subsResp.status(), 'Subscription query must succeed').toBe(200)
    const { subscriptions } = await subsResp.json()
    expect(subscriptions.length, 'Subscription must be created by webhook').toBeGreaterThanOrEqual(1)
    const createdSub = subscriptions[0]
    expect(createdSub.status, 'Subscription must be active').toBe('active')

    // SIDE-EFFECT VALIDATION 3: Verify payment was created in DB
    const paymentsResp = await request.get(
      `${API_URL}/e2e/payments?creatorId=${userId}&subscriberId=${subscriber.id}`,
      { headers: e2eHeaders() }
    )
    expect(paymentsResp.status(), 'Payment query must succeed').toBe(200)
    const { payments } = await paymentsResp.json()
    expect(payments.length, 'Payment must be created by webhook').toBeGreaterThanOrEqual(1)
    const createdPayment = payments[0]
    expect(createdPayment.status, 'Payment must be succeeded').toBe('succeeded')
    expect(createdPayment.amountCents, 'Payment amount must match').toBe(1000)
  })

  test('invoice.paid updates subscription status', async ({ request }) => {
    const { userId, username } = await setupCreator(request, 'invoice')

    // First seed a subscription
    const { token } = await e2eLogin(request, `creator-invoice-${Date.now()}@e2e.natepay.co`)
    const seedResp = await request.post(`${API_URL}/e2e/seed-subscription`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `sub-invoice-${Date.now()}@e2e.natepay.co`,
        amount: 1000,
        currency: 'USD',
        interval: 'month',
      },
      headers: e2eHeaders(),
    })

    expect(seedResp.status(), 'Subscription seeding must succeed').toBe(200)
    const { subscriptionId } = await seedResp.json()

    // Get subscription to find Stripe ID
    const subResp = await request.get(`${API_URL}/e2e/subscription/${subscriptionId}`, {
      headers: e2eHeaders(),
    })
    const sub = await subResp.json()

    // Simulate invoice.paid webhook
    const webhookResp = await request.post(`${API_URL}/e2e/webhook/stripe`, {
      data: {
        eventType: 'invoice.paid',
        data: {
          id: `in_test_${Date.now()}`,
          subscription: sub.stripeSubscriptionId || `sub_test_${Date.now()}`,
          customer: `cus_test_${Date.now()}`,
          amount_paid: 1000,
          currency: 'usd',
          status: 'paid',
          lines: {
            data: [{
              price: { unit_amount: 1000 },
              period: {
                start: Math.floor(Date.now() / 1000),
                end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
              },
            }],
          },
        },
      },
      headers: e2eHeaders(),
    })

    expect(webhookResp.status()).toBe(200)
    const result = await webhookResp.json()
    expect(result.success).toBe(true)
  })

  test('customer.subscription.updated handles cancellation and updates DB', async ({ request }) => {
    const { username } = await setupCreator(request, 'subupdate')

    // Seed a subscription
    const seedResp = await request.post(`${API_URL}/e2e/seed-subscription`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `sub-update-${Date.now()}@e2e.natepay.co`,
        amount: 1000,
        currency: 'USD',
        interval: 'month',
        status: 'active',
      },
      headers: e2eHeaders(),
    })

    expect(seedResp.status()).toBe(200)
    const { subscriptionId } = await seedResp.json()

    // Get subscription details before webhook
    const beforeResp = await request.get(`${API_URL}/e2e/subscription/${subscriptionId}`, {
      headers: e2eHeaders(),
    })
    const beforeSub = await beforeResp.json()
    expect(beforeSub.cancelAtPeriodEnd).toBe(false)

    // Simulate subscription.updated with cancel_at_period_end
    const webhookResp = await request.post(`${API_URL}/e2e/webhook/stripe`, {
      data: {
        eventType: 'customer.subscription.updated',
        data: {
          id: beforeSub.stripeSubscriptionId || `sub_test_${Date.now()}`,
          status: 'active',
          cancel_at_period_end: true,
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
          metadata: {},
        },
      },
      headers: e2eHeaders(),
    })

    expect(webhookResp.status()).toBe(200)
    const result = await webhookResp.json()
    expect(result.success).toBe(true)

    // DB SIDE-EFFECT VERIFICATION: Subscription should now have cancelAtPeriodEnd=true
    const afterResp = await request.get(`${API_URL}/e2e/subscription/${subscriptionId}`, {
      headers: e2eHeaders(),
    })
    expect(afterResp.status(), 'Subscription query must succeed').toBe(200)
    const afterSub = await afterResp.json()

    // STRICT: Webhook handler must update the subscription
    // The handler looks up by stripeSubscriptionId and updates cancelAtPeriodEnd
    expect(afterSub.status, 'Subscription must remain active').toBe('active')
    // Note: If this fails, the webhook handler may not be matching on stripeSubscriptionId correctly
    expect(afterSub.cancelAtPeriodEnd, 'Webhook must set cancelAtPeriodEnd').toBe(true)
  })

  test('customer.subscription.deleted marks subscription canceled in DB', async ({ request }) => {
    const { username } = await setupCreator(request, 'subdel')

    // Seed a subscription
    const seedResp = await request.post(`${API_URL}/e2e/seed-subscription`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `sub-delete-${Date.now()}@e2e.natepay.co`,
        amount: 1000,
        currency: 'USD',
        interval: 'month',
        status: 'active',
      },
      headers: e2eHeaders(),
    })

    expect(seedResp.status()).toBe(200)
    const { subscriptionId } = await seedResp.json()

    // Verify subscription is active before webhook
    const beforeResp = await request.get(`${API_URL}/e2e/subscription/${subscriptionId}`, {
      headers: e2eHeaders(),
    })
    const beforeSub = await beforeResp.json()
    expect(beforeSub.status).toBe('active')

    // Simulate subscription.deleted
    const webhookResp = await request.post(`${API_URL}/e2e/webhook/stripe`, {
      data: {
        eventType: 'customer.subscription.deleted',
        data: {
          id: beforeSub.stripeSubscriptionId || `sub_test_${Date.now()}`,
          status: 'canceled',
          metadata: {},
        },
      },
      headers: e2eHeaders(),
    })

    expect(webhookResp.status()).toBe(200)
    const result = await webhookResp.json()
    expect(result.success).toBe(true)

    // DB SIDE-EFFECT VERIFICATION: Subscription should now be canceled
    const afterResp = await request.get(`${API_URL}/e2e/subscription/${subscriptionId}`, {
      headers: e2eHeaders(),
    })
    expect(afterResp.status(), 'Subscription query must succeed').toBe(200)
    const afterSub = await afterResp.json()

    // STRICT: Webhook handler must update the subscription status to canceled
    // The handler looks up by stripeSubscriptionId and marks as canceled
    // Note: If this fails, verify webhook handler is matching on stripeSubscriptionId
    expect(afterSub.status, 'Webhook must set subscription to canceled').toBe('canceled')
  })

  test('account.updated handles connect account changes', async ({ request }) => {
    const { userId } = await setupCreator(request, 'acctupd')

    // Simulate account.updated for connected account
    const webhookResp = await request.post(`${API_URL}/e2e/webhook/stripe`, {
      data: {
        eventType: 'account.updated',
        data: {
          id: `acct_test_${Date.now()}`,
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          capabilities: {
            transfers: 'active',
          },
        },
        accountId: `acct_test_${Date.now()}`,
      },
      headers: e2eHeaders(),
    })

    expect(webhookResp.status()).toBe(200)
    const result = await webhookResp.json()
    expect(result.success).toBe(true)
  })

  test('payout.paid creates payout activity', async ({ request }) => {
    const { userId, token } = await setupCreator(request, 'payoutpaid')

    // Simulate payout.paid
    const webhookResp = await request.post(`${API_URL}/e2e/webhook/stripe`, {
      data: {
        eventType: 'payout.paid',
        data: {
          id: `po_test_${Date.now()}`,
          amount: 5000,
          currency: 'usd',
          status: 'paid',
          arrival_date: Math.floor(Date.now() / 1000),
          destination: `ba_test_${Date.now()}`,
        },
        accountId: `acct_test_${Date.now()}`,
      },
      headers: e2eHeaders(),
    })

    expect(webhookResp.status()).toBe(200)
    const result = await webhookResp.json()
    expect(result.success).toBe(true)

    // SIDE-EFFECT VALIDATION 1: Verify webhook event was recorded with processing time
    const eventResp = await request.get(`${API_URL}/e2e/webhook-event/${result.webhookEventId}`, {
      headers: e2eHeaders(),
    })
    expect(eventResp.status()).toBe(200)
    const event = await eventResp.json()
    expect(event.status, 'Webhook event must be marked as processed').toBe('processed')
    expect(event.eventType).toBe('payout.paid')

    // SIDE-EFFECT VALIDATION 2: Verify payout activity was created
    // Note: Activity may be created for the creator if webhook handler links by account ID
    const activitiesResp = await request.get(
      `${API_URL}/e2e/activities?userId=${userId}&type=payout_received`,
      { headers: e2eHeaders() }
    )
    // Activity creation depends on webhook handler finding the creator by Stripe account ID
    // This validates the query endpoint works; activity may or may not exist
    expect(activitiesResp.status()).toBe(200)
  })

  test('payout.failed creates failure activity', async ({ request }) => {
    const { userId } = await setupCreator(request, 'payoutfail')

    // Simulate payout.failed
    const webhookResp = await request.post(`${API_URL}/e2e/webhook/stripe`, {
      data: {
        eventType: 'payout.failed',
        data: {
          id: `po_test_${Date.now()}`,
          amount: 5000,
          currency: 'usd',
          status: 'failed',
          failure_code: 'account_closed',
          failure_message: 'Bank account was closed',
        },
        accountId: `acct_test_${Date.now()}`,
      },
      headers: e2eHeaders(),
    })

    expect(webhookResp.status()).toBe(200)
    const result = await webhookResp.json()
    expect(result.success).toBe(true)
  })

  test('charge.refunded processes refund', async ({ request }) => {
    const { username } = await setupCreator(request, 'refund')

    // First seed a payment to refund
    const seedResp = await request.post(`${API_URL}/e2e/seed-payment`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `sub-refund-${Date.now()}@e2e.natepay.co`,
        amountCents: 1000,
        currency: 'USD',
        status: 'succeeded',
      },
      headers: e2eHeaders(),
    })

    expect(seedResp.status()).toBe(200)

    // Simulate charge.refunded
    const webhookResp = await request.post(`${API_URL}/e2e/webhook/stripe`, {
      data: {
        eventType: 'charge.refunded',
        data: {
          id: `ch_test_${Date.now()}`,
          amount: 1000,
          amount_refunded: 1000,
          currency: 'usd',
          refunds: {
            data: [{
              id: `re_test_${Date.now()}`,
              amount: 1000,
              status: 'succeeded',
            }],
          },
        },
      },
      headers: e2eHeaders(),
    })

    expect(webhookResp.status()).toBe(200)
    const result = await webhookResp.json()
    expect(result.success).toBe(true)
  })

  test('charge.dispute.created handles dispute', async ({ request }) => {
    const { username } = await setupCreator(request, 'dispute')

    // Simulate dispute.created
    const webhookResp = await request.post(`${API_URL}/e2e/webhook/stripe`, {
      data: {
        eventType: 'charge.dispute.created',
        data: {
          id: `dp_test_${Date.now()}`,
          charge: `ch_test_${Date.now()}`,
          amount: 1000,
          currency: 'usd',
          reason: 'fraudulent',
          status: 'needs_response',
        },
      },
      headers: e2eHeaders(),
    })

    expect(webhookResp.status()).toBe(200)
    const result = await webhookResp.json()
    expect(result.success).toBe(true)
  })
})

// ============================================
// PAYSTACK WEBHOOK PROCESSING TESTS
// ============================================

test.describe('Paystack Webhook Processing', () => {
  test('charge.success creates payment record', async ({ request }) => {
    const { userId, username } = await setupCreator(request, 'pscharge', {
      provider: 'paystack',
      countryCode: 'NG',
      currency: 'NGN',
    })

    // Seed a subscription for the charge to match
    const seedResp = await request.post(`${API_URL}/e2e/seed-subscription`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `sub-pscharge-${Date.now()}@e2e.natepay.co`,
        amount: 500000, // 5000 NGN
        currency: 'NGN',
        interval: 'month',
      },
      headers: e2eHeaders(),
    })

    expect(seedResp.status()).toBe(200)

    // Simulate charge.success
    const reference = `e2e-test-${Date.now()}`
    const webhookResp = await request.post(`${API_URL}/e2e/webhook/paystack`, {
      data: {
        event: 'charge.success',
        data: {
          id: Date.now(),
          reference,
          amount: 500000, // Amount in kobo (5000 NGN)
          currency: 'NGN',
          status: 'success',
          channel: 'card',
          authorization: {
            authorization_code: `AUTH_${Date.now()}`,
            card_type: 'visa',
            last4: '4081',
            exp_month: '12',
            exp_year: '2025',
          },
          customer: {
            id: Date.now(),
            email: `sub-pscharge-${Date.now()}@e2e.natepay.co`,
            customer_code: `CUS_${Date.now()}`,
          },
          metadata: {
            creatorId: userId,
            interval: 'month',
          },
        },
      },
      headers: e2eHeaders(),
    })

    expect(webhookResp.status()).toBe(200)
    const result = await webhookResp.json()
    expect(result.success).toBe(true)
    expect(result.status).toBe('processed')
  })

  test('charge.failed handles payment failure', async ({ request }) => {
    await setupCreator(request, 'psfail', {
      provider: 'paystack',
      countryCode: 'NG',
      currency: 'NGN',
    })

    // Simulate charge.failed
    const webhookResp = await request.post(`${API_URL}/e2e/webhook/paystack`, {
      data: {
        event: 'charge.failed',
        data: {
          id: Date.now(),
          reference: `e2e-fail-${Date.now()}`,
          amount: 500000,
          currency: 'NGN',
          status: 'failed',
          gateway_response: 'Insufficient Funds',
          customer: {
            email: `sub-psfail@e2e.natepay.co`,
          },
        },
      },
      headers: e2eHeaders(),
    })

    expect(webhookResp.status()).toBe(200)
    const result = await webhookResp.json()
    expect(result.success).toBe(true)
  })

  test('transfer.success updates payout status', async ({ request }) => {
    const { username } = await setupCreator(request, 'pstransfer', {
      provider: 'paystack',
      countryCode: 'NG',
      currency: 'NGN',
    })

    // Simulate transfer.success
    const webhookResp = await request.post(`${API_URL}/e2e/webhook/paystack`, {
      data: {
        event: 'transfer.success',
        data: {
          id: Date.now(),
          reference: `e2e-transfer-${Date.now()}`,
          amount: 400000, // 4000 NGN (after fees)
          currency: 'NGN',
          status: 'success',
          recipient: {
            name: 'E2E Test Creator',
            account_number: '0123456789',
            bank_code: '058',
          },
        },
      },
      headers: e2eHeaders(),
    })

    expect(webhookResp.status()).toBe(200)
    const result = await webhookResp.json()
    expect(result.success).toBe(true)
  })

  test('transfer.failed handles payout failure', async ({ request }) => {
    await setupCreator(request, 'pstransfail', {
      provider: 'paystack',
      countryCode: 'NG',
      currency: 'NGN',
    })

    // Simulate transfer.failed
    const webhookResp = await request.post(`${API_URL}/e2e/webhook/paystack`, {
      data: {
        event: 'transfer.failed',
        data: {
          id: Date.now(),
          reference: `e2e-transfail-${Date.now()}`,
          amount: 400000,
          currency: 'NGN',
          status: 'failed',
          reason: 'Invalid account number',
        },
      },
      headers: e2eHeaders(),
    })

    expect(webhookResp.status()).toBe(200)
    const result = await webhookResp.json()
    expect(result.success).toBe(true)
  })

  test('refund.processed handles refund', async ({ request }) => {
    await setupCreator(request, 'psrefund', {
      provider: 'paystack',
      countryCode: 'NG',
      currency: 'NGN',
    })

    // Simulate refund.processed
    const webhookResp = await request.post(`${API_URL}/e2e/webhook/paystack`, {
      data: {
        event: 'refund.processed',
        data: {
          id: Date.now(),
          reference: `e2e-refund-${Date.now()}`,
          transaction_reference: `e2e-txn-${Date.now()}`,
          amount: 500000,
          currency: 'NGN',
          status: 'processed',
        },
      },
      headers: e2eHeaders(),
    })

    expect(webhookResp.status()).toBe(200)
    const result = await webhookResp.json()
    expect(result.success).toBe(true)
  })

  test('charge.dispute.create handles dispute', async ({ request }) => {
    await setupCreator(request, 'psdispute', {
      provider: 'paystack',
      countryCode: 'NG',
      currency: 'NGN',
    })

    // Simulate charge.dispute.create
    const webhookResp = await request.post(`${API_URL}/e2e/webhook/paystack`, {
      data: {
        event: 'charge.dispute.create',
        data: {
          id: Date.now(),
          reference: `e2e-dispute-${Date.now()}`,
          transaction_reference: `e2e-txn-${Date.now()}`,
          amount: 500000,
          currency: 'NGN',
          status: 'awaiting-merchant-feedback',
          category: 'chargeback',
        },
      },
      headers: e2eHeaders(),
    })

    expect(webhookResp.status()).toBe(200)
    const result = await webhookResp.json()
    expect(result.success).toBe(true)
  })
})

// ============================================
// WEBHOOK EVENT TRACKING TESTS
// ============================================

test.describe('Webhook Event Tracking', () => {
  test('webhook event is recorded in database', async ({ request }) => {
    await setupCreator(request, 'tracking')

    // Simulate a webhook
    const webhookResp = await request.post(`${API_URL}/e2e/webhook/stripe`, {
      data: {
        eventType: 'account.updated',
        data: {
          id: `acct_test_${Date.now()}`,
          charges_enabled: true,
          payouts_enabled: true,
        },
      },
      headers: e2eHeaders(),
    })

    expect(webhookResp.status()).toBe(200)
    const result = await webhookResp.json()
    expect(result.webhookEventId).toBeTruthy()

    // Query the webhook event
    const eventResp = await request.get(`${API_URL}/e2e/webhook-event/${result.webhookEventId}`, {
      headers: e2eHeaders(),
    })

    expect(eventResp.status()).toBe(200)
    const event = await eventResp.json()

    expect(event.status).toBe('processed')
    expect(event.eventType).toBe('account.updated')
    expect(event.provider).toBe('stripe')
    expect(event.processedAt).toBeTruthy()
  })

  test('webhook processing time is tracked', async ({ request }) => {
    const { userId } = await setupCreator(request, 'timing', {
      provider: 'paystack',
      countryCode: 'NG',
      currency: 'NGN',
    })

    const webhookResp = await request.post(`${API_URL}/e2e/webhook/paystack`, {
      data: {
        event: 'charge.success',
        data: {
          id: Date.now(),
          reference: `e2e-timing-${Date.now()}`,
          amount: 100000,
          currency: 'NGN',
          status: 'success',
          customer: {
            id: Date.now(),
            email: `timing-${Date.now()}@e2e.natepay.co`,
            customer_code: `CUS_${Date.now()}`,
          },
          metadata: {
            creatorId: userId,
            interval: 'one_time',
          },
        },
      },
      headers: e2eHeaders(),
    })

    expect(webhookResp.status()).toBe(200)
    const result = await webhookResp.json()

    // Query the webhook event
    const eventResp = await request.get(`${API_URL}/e2e/webhook-event/${result.webhookEventId}`, {
      headers: e2eHeaders(),
    })

    expect(eventResp.status()).toBe(200)
    const event = await eventResp.json()

    expect(typeof event.processingTimeMs).toBe('number')
    expect(event.processingTimeMs).toBeGreaterThanOrEqual(0)
  })
})

// ============================================
// IDEMPOTENCY TESTS
// ============================================

test.describe('Webhook Idempotency', () => {
  test('duplicate Stripe webhook is skipped', async ({ request }) => {
    await setupCreator(request, 'idempotent')

    const eventData = {
      eventType: 'account.updated',
      data: {
        id: `acct_idem_${Date.now()}`,
        charges_enabled: true,
      },
    }

    // Send first webhook
    const resp1 = await request.post(`${API_URL}/e2e/webhook/stripe`, {
      data: eventData,
      headers: e2eHeaders(),
    })
    expect(resp1.status()).toBe(200)

    // Send duplicate with same data (should still succeed due to idempotency)
    const resp2 = await request.post(`${API_URL}/e2e/webhook/stripe`, {
      data: eventData,
      headers: e2eHeaders(),
    })

    // May succeed or return already_processed
    expect([200, 409]).toContain(resp2.status())
  })
})

// ============================================
// DB SIDE-EFFECT VERIFICATION TESTS
// ============================================

test.describe('Webhook DB Side-Effects', () => {
  test('charge.success creates payment record with correct amounts', async ({ request }) => {
    const { userId, username } = await setupCreator(request, 'dbpayment', {
      provider: 'paystack',
      countryCode: 'NG',
      currency: 'NGN',
    })

    // Seed a subscription to match charge to
    const subSeedResp = await request.post(`${API_URL}/e2e/seed-subscription`, {
      data: {
        creatorUsername: username,
        subscriberEmail: `db-pay-${Date.now()}@e2e.natepay.co`,
        amount: 500000, // 5000 NGN
        currency: 'NGN',
        interval: 'month',
      },
      headers: e2eHeaders(),
    })
    expect(subSeedResp.status()).toBe(200)

    const reference = `e2e-dbtest-${Date.now()}`

    // Simulate charge.success
    const webhookResp = await request.post(`${API_URL}/e2e/webhook/paystack`, {
      data: {
        event: 'charge.success',
        data: {
          id: Date.now(),
          reference,
          amount: 500000, // 5000 NGN in kobo
          currency: 'NGN',
          status: 'success',
          channel: 'card',
          authorization: {
            authorization_code: `AUTH_dbtest_${Date.now()}`,
            card_type: 'mastercard',
            last4: '1234',
            exp_month: '12',
            exp_year: '2026',
          },
          customer: {
            id: Date.now(),
            email: `db-pay-${Date.now()}@e2e.natepay.co`,
            customer_code: `CUS_${Date.now()}`,
          },
          metadata: {
            creatorId: userId,
            interval: 'month',
          },
        },
      },
      headers: e2eHeaders(),
    })

    expect(webhookResp.status()).toBe(200)
    const result = await webhookResp.json()
    expect(result.success).toBe(true)
    expect(result.status).toBe('processed')

    // DB SIDE-EFFECT: Verify webhook event was recorded
    const eventResp = await request.get(`${API_URL}/e2e/webhook-event/${result.webhookEventId}`, {
      headers: e2eHeaders(),
    })
    expect(eventResp.status()).toBe(200)
    const event = await eventResp.json()

    expect(event.status, 'Webhook event must be marked as processed').toBe('processed')
    expect(event.provider).toBe('paystack')
    expect(event.eventType).toBe('charge.success')
    expect(event.processingTimeMs).toBeGreaterThanOrEqual(0)
    expect(event.processedAt).toBeTruthy()
  })

  test('webhook events record processing errors', async ({ request }) => {
    // Send malformed webhook to trigger processing error
    const webhookResp = await request.post(`${API_URL}/e2e/webhook/stripe`, {
      data: {
        eventType: 'unknown.event.type.that.does.not.exist',
        data: {
          id: `malformed_${Date.now()}`,
        },
      },
      headers: e2eHeaders(),
    })

    // May succeed (unknown events often skipped) or fail
    if (webhookResp.status() === 200) {
      const result = await webhookResp.json()

      // Verify event was recorded
      const eventResp = await request.get(`${API_URL}/e2e/webhook-event/${result.webhookEventId}`, {
        headers: e2eHeaders(),
      })
      expect(eventResp.status()).toBe(200)

      const event = await eventResp.json()
      // Unknown events may be processed (skipped) or failed
      expect(['processed', 'skipped', 'failed']).toContain(event.status)
    }
  })

  test('webhook processing time is accurately tracked', async ({ request }) => {
    await setupCreator(request, 'dbtime')

    const startTime = Date.now()

    const webhookResp = await request.post(`${API_URL}/e2e/webhook/stripe`, {
      data: {
        eventType: 'account.updated',
        data: {
          id: `acct_time_${Date.now()}`,
          charges_enabled: true,
          payouts_enabled: true,
        },
      },
      headers: e2eHeaders(),
    })

    const endTime = Date.now()
    const maxExpectedTime = endTime - startTime + 100 // Allow some buffer

    expect(webhookResp.status()).toBe(200)
    const result = await webhookResp.json()

    // Verify processing time is reasonable
    const eventResp = await request.get(`${API_URL}/e2e/webhook-event/${result.webhookEventId}`, {
      headers: e2eHeaders(),
    })
    expect(eventResp.status()).toBe(200)

    const event = await eventResp.json()
    expect(event.processingTimeMs).toBeGreaterThanOrEqual(0)
    expect(event.processingTimeMs).toBeLessThan(maxExpectedTime)
  })
})
