import Stripe from 'stripe'
import crypto from 'crypto'
import { env } from '../config/env.js'
import { db } from '../db/client.js'
import { redis } from '../db/redis.js'
import { stripeCircuitBreaker, CircuitBreakerError } from '../utils/circuitBreaker.js'
import { isStripeCrossBorderSupported } from '../utils/constants.js'

// Cache TTL for Stripe account status (5 minutes)
// Status changes are rare and webhooks update payoutStatus in DB
const STRIPE_STATUS_CACHE_TTL = 300

// Generate idempotency key for Stripe API calls
// Uses 5-minute time buckets so duplicate requests within 5 minutes get same key
function generateIdempotencyKey(prefix: string, ...parts: (string | number | undefined)[]): string {
  const timeBucket = Math.floor(Date.now() / (5 * 60 * 1000)) // 5-minute buckets
  const data = [...parts.filter(Boolean), timeBucket].join(':')
  const hash = crypto.createHash('sha256').update(data).digest('hex').substring(0, 24)
  return `${prefix}_${hash}`
}

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-11-17.clover',
})

// Create Express account for a user
// Supports both native Stripe countries and cross-border payout countries
export async function createExpressAccount(
  userId: string,
  email: string,
  country: string,
  displayName?: string
) {
  // Check if user already has an account
  const profile = await db.profile.findUnique({ where: { userId } })

  if (profile?.stripeAccountId) {
    // Return existing account link if not fully onboarded
    const account = await stripe.accounts.retrieve(profile.stripeAccountId)

    if (!account.details_submitted) {
      const accountLink = await createAccountLink(profile.stripeAccountId, country)
      return { accountId: profile.stripeAccountId, accountLink }
    }

    return { accountId: profile.stripeAccountId, accountLink: null, alreadyOnboarded: true }
  }

  // Check if this is a cross-border payout country (e.g., Nigeria, Ghana, Kenya)
  const isCrossBorder = isStripeCrossBorderSupported(country)

  // Parse name for KYC prefill
  const nameParts = displayName?.trim().split(' ') || []
  const firstName = nameParts[0] || undefined
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined

  // Create new Express account with prefilled KYC data
  // Use idempotency key to prevent duplicate accounts on retry/double-click
  const idempotencyKey = generateIdempotencyKey('acct_create', userId, email)

  // For cross-border payouts, use recipient service agreement
  // This enables the platform to send payouts to these accounts
  const accountParams: Stripe.AccountCreateParams = {
    type: 'express',
    email,
    country,
    capabilities: {
      transfers: { requested: true },
      // Cross-border accounts don't need card_payments capability
      ...(isCrossBorder ? {} : { card_payments: { requested: true } }),
    },
    business_type: 'individual',
    // Prefill KYC data to speed up onboarding
    individual: {
      email,
      first_name: firstName,
      last_name: lastName,
    },
    settings: {
      payouts: {
        schedule: {
          interval: 'daily',
        },
      },
    },
    // Cross-border accounts use recipient TOS
    ...(isCrossBorder ? {
      tos_acceptance: {
        service_agreement: 'recipient',
      },
    } : {}),
  }

  const account = await stripe.accounts.create(accountParams, { idempotencyKey })

  // Save account ID to profile with cross-border flag
  await db.profile.update({
    where: { userId },
    data: {
      stripeAccountId: account.id,
      payoutStatus: 'pending',
    },
  })

  // Create account link for onboarding
  const accountLink = await createAccountLink(account.id, country)

  return { accountId: account.id, accountLink, crossBorder: isCrossBorder }
}

// Create account link for onboarding
export async function createAccountLink(accountId: string, country?: string) {
  // Check if cross-border country for proper collection options
  const isCrossBorder = country ? isStripeCrossBorderSupported(country) : false

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: env.STRIPE_ONBOARDING_REFRESH_URL,
    return_url: env.STRIPE_ONBOARDING_RETURN_URL,
    type: 'account_onboarding',
    // Collect all required fields upfront, not just minimum
    collection_options: {
      fields: 'eventually_due', // Collect all fields that will eventually be required
    },
  })

  return accountLink.url
}

