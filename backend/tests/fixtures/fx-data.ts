/**
 * Test Fixtures for FX Data
 *
 * These fixtures represent various cross-border payment scenarios:
 * 1. USD → NGN (US subscriber → Nigerian creator)
 * 2. Same currency (USD → USD, no FX)
 * 3. Paystack (NGN → NGN local payment)
 */

import Stripe from 'stripe'

// Fixture 1: USD → NGN cross-border payment
// US subscriber pays $10, Nigerian creator receives ~₦15,500 after FX
export const usdToNgnCharge: Partial<Stripe.Charge> = {
  id: 'ch_usd_to_ngn_test',
  amount: 1000, // $10.00 in cents
  currency: 'usd',
  status: 'succeeded',
  transfer: 'tr_usd_to_ngn_test',
}

export const usdToNgnTransfer: Partial<Stripe.Transfer> = {
  id: 'tr_usd_to_ngn_test',
  amount: 900, // $9.00 after platform fee
  currency: 'usd',
  destination: 'acct_ng_creator_test',
  destination_payment: {
    id: 'py_destination_test',
    object: 'charge',
    amount: 900,
    currency: 'usd',
    balance_transaction: {
      id: 'txn_ngn_test',
      object: 'balance_transaction',
      amount: 1395000, // ₦13,950 in kobo (900 * 1550 rate)
      currency: 'ngn',
      net: 1395000, // After any Stripe fees on connected account
      fee: 0,
      exchange_rate: 1550.0, // 1 USD = 1550 NGN
      type: 'payment',
    } as unknown as Stripe.BalanceTransaction,
  } as unknown as Stripe.Charge,
}

// Fixture 2: Same currency (USD → USD, no FX conversion)
export const usdToUsdCharge: Partial<Stripe.Charge> = {
  id: 'ch_usd_to_usd_test',
  amount: 1000, // $10.00 in cents
  currency: 'usd',
  status: 'succeeded',
  transfer: 'tr_usd_to_usd_test',
}

export const usdToUsdTransfer: Partial<Stripe.Transfer> = {
  id: 'tr_usd_to_usd_test',
  amount: 900,
  currency: 'usd',
  destination: 'acct_us_creator_test',
  destination_payment: {
    id: 'py_us_destination_test',
    object: 'charge',
    amount: 900,
    currency: 'usd',
    balance_transaction: {
      id: 'txn_usd_test',
      object: 'balance_transaction',
      amount: 900,
      currency: 'usd',
      net: 900,
      fee: 0,
      exchange_rate: null, // No FX conversion
      type: 'payment',
    } as unknown as Stripe.BalanceTransaction,
  } as unknown as Stripe.Charge,
}

// Fixture 3: Charge with no transfer yet (still processing)
export const pendingCharge: Partial<Stripe.Charge> = {
  id: 'ch_pending_test',
  amount: 1000,
  currency: 'usd',
  status: 'pending',
  transfer: null as unknown as string, // No transfer created yet
}

// Fixture 4: USD → KES cross-border payment
export const usdToKesCharge: Partial<Stripe.Charge> = {
  id: 'ch_usd_to_kes_test',
  amount: 2000, // $20.00 in cents
  currency: 'usd',
  status: 'succeeded',
  transfer: 'tr_usd_to_kes_test',
}

export const usdToKesTransfer: Partial<Stripe.Transfer> = {
  id: 'tr_usd_to_kes_test',
  amount: 1800, // $18.00 after platform fee
  currency: 'usd',
  destination: 'acct_ke_creator_test',
  destination_payment: {
    id: 'py_kes_destination_test',
    object: 'charge',
    amount: 1800,
    currency: 'usd',
    balance_transaction: {
      id: 'txn_kes_test',
      object: 'balance_transaction',
      amount: 234000, // KES 2,340 in cents (1800 * 130 rate)
      currency: 'kes',
      net: 234000,
      fee: 0,
      exchange_rate: 130.0, // 1 USD = 130 KES
      type: 'payment',
    } as unknown as Stripe.BalanceTransaction,
  } as unknown as Stripe.Charge,
}

