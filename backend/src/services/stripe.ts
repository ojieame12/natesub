/**
 * STRIPE INTEGRATION - READ THIS BEFORE MAKING CHANGES
 * =====================================================
 *
 * BUSINESS MODEL:
 * - Subscribers pay creators via Apple Pay/Card (recurring subscriptions)
 * - Payments go through NatePay platform (destination charges)
 * - Stripe AUTOMATICALLY disburses to creator's bank (minus platform fee)
 * - NatePay NEVER holds customer funds
 *
 * NIGERIAN CREATORS (and Ghana, Kenya):
 * - Stripe DOES support Nigerian Express accounts natively
 * - Use country: 'NG' (the user's ACTUAL country, NOT 'US' or 'GB')
 * - Use tos_acceptance.service_agreement: 'recipient' (platform is business of record)
 * - Only request 'transfers' capability (NOT 'card_payments')
 * - Creator goes through Express onboarding with Nigerian details + Nigerian bank
 * - Payouts go to their Nigerian bank in NGN with automatic conversion
 *
 * WHY 'transfers' ONLY (not 'card_payments'):
 * - The PLATFORM (NatePay) processes card payments from subscribers
 * - The CREATOR only receives transfers from the automatic split
 * - card_payments would only be needed if creator ran their own checkout
 *
 * FUND FLOW (Destination Charges):
 * 1. Subscriber pays $10 with Apple Pay
 * 2. Stripe checkout has: transfer_data.destination = creator's stripeAccountId
 * 3. Stripe AUTOMATICALLY splits: $1 → NatePay, $9 → Creator
 * 4. Creator receives payout to Nigerian bank (24hr delay for cross-border)
 *
 * DO NOT:
 * - Change country to 'US' or 'GB' for Nigerian users
 * - Add card_payments capability for cross-border recipients
 * - Remove the recipient service agreement for NG/GH/KE
 *
 * References:
 * - https://docs.stripe.com/connect/cross-border-payouts
 * - https://docs.stripe.com/connect/service-agreement-types
 */

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

type AccountLinkType = Stripe.AccountLinkCreateParams['type']

// Address info for Stripe KYC prefill
interface AddressInfo {
  line1?: string
  city?: string
  state?: string
  postal_code?: string
}