// Get account status with detailed requirements
// Uses Redis cache to reduce Stripe API calls (5-minute TTL)
// forceRefresh: bypass cache (use after returning from Stripe onboarding)
// skipBankDetails: don't expand external_accounts (faster response)
export async function getAccountStatus(stripeAccountId: string, options: { skipBankDetails?: boolean; forceRefresh?: boolean } = {}) {
  const { skipBankDetails = false, forceRefresh = false } = options
  const cacheKey = `stripe:status:${stripeAccountId}`

  // Check cache first (unless forceRefresh is true)
  if (!forceRefresh) {
    try {
      const cached = await Promise.race([
        redis.get(cacheKey),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)) // 500ms timeout
      ])
      if (cached && typeof cached === 'string') {
        return JSON.parse(cached)
      }
    } catch (err) {
      // Cache miss or error - continue to API call
    }
  }

  // Only expand external_accounts if we need bank details (not on initial status check)
  const account = await stripe.accounts.retrieve(stripeAccountId, {
    expand: skipBankDetails ? [] : ['external_accounts'],
  })

  // Parse requirements into user-friendly format
  const currentlyDue = account.requirements?.currently_due || []
  const eventuallyDue = account.requirements?.eventually_due || []
  const pendingVerification = account.requirements?.pending_verification || []

  // Get default bank account info if available
  let bankAccount: {
    bankName: string | null
    last4: string | null
    accountHolderName: string | null
    routingNumber: string | null
  } | null = null

  if (account.external_accounts?.data?.length) {
    const defaultBank = account.external_accounts.data.find(
      (acc) => acc.object === 'bank_account' && (acc as Stripe.BankAccount).default_for_currency
    ) || account.external_accounts.data[0]

    if (defaultBank && defaultBank.object === 'bank_account') {
      const bank = defaultBank as Stripe.BankAccount
      bankAccount = {
        bankName: bank.bank_name || null,
        last4: bank.last4 || null,
        accountHolderName: bank.account_holder_name || null,
        routingNumber: bank.routing_number || null,
      }
    }
  }

  const result = {
    detailsSubmitted: account.details_submitted,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    bankAccount,
    payoutSchedule: account.settings?.payouts?.schedule?.interval || 'daily',
    requirements: {
      currentlyDue,
      eventuallyDue,
      pendingVerification,
      disabledReason: account.requirements?.disabled_reason || null,
      currentDeadline: account.requirements?.current_deadline
        ? new Date(account.requirements.current_deadline * 1000)
        : null,
    },
  }

  // Cache the result (non-blocking)
  redis.setex(cacheKey, STRIPE_STATUS_CACHE_TTL, JSON.stringify(result)).catch(() => {})

  return result
}

// Create Express Dashboard login link
export async function createExpressDashboardLink(stripeAccountId: string) {
  const loginLink = await stripe.accounts.createLoginLink(stripeAccountId)
  return loginLink.url
}