// Fixture 5: Payment record with FX data already stored
export const paymentWithFxData = {
  id: 'payment_with_fx',
  subscriptionId: 'sub_test',
  creatorId: 'creator_ng_test',
  subscriberId: 'subscriber_us_test',
  grossCents: 1000, // $10.00
  amountCents: 1000,
  netCents: 900, // After platform fee
  currency: 'USD',
  feeCents: 100,
  type: 'recurring',
  status: 'succeeded',
  occurredAt: new Date('2024-01-15T10:00:00Z'),
  stripeChargeId: 'ch_usd_to_ngn_test',
  // FX data
  payoutCurrency: 'NGN',
  payoutAmountCents: 1395000, // ₦13,950
  exchangeRate: 1550.0,
}

// Fixture 6: Payment record without FX data (needs backfill)
export const paymentNeedingBackfill = {
  id: 'payment_needs_backfill',
  subscriptionId: 'sub_test_2',
  creatorId: 'creator_ng_test',
  subscriberId: 'subscriber_us_test',
  grossCents: 1000,
  amountCents: 1000,
  netCents: 900,
  currency: 'USD',
  feeCents: 100,
  type: 'recurring',
  status: 'succeeded',
  occurredAt: new Date('2024-01-16T10:00:00Z'),
  stripeChargeId: 'ch_backfill_test',
  // No FX data - needs backfill
  payoutCurrency: null,
  payoutAmountCents: null,
  exchangeRate: null,
}

// Fixture 7: Paystack local payment (NGN → NGN, no FX)
export const paystackLocalPayment = {
  id: 'payment_paystack_local',
  subscriptionId: 'sub_paystack',
  creatorId: 'creator_ng_paystack',
  subscriberId: 'subscriber_ng',
  grossCents: 500000, // ₦5,000 in kobo
  amountCents: 500000,
  netCents: 460000, // After Paystack fees
  currency: 'NGN',
  feeCents: 40000,
  type: 'recurring',
  status: 'succeeded',
  occurredAt: new Date('2024-01-17T10:00:00Z'),
  paystackTransactionRef: 'ref_paystack_test',
  // No FX for local payments
  payoutCurrency: null,
  payoutAmountCents: null,
  exchangeRate: null,
}

// Fixture 8: Activity with paymentId (new format)
// Using UUIDs for IDs as the API validates them
export const activityWithPaymentId = {
  id: '11111111-1111-1111-1111-111111111111',
  userId: 'creator_ng_test',
  type: 'payment_received',
  payload: {
    subscriptionId: 'sub_test',
    paymentId: 'payment_with_fx', // Links to exact payment
    amount: 900,
    grossAmount: 1000,
    feeCents: 100,
    currency: 'USD',
    provider: 'stripe',
  },
  createdAt: new Date('2024-01-15T10:00:00Z'),
}

// Fixture 9: Legacy activity without paymentId (old format)
export const activityWithoutPaymentId = {
  id: '22222222-2222-2222-2222-222222222222',
  userId: 'creator_ng_test',
  type: 'subscription_created',
  payload: {
    subscriptionId: 'sub_test_2',
    // No paymentId - uses subscriptionId fallback
    amount: 900,
    grossAmount: 1000,
    feeCents: 100,
    currency: 'USD',
    provider: 'stripe',
  },
  createdAt: new Date('2024-01-16T10:00:00Z'),
}

// Fixture 10: Profile for Nigerian creator with Stripe
// Note: Cross-border Stripe creators MUST use USD for pricing
// Payouts convert to local currency (NGN) via FX
export const nigerianCreatorProfile = {
  userId: 'creator_ng_test',
  displayName: 'Test Creator NG',
  username: 'testcreatorng',
  currency: 'USD', // Required for cross-border Stripe
  countryCode: 'NG', // Used for cross-border detection
  paymentProvider: 'stripe',
  stripeAccountId: 'acct_ng_creator_test',
  payoutStatus: 'active',
  // Payment at 2024-01-15 should be before this date to be marked as "paid"
  lastPayoutAt: new Date('2024-01-16T00:00:00Z'),
}

// Fixture 11: Profile for US creator (no FX)
export const usCreatorProfile = {
  userId: 'creator_us_test',
  displayName: 'Test Creator US',
  username: 'testcreatorus',
  currency: 'USD',
  countryCode: 'US', // Not cross-border
  paymentProvider: 'stripe',
  stripeAccountId: 'acct_us_creator_test',
  payoutStatus: 'active',
}