// Create Express account for a user
export async function createExpressAccount(
  userId: string,
  email: string,
  country: string,
  displayName?: string,
  address?: AddressInfo
) {
  // Check if user already has an account
  const profile = await db.profile.findUnique({ where: { userId } })

  if (profile?.stripeAccountId) {
    // Ensure provider is set (new "naked onboarding" may leave this null)
    if (!profile.paymentProvider) {
      await db.profile.update({
        where: { userId },
        data: { paymentProvider: 'stripe' },
      })
    }

    const account = await stripe.accounts.retrieve(profile.stripeAccountId)

    const needsOnboarding = !account.details_submitted
    const currentlyDue = account.requirements?.currently_due || []
    const disabledReason = account.requirements?.disabled_reason || null
    const needsUpdate = currentlyDue.length > 0 || Boolean(disabledReason)

    if (needsOnboarding || needsUpdate) {
      // Update account with current user info for prefill
      const nameParts = displayName?.trim().split(' ') || []
      const firstName = nameParts[0] || undefined
      const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined

      const updateData: Stripe.AccountUpdateParams = {
        email,
        individual: {
          email,
          first_name: firstName,
          last_name: lastName,
        },
      }

      // Add address if available
      if (address && (address.line1 || address.city)) {
        updateData.individual!.address = {
          line1: address.line1,
          city: address.city,
          state: address.state,
          postal_code: address.postal_code,
        }
      }

      try {
        await stripe.accounts.update(profile.stripeAccountId, updateData)
      } catch (err) {
        // Non-fatal: prefill is nice-to-have, don't block onboarding
        console.warn('[stripe] Failed to update account for prefill:', err)
      }

      const linkType = needsOnboarding ? 'account_onboarding' : 'account_update'
      const accountLink = await createAccountLink(profile.stripeAccountId, { type: linkType })
      return { accountId: profile.stripeAccountId, accountLink }
    }

    return { accountId: profile.stripeAccountId, accountLink: null, alreadyOnboarded: true }
  }

  // Parse name for KYC prefill
  const nameParts = displayName?.trim().split(' ') || []
  const firstName = nameParts[0] || undefined
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined

  // Create new Express account with prefilled KYC data
  // Use idempotency key to prevent duplicate accounts on retry/double-click
  const idempotencyKey = generateIdempotencyKey('acct_create', userId, email)

  // Check if this is a cross-border payout country (Nigeria, Ghana, Kenya)
  // These use the recipient service agreement - platform is business of record
  // User provides their local details and receives payouts to their local bank
  const isCrossBorder = isStripeCrossBorderSupported(country)

  // Build individual object with available prefill data
  const individual: Stripe.AccountCreateParams.Individual = {
    email,
    first_name: firstName,
    last_name: lastName,
  }

  // Add address prefill if available (reduces Stripe onboarding screens)
  if (address && (address.line1 || address.city)) {
    individual.address = {
      line1: address.line1,
      city: address.city,
      state: address.state,
      postal_code: address.postal_code,
      country, // Same as account country
    }
  }

  const accountParams: Stripe.AccountCreateParams = {
    type: 'express',
    email,
    country, // User's actual country (NG, GH, KE, etc.)
    capabilities: {
      transfers: { requested: true },
      // Cross-border accounts can only have transfers capability
      // Native accounts can also process card payments
      ...(isCrossBorder ? {} : { card_payments: { requested: true } }),
    },
    business_type: 'individual',
    individual,
    // Cross-border: use recipient service agreement
    // Platform is business of record, user just receives payouts
    ...(isCrossBorder && {
      tos_acceptance: {
        service_agreement: 'recipient',
      },
    }),
    settings: {
      payouts: {
        schedule: {
          interval: 'daily',
        },
      },
    },
  }

  const account = await stripe.accounts.create(accountParams, { idempotencyKey })

  // Save account ID to profile
  await db.profile.update({
    where: { userId },
    data: {
      stripeAccountId: account.id,
      paymentProvider: 'stripe',
      payoutStatus: 'pending',
    },
  })

  // Create account link for onboarding
  const accountLink = await createAccountLink(account.id, { type: 'account_onboarding' })

  return { accountId: account.id, accountLink }
}

// Create account link for onboarding
export async function createAccountLink(accountId: string, options: { type?: AccountLinkType } = {}) {
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: env.STRIPE_ONBOARDING_REFRESH_URL,
    return_url: env.STRIPE_ONBOARDING_RETURN_URL,
    type: options.type ?? 'account_onboarding',
    // Collect all required fields upfront, not just minimum
    collection_options: {
      fields: 'eventually_due', // Collect all fields that will eventually be required
    },
  })

  // Hardening: only ever redirect users to Stripe-hosted URLs.
  const url = accountLink.url
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('stripe.com')) {
      throw new Error(`Unexpected Stripe account link host: ${parsed.hostname}`)
    }
  } catch (err) {
    console.error('[stripe] Invalid account link URL returned by Stripe:', err)
    throw new Error('Failed to generate Stripe onboarding link')
  }

  return url
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
      }
    }
  }

  // Extract payout schedule details
  const payoutSettings = account.settings?.payouts?.schedule
  const payoutSchedule = {
    interval: payoutSettings?.interval || 'daily',
    delayDays: payoutSettings?.delay_days || 2, // Default T+2 if not specified
    weeklyAnchor: payoutSettings?.weekly_anchor || null,
    monthlyAnchor: payoutSettings?.monthly_anchor || null,
  }

  const result = {
    type: account.type, // 'standard', 'express', etc.
    country: account.country || null,
    defaultCurrency: account.default_currency || null,
    capabilities: account.capabilities || {},
    detailsSubmitted: account.details_submitted,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    bankAccount,
    payoutSchedule,
    requirements: {
      currentlyDue,
      eventuallyDue,
      pastDue: account.requirements?.past_due || [],
      pendingVerification,
      disabledReason: account.requirements?.disabled_reason || null,
      currentDeadline: account.requirements?.current_deadline
        ? new Date(account.requirements.current_deadline * 1000)
        : null,
    },
  }

  // Cache the result (non-blocking)
  redis.setex(cacheKey, STRIPE_STATUS_CACHE_TTL, JSON.stringify(result)).catch(() => { })

  return result
}