// Create checkout session for subscription
export async function createCheckoutSession(params: {
  creatorId: string
  tierId?: string
  requestId?: string
  grossAmount: number      // What subscriber pays (in smallest unit)
  netAmount: number        // What creator receives (in smallest unit)
  serviceFee: number       // Platform service fee (in smallest unit)
  currency: string
  interval: 'month' | 'one_time'
  successUrl: string
  cancelUrl: string
  subscriberEmail?: string
  viewId?: string          // Analytics: page view ID for conversion tracking
  feeMetadata?: {
    feeModel: string
    feeMode: string         // 'absorb' | 'pass_to_subscriber'
    feeEffectiveRate: number
    feeWasCapped?: boolean  // Optional - flat fee model has no caps
  }
}) {
  // Get creator's Stripe account
  const creatorProfile = await db.profile.findUnique({
    where: { userId: params.creatorId },
  })

  if (!creatorProfile?.stripeAccountId) {
    throw new Error('Creator has not connected payments')
  }

  // Store validated stripeAccountId for type narrowing
  const stripeAccountId = creatorProfile.stripeAccountId

  // Check for platform debit to recover (only for one-time payments)
  // For subscriptions, debit recovery happens via separate charge in webhook
  const platformDebitToRecover = params.interval === 'one_time'
    ? Math.min(creatorProfile.platformDebitCents || 0, 3000) // Max $30 recovery per payment
    : 0

  // Use pre-calculated amounts from fee engine
  // This correctly handles both fee modes:
  // - pass_to_subscriber: grossAmount = netAmount + fee
  // - absorb: grossAmount = netAmount + fee (but netAmount is lower)
  const chargeAmount = params.grossAmount  // What subscriber pays

  // Create price data - subscriber sees the charge amount
  const priceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData = {
    currency: params.currency.toLowerCase(),
    unit_amount: chargeAmount,
    product_data: {
      name: creatorProfile.displayName,
      description: params.tierId
        ? `Subscription to ${creatorProfile.displayName}`
        : `Support ${creatorProfile.displayName}`,
    },
  }

  if (params.interval === 'month') {
    priceData.recurring = { interval: 'month' }
  }

  // Generate idempotency key
  // Use viewId for anonymous visitors to prevent double-checkout on same page session
  // Falls back to random UUID only if no viewId (shouldn't happen in normal flow)
  const visitorIdentifier = params.subscriberEmail || params.viewId || crypto.randomUUID()
  const idempotencyKey = generateIdempotencyKey(
    'checkout',
    params.creatorId,
    visitorIdentifier,
    params.tierId,
    chargeAmount.toString(),
    params.interval
  )

  // Metadata for tracking fees through the system
  const metadata = {
    creatorId: params.creatorId,
    tierId: params.tierId || '',
    requestId: params.requestId || '',
    viewId: params.viewId || '', // Analytics: page view ID for conversion tracking
    // Fee tracking (flat model with creator-chosen fee mode)
    grossAmount: params.grossAmount.toString(),   // What subscriber paid
    netAmount: params.netAmount.toString(),       // What creator receives (was creatorAmount)
    serviceFee: params.serviceFee.toString(),     // Platform fee
    feeModel: params.feeMetadata?.feeModel || 'flat',
    feeMode: params.feeMetadata?.feeMode || 'pass_to_subscriber',
    feeEffectiveRate: params.feeMetadata?.feeEffectiveRate?.toString() || '',
    feeWasCapped: params.feeMetadata?.feeWasCapped ? 'true' : 'false',
    // Platform debit recovery tracking
    platformDebitRecovered: platformDebitToRecover.toString(),
  }

  // Total application fee = service fee + debit recovery
  const totalApplicationFee = params.serviceFee + platformDebitToRecover

  // Create checkout session with circuit breaker protection
  // For both one-time and subscriptions, use application_fee_amount (fixed fee)
  const session = await stripeCircuitBreaker(() =>
    stripe.checkout.sessions.create(
      {
        mode: params.interval === 'month' ? 'subscription' : 'payment',
        line_items: [
          {
            price_data: priceData,
            quantity: 1,
          },
        ],
        // One-time payments: set fee on payment intent (includes debit recovery)
        payment_intent_data: params.interval === 'one_time' ? {
          application_fee_amount: totalApplicationFee,
          transfer_data: {
            destination: stripeAccountId,
          },
        } : undefined,
        // Subscriptions: set application_fee_percent for platform fee
        // IMPORTANT: application_fee_percent applies to the TOTAL charge amount,
        // not the creator's price. So we need to calculate: fee / chargeAmount * 100
        // Example: $10 creator price + $1 fee = $11 charge → fee_percent = 1/11 = 9.09%
        // For absorb mode: $10 charge, $1 fee → fee_percent = 1/10 = 10%
        subscription_data: params.interval === 'month' ? {
          application_fee_percent: chargeAmount > 0
            ? Math.round((params.serviceFee / chargeAmount) * 10000) / 100
            : 0,
          transfer_data: {
            destination: stripeAccountId,
          },
          metadata, // Store fee info for tracking/auditing
        } : undefined,
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        customer_email: params.subscriberEmail,
        metadata,
      },
      { idempotencyKey }
    )
  )

  return session
}

// Get account balance
export async function getAccountBalance(stripeAccountId: string) {
  const balance = await stripe.balance.retrieve({
    stripeAccount: stripeAccountId,
  })

  return {
    available: balance.available.reduce((sum, b) => sum + b.amount, 0),
    pending: balance.pending.reduce((sum, b) => sum + b.amount, 0),
  }
}

// Get payout history
export async function getPayoutHistory(stripeAccountId: string, limit = 10) {
  const payouts = await stripe.payouts.list(
    { limit },
    { stripeAccount: stripeAccountId }
  )

  return payouts.data.map(p => ({
    id: p.id,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    arrivalDate: new Date(p.arrival_date * 1000),
    createdAt: new Date(p.created * 1000),
  }))
}

