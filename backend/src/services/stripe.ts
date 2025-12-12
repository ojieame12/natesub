import Stripe from 'stripe'
import { env } from '../config/env.js'
import { db } from '../db/client.js'
import { getPlatformFeePercent, type UserPurpose } from './pricing.js'

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-11-17.clover',
})

// Create Express account for a user
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
      const accountLink = await createAccountLink(profile.stripeAccountId)
      return { accountId: profile.stripeAccountId, accountLink }
    }

    return { accountId: profile.stripeAccountId, accountLink: null, alreadyOnboarded: true }
  }

  // Parse name for KYC prefill
  const nameParts = displayName?.trim().split(' ') || []
  const firstName = nameParts[0] || undefined
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined

  // Create new Express account with prefilled KYC data
  const account = await stripe.accounts.create({
    type: 'express',
    email,
    country,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
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
  })

  // Save account ID to profile
  await db.profile.update({
    where: { userId },
    data: {
      stripeAccountId: account.id,
      payoutStatus: 'pending',
    },
  })

  // Create account link for onboarding
  const accountLink = await createAccountLink(account.id)

  return { accountId: account.id, accountLink }
}

// Create account link for onboarding
export async function createAccountLink(accountId: string) {
  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: env.STRIPE_ONBOARDING_REFRESH_URL,
    return_url: env.STRIPE_ONBOARDING_RETURN_URL,
    type: 'account_onboarding',
    // Collect all required fields upfront, not just minimum
    collection_options: {
      fields: 'eventually_due', // Collect all fields that will eventually be required
      future_requirements: 'include', // Include future requirements too
    },
  })

  return accountLink.url
}

// Get account status with detailed requirements
export async function getAccountStatus(stripeAccountId: string) {
  const account = await stripe.accounts.retrieve(stripeAccountId, {
    expand: ['external_accounts'],
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

  return {
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
  requestId?: string // For tracking request-based checkouts
  amount: number // in cents
  currency: string
  interval: 'month' | 'one_time'
  successUrl: string
  cancelUrl: string
  subscriberEmail?: string
}) {
  // Get creator's Stripe account and purpose for fee calculation
  const creatorProfile = await db.profile.findUnique({
    where: { userId: params.creatorId },
  })

  if (!creatorProfile?.stripeAccountId) {
    throw new Error('Creator has not connected payments')
  }

  // Calculate platform fee based on creator's purpose (personal: 10%, service: 8%)
  const platformFeePercent = getPlatformFeePercent(creatorProfile.purpose as UserPurpose)
  const applicationFeeAmount = Math.round(params.amount * (platformFeePercent / 100))

  // Create price
  const priceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData = {
    currency: params.currency.toLowerCase(),
    unit_amount: params.amount,
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

  // Create checkout session
  const session = await stripe.checkout.sessions.create({
    mode: params.interval === 'month' ? 'subscription' : 'payment',
    line_items: [
      {
        price_data: priceData,
        quantity: 1,
      },
    ],
    payment_intent_data: params.interval === 'one_time' ? {
      application_fee_amount: applicationFeeAmount,
      transfer_data: {
        destination: creatorProfile.stripeAccountId,
      },
    } : undefined,
    subscription_data: params.interval === 'month' ? {
      application_fee_percent: platformFeePercent,
      transfer_data: {
        destination: creatorProfile.stripeAccountId,
      },
    } : undefined,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    customer_email: params.subscriberEmail,
    metadata: {
      creatorId: params.creatorId,
      tierId: params.tierId || '',
      requestId: params.requestId || '',  // Track which request triggered this checkout
    },
  })

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