// Create Express Dashboard login link
export async function createExpressDashboardLink(stripeAccountId: string) {
  const loginLink = await stripe.accounts.createLoginLink(stripeAccountId)
  return loginLink.url
}

// Create checkout session for subscription

// Calculate billing cycle anchor timestamp from preferred payday
// Uses UTC date math to ensure consistent behavior across server timezones
//
// Example: payday = 1st, delayDays = 7
// - If today is Dec 15, next payday is Jan 1
// - Billing date = Jan 1 - 7 days = Dec 25
// - Returns Unix timestamp for Dec 25 at 00:00 UTC
//
// Note: delayDays defaults to 7, which is conservative for most Stripe accounts.
// Actual payout delay varies by account age/country (2-14 days).
export function calculateBillingAnchorFromPayday(preferredPayday: number, delayDays: number = 7): number {
  const now = new Date()

  // Use UTC to ensure consistent behavior across server timezones
  const currentYear = now.getUTCFullYear()
  const currentMonth = now.getUTCMonth()
  const currentDay = now.getUTCDate()

  // Find the next occurrence of the payday (in UTC)
  let paydayDate = new Date(Date.UTC(currentYear, currentMonth, preferredPayday))

  // If payday already passed this month, use next month
  const todayUTC = new Date(Date.UTC(currentYear, currentMonth, currentDay))
  if (paydayDate <= todayUTC) {
    paydayDate = new Date(Date.UTC(currentYear, currentMonth + 1, preferredPayday))
  }

  // Subtract delay days to get billing date
  // This correctly handles month boundaries (e.g., Jan 1 - 7 days = Dec 25)
  const billingTimestamp = paydayDate.getTime() - (delayDays * 24 * 60 * 60 * 1000)
  let billingDate = new Date(billingTimestamp)

  // If billing date is in the past (edge case), push to next cycle
  if (billingDate <= todayUTC) {
    paydayDate = new Date(Date.UTC(paydayDate.getUTCFullYear(), paydayDate.getUTCMonth() + 1, preferredPayday))
    billingDate = new Date(paydayDate.getTime() - (delayDays * 24 * 60 * 60 * 1000))
  }

  return Math.floor(billingDate.getTime() / 1000)
}

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
    feeMode: string         // 'absorb' | 'pass_to_subscriber' | 'split'
    feeEffectiveRate: number
    feeWasCapped?: boolean  // Optional - flat fee model has no caps
    // Split fee fields (v2 model)
    subscriberFeeCents?: number   // Subscriber's portion (4%)
    creatorFeeCents?: number      // Creator's portion (4%)
    baseAmountCents?: number      // Creator's set price
  }
  // Dispute evidence (for chargeback defense)
  evidenceMetadata?: {
    checkoutIp: string
    checkoutUserAgent: string
    checkoutAcceptLanguage: string
  }
}) {
  // Get creator's Stripe account and salary mode settings
  const creatorProfile = await db.profile.findUnique({
    where: { userId: params.creatorId },
  })

  if (!creatorProfile?.stripeAccountId) {
    throw new Error('Creator has not connected payments')
  }

  // Store validated stripeAccountId for type narrowing
  const stripeAccountId = creatorProfile.stripeAccountId

  // Calculate billing anchor for Salary Mode (aligned billing for predictable paydays)
  // Only applies to monthly subscriptions when salary mode is enabled
  let billingCycleAnchor: number | undefined

  // DEBUG: Log salary mode check
  console.log(`[stripe] Salary mode check for ${creatorProfile.username || params.creatorId}:`, {
    interval: params.interval,
    salaryModeEnabled: creatorProfile.salaryModeEnabled,
    preferredPayday: creatorProfile.preferredPayday,
    willSetAnchor: params.interval === 'month' && creatorProfile.salaryModeEnabled && creatorProfile.preferredPayday,
  })

  if (
    params.interval === 'month' &&
    creatorProfile.salaryModeEnabled &&
    creatorProfile.preferredPayday
  ) {
    // Use actual date math to correctly handle month boundaries
    // Default 7-day delay is conservative; actual payout timing varies by account
    billingCycleAnchor = calculateBillingAnchorFromPayday(creatorProfile.preferredPayday)
    console.log(`[stripe] Setting billing_cycle_anchor to ${billingCycleAnchor} (${new Date(billingCycleAnchor * 1000).toISOString()})`)
  }

  // Check for platform debit to recover (only for one-time payments)
  // SAFETY: Cap recovery at 50% of the Net Amount to ensure creator always gets paid something.
  // SAFETY: Absolute max cap (3000 = $30) to prevent draining huge amounts at once.
  // CURRENCY NOTE: Assuming platformDebitCents is roughly 1:1 with transaction currency for now.
  // In future: Convert USD debt to target currency using FX rates.
  const maxRecoverable = Math.max(0, Math.floor(params.netAmount * 0.50))
  const platformDebitToRecover = params.interval === 'one_time'
    ? Math.min(creatorProfile.platformDebitCents || 0, 3000, maxRecoverable)
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
  // Use requestId for request checkouts, viewId for public page, email, or fallback to random UUID
  const visitorIdentifier = params.requestId || params.subscriberEmail || params.viewId || crypto.randomUUID()
  const idempotencyKey = generateIdempotencyKey(
    'checkout',
    params.creatorId,
    visitorIdentifier,
    params.tierId,
    chargeAmount.toString(),
    params.interval
  )

  // Metadata for tracking fees through the system
  // IMPORTANT: Only include fields with valid values - empty strings fail webhook validation regex
  const metadata: Record<string, string> = {
    creatorId: params.creatorId,
    grossAmount: params.grossAmount.toString(),
    netAmount: params.netAmount.toString(),
    serviceFee: params.serviceFee.toString(),
    feeModel: params.feeMetadata?.feeModel || 'split_v1',
    feeMode: params.feeMetadata?.feeMode || 'split',
    platformDebitRecovered: platformDebitToRecover.toString(),
  }

  // Optional fields - only include if they have valid values
  if (params.tierId) metadata.tierId = params.tierId
  if (params.requestId) metadata.requestId = params.requestId
  if (params.viewId) metadata.viewId = params.viewId
  if (params.feeMetadata?.feeEffectiveRate !== undefined) {
    metadata.feeEffectiveRate = params.feeMetadata.feeEffectiveRate.toString()
  }
  if (params.feeMetadata?.feeWasCapped !== undefined) {
    metadata.feeWasCapped = params.feeMetadata.feeWasCapped ? 'true' : 'false'
  }
  // Split fee fields - only include if present (avoids empty string failing regex)
  if (params.feeMetadata?.subscriberFeeCents !== undefined) {
    metadata.subscriberFeeCents = params.feeMetadata.subscriberFeeCents.toString()
  }
  if (params.feeMetadata?.creatorFeeCents !== undefined) {
    metadata.creatorFeeCents = params.feeMetadata.creatorFeeCents.toString()
  }
  if (params.feeMetadata?.baseAmountCents !== undefined) {
    metadata.baseAmountCents = params.feeMetadata.baseAmountCents.toString()
  }
  // Dispute evidence - only include if present
  if (params.evidenceMetadata?.checkoutIp) {
    metadata.checkoutIp = params.evidenceMetadata.checkoutIp
  }
  if (params.evidenceMetadata?.checkoutUserAgent) {
    metadata.checkoutUserAgent = params.evidenceMetadata.checkoutUserAgent
  }
  if (params.evidenceMetadata?.checkoutAcceptLanguage) {
    metadata.checkoutAcceptLanguage = params.evidenceMetadata.checkoutAcceptLanguage
  }

  // Total application fee = service fee + debit recovery
  const totalApplicationFee = params.serviceFee + platformDebitToRecover

  // Create checkout session with circuit breaker protection
  // For both one-time and subscriptions, use application_fee_amount (fixed fee)
  //
  // BILLING DESCRIPTOR: Use suffix for recognizable bank statement entry
  // This helps prevent chargebacks from subscribers who don't recognize the charge.
  // Full descriptor = "NATEPAY* " + creator name (max 22 chars total)
  // Stripe requires suffix to be max 22 chars and alphanumeric
  const descriptorSuffix = creatorProfile.displayName
    .replace(/[^a-zA-Z0-9 ]/g, '') // Remove special chars
    .substring(0, 18) // Leave room for "NATEPAY* " prefix
    .trim()
    .toUpperCase() || 'PAYMENT'

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
          // Billing descriptor for card statements - helps prevent chargebacks
          statement_descriptor_suffix: descriptorSuffix,
          // Include metadata so payment_intent.payment_failed can attribute failures
          metadata,
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
          // Billing descriptor for subscription invoices - reduces chargebacks
          // Shows "NATEPAY* CREATOR" on bank statements for renewals
          description: `Subscription to ${descriptorSuffix}`,
          // Salary Mode: Align billing to creator's preferred schedule
          // First charge happens immediately at signup (prorated to anchor).
          // Subsequent charges align to billing_cycle_anchor (7 days before payday).
          // NOTE: We do NOT set proration_behavior: 'none' because that creates a $0 trial
          // until the anchor date, which is NOT what we want for subscriber payments.
          ...(billingCycleAnchor && {
            billing_cycle_anchor: billingCycleAnchor,
          }),
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

// Get account balance with upcoming payout estimate
// Returns balance for primary currency only (first in available array)
// Multi-currency accounts: only sums amounts matching primary currency to avoid mixing
export async function getAccountBalance(stripeAccountId: string) {
  // Stub mode: return mock balance for E2E tests
  if (env.PAYMENTS_MODE === 'stub') {
    return {
      available: 10000, // $100.00
      pending: 5000,    // $50.00
      currency: 'usd',
      nextPayoutDate: null,
      nextPayoutAmount: null,
    }
  }

  const [balance, upcomingPayouts] = await Promise.all([
    stripe.balance.retrieve({ stripeAccount: stripeAccountId }),
    // Get pending/in_transit payouts to show upcoming payout date
    stripe.payouts.list(
      { limit: 1, status: 'pending' },
      { stripeAccount: stripeAccountId }
    ).catch(() => ({ data: [] })), // Ignore errors - not critical
  ])

  // Get the primary currency from the first available balance entry
  // For cross-border accounts (NG, KE, GH, ZA), this will be USD
  const primaryCurrency = balance.available[0]?.currency?.toLowerCase() || 'usd'

  // Only sum balances matching primary currency to avoid mixing currencies
  // (e.g., 100 USD + 50000 NGN would incorrectly show 50100 if we sum blindly)
  const available = balance.available
    .filter(b => b.currency === primaryCurrency)
    .reduce((sum, b) => sum + b.amount, 0)

  const pending = balance.pending
    .filter(b => b.currency === primaryCurrency)
    .reduce((sum, b) => sum + b.amount, 0)

  // Get upcoming payout info if there's a pending payout
  const upcomingPayout = upcomingPayouts.data[0]
  const nextPayoutDate = upcomingPayout?.arrival_date
    ? new Date(upcomingPayout.arrival_date * 1000)
    : null
  const nextPayoutAmount = upcomingPayout?.amount || null

  return {
    available,
    pending,
    currency: primaryCurrency.toUpperCase(),
    nextPayoutDate,
    nextPayoutAmount,
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
 * FX lookup result - distinguishes between different outcomes for proper retry handling
 */
export type FxLookupResult =
  | { status: 'fx_found'; data: { payoutCurrency: string; payoutAmountCents: number; exchangeRate: number; originalCurrency: string; originalAmountCents: number } }
  | { status: 'no_fx' }      // Same currency, no conversion needed - safe to mark as checked
  | { status: 'pending' }    // Transfer not ready yet - should retry later
  | { status: 'error' }      // Stripe API error - should retry later

/**
 * Get FX conversion data for a destination charge.
 *
 * With destination charges, the charge lives on the PLATFORM account, and a
 * transfer is automatically created to the connected account. The FX conversion
 * happens on the transfer, not the charge.
 *
 * Flow:
 * 1. Charge created on platform (USD)
 * 2. Automatic transfer to connected account
 * 3. Transfer's balance_transaction on connected account has exchange_rate (USD → NGN)
 *
 * @param chargeId - The Stripe charge ID (ch_xxx) on the platform
 * @param stripeAccountId - The connected account ID that received the transfer
 * @returns FxLookupResult with status indicating outcome
 */
export async function getChargeFxData(chargeId: string, stripeAccountId: string): Promise<FxLookupResult> {
  try {
    // Step 1: Get the charge from the PLATFORM (not connected account)
    // With destination charges, the charge lives on the platform
    const charge = await stripe.charges.retrieve(chargeId, {
      expand: ['transfer'],
    })

    // Step 2: Get the transfer ID
    // For destination charges, Stripe auto-creates a transfer to the connected account
    const transferId = typeof charge.transfer === 'string'
      ? charge.transfer
      : charge.transfer?.id

    if (!transferId) {
      // No transfer yet - may still be processing
      console.log(`[getChargeFxData] No transfer found for charge ${chargeId} - pending`)
      return { status: 'pending' }
    }

    // Step 3: Get the transfer's balance_transaction on the CONNECTED account
    // This is where the FX conversion data lives
    const transfer = await stripe.transfers.retrieve(transferId, {
      expand: ['destination_payment.balance_transaction'],
    })

    // The destination_payment is the payment object on the connected account
    let destinationPayment = transfer.destination_payment as Stripe.Charge | null

    // Fallback: If expansion didn't work (returned string ID), fetch directly
    if (typeof transfer.destination_payment === 'string') {
      try {
        destinationPayment = await stripe.charges.retrieve(
          transfer.destination_payment,
          { expand: ['balance_transaction'] },
          { stripeAccount: stripeAccountId }
        )
      } catch (err) {
        console.log(`[getChargeFxData] Fallback fetch failed for destination_payment ${transfer.destination_payment}`)
        return { status: 'error' }
      }
    }

    if (!destinationPayment) {
      // Transfer exists but destination_payment not yet created - still processing
      console.log(`[getChargeFxData] No destination_payment for transfer ${transferId} - pending`)
      return { status: 'pending' }
    }

    let balanceTransaction = destinationPayment.balance_transaction as Stripe.BalanceTransaction | null

    // Fallback: If balance_transaction expansion didn't work, fetch directly
    if (typeof destinationPayment.balance_transaction === 'string') {
      try {
        balanceTransaction = await stripe.balanceTransactions.retrieve(
          destinationPayment.balance_transaction,
          {},
          { stripeAccount: stripeAccountId }
        )
      } catch (err) {
        console.log(`[getChargeFxData] Fallback fetch failed for balance_transaction`)
        return { status: 'error' }
      }
    }

    if (!balanceTransaction) {
      // Balance transaction not yet created - still processing
      console.log(`[getChargeFxData] No balance_transaction for destination_payment - pending`)
      return { status: 'pending' }
    }

    // Check if there was currency conversion
    // exchange_rate is present when the transfer currency differs from the account's settlement currency
    if (!balanceTransaction.exchange_rate) {
      // No FX conversion (same currency) - this is a confirmed final state
      console.log(`[getChargeFxData] Same currency, no FX conversion for charge ${chargeId}`)
      return { status: 'no_fx' }
    }

    // Return FX data:
    // - originalCurrency: What subscriber paid (charge currency, e.g., USD)
    // - originalAmountCents: Gross charge amount (what subscriber paid)
    // - payoutCurrency: Creator's local currency (e.g., NGN)
    // - payoutAmountCents: Amount after FX conversion (using net to exclude Stripe fees)
    // - exchangeRate: The conversion rate applied
    return {
      status: 'fx_found',
      data: {
        payoutCurrency: balanceTransaction.currency.toUpperCase(),
        payoutAmountCents: balanceTransaction.net, // Net after any Stripe fees
        exchangeRate: balanceTransaction.exchange_rate,
        originalCurrency: charge.currency.toUpperCase(),
        originalAmountCents: charge.amount, // Gross amount subscriber paid
      },
    }
  } catch (err) {
    console.error(`[getChargeFxData] Failed to get FX data for charge ${chargeId}:`, err)
    return { status: 'error' }
  }
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