/**
 * Set fee tracking metadata on a Stripe subscription
 *
 * IMPORTANT: We do NOT modify application_fee_percent here!
 * The fee percent is set at checkout creation and must remain for all invoices.
 * Clearing it would break fee collection on renewal invoices.
 *
 * This function only stores metadata for tracking/auditing purposes.
 *
 * @param stripeSubscriptionId - The Stripe subscription ID
 * @param applicationFeeAmount - The expected fee amount in smallest currency unit
 */
export async function setSubscriptionDefaultFee(
  stripeSubscriptionId: string,
  applicationFeeAmount: number
): Promise<void> {
  try {
    // Only update metadata - DO NOT touch application_fee_percent!
    await stripe.subscriptions.update(stripeSubscriptionId, {
      metadata: {
        expected_fee_amount: applicationFeeAmount.toString(),
      },
    })
    console.log(`[stripe] Set fee tracking metadata ${applicationFeeAmount} on subscription ${stripeSubscriptionId}`)
  } catch (err) {
    console.error(`[stripe] Failed to set fee metadata on subscription ${stripeSubscriptionId}:`, err)
    throw err
  }
}

/**
 * Verify and update invoice fee if needed
 *
 * Called from invoice.paid to verify the fee was correctly applied.
 * If the invoice's application_fee differs from expected, log a warning.
 */
export async function verifyInvoiceFee(
  invoiceId: string,
  expectedFee: number
): Promise<{ actualFee: number; matched: boolean }> {
  try {
    const invoice = await stripe.invoices.retrieve(invoiceId)
    const actualFee = (invoice as any).application_fee_amount || 0

    if (actualFee !== expectedFee) {
      console.warn(`[stripe] Fee mismatch on invoice ${invoiceId}: expected ${expectedFee}, got ${actualFee}`)
    }

    return { actualFee, matched: actualFee === expectedFee }
  } catch (err) {
    console.error(`[stripe] Failed to verify invoice fee ${invoiceId}:`, err)
    return { actualFee: 0, matched: false }
  }
}

/**
 * Cancel a Stripe subscription
 *
 * @param stripeSubscriptionId - The Stripe subscription ID
 * @param cancelAtPeriodEnd - If true, cancel at end of billing period; if false, cancel immediately
 * @returns The updated subscription status
 */
export async function cancelSubscription(
  stripeSubscriptionId: string,
  cancelAtPeriodEnd: boolean = true
): Promise<{ status: string; canceledAt: Date | null; cancelAtPeriodEnd: boolean }> {
  try {
    let subscription: Stripe.Subscription

    if (cancelAtPeriodEnd) {
      // Cancel at end of current billing period
      subscription = await stripe.subscriptions.update(stripeSubscriptionId, {
        cancel_at_period_end: true,
      })
      console.log(`[stripe] Subscription ${stripeSubscriptionId} set to cancel at period end`)
    } else {
      // Cancel immediately
      subscription = await stripe.subscriptions.cancel(stripeSubscriptionId)
      console.log(`[stripe] Subscription ${stripeSubscriptionId} canceled immediately`)
    }

    return {
      status: subscription.status,
      canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    }
  } catch (err) {
    console.error(`[stripe] Failed to cancel subscription ${stripeSubscriptionId}:`, err)
    throw err
  }
}

/**
 * Reactivate a subscription that was set to cancel at period end
 *
 * @param stripeSubscriptionId - The Stripe subscription ID
 * @returns The updated subscription status
 */
export async function reactivateSubscription(
  stripeSubscriptionId: string
): Promise<{ status: string; cancelAtPeriodEnd: boolean }> {
  try {
    const subscription = await stripe.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: false,
    })
    console.log(`[stripe] Subscription ${stripeSubscriptionId} reactivated`)

    return {
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    }
  } catch (err) {
    console.error(`[stripe] Failed to reactivate subscription ${stripeSubscriptionId}:`, err)
    throw err
  }
}

/**
 * Create a customer portal session for a subscriber
 * Allows subscribers to manage their payment methods and cancel subscriptions
 *
 * @param stripeCustomerId - The Stripe customer ID from the subscription
 * @param returnUrl - URL to redirect back to after portal session
 * @returns The portal session URL
 */
export async function createSubscriberPortalSession(
  stripeCustomerId: string,
  returnUrl: string
): Promise<{ url: string }> {
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: returnUrl,
    })

    return { url: session.url }
  } catch (err) {
    console.error(`[stripe] Failed to create portal session for customer ${stripeCustomerId}:`, err)
    throw err
  }
}
