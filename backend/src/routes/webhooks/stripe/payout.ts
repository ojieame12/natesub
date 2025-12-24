import Stripe from 'stripe'
import { db } from '../../../db/client.js'
import { notifyPayoutFailed } from '../../../services/notifications.js'
import { alertPayoutFailed } from '../../../services/slack.js'
import { syncCreatorBalance } from '../../../services/balanceSync.js'

// Handle payout.created - when Stripe initiates a payout to connected account
// This creates visibility into "money on the way" state
export async function handlePayoutCreated(event: Stripe.Event) {
  const payout = event.data.object as Stripe.Payout

  // Get account ID from event (Connect webhooks include the account)
  const accountId = event.account as string
  if (!accountId) {
    console.log('[payout.created] No account ID found')
    return
  }

  // Find the creator by their Stripe account
  const profile = await db.profile.findFirst({
    where: { stripeAccountId: accountId },
  })

  if (!profile) {
    console.log(`[payout.created] No profile found for account ${accountId}`)
    return
  }

  // Update profile with pending payout info
  await db.profile.update({
    where: { id: profile.id },
    data: {
      lastPayoutAmountCents: payout.amount,
      lastPayoutAt: new Date(payout.created * 1000),
      lastPayoutStatus: 'pending',
    },
  })

  // Create activity event so creator sees "Payout Initiated" in their feed
  await db.activity.create({
    data: {
      userId: profile.userId,
      type: 'payout_initiated',
      payload: {
        payoutId: payout.id,
        amount: payout.amount,
        currency: payout.currency.toUpperCase(),
        arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null,
        method: payout.method, // 'standard' or 'instant'
      },
    },
  })

  // Sync balance to reflect the pending payout
  await syncCreatorBalance(profile.userId).catch(err =>
    console.error(`[payout.created] Balance sync failed:`, err)
  )

  console.log(`[payout.created] Payout initiated for creator ${profile.userId}: ${payout.amount} ${payout.currency}`)
}

// Handle payout.paid - when automatic payout to connected account succeeds
// Creates a Payment record so payroll can accurately show payout status
export async function handlePayoutPaid(event: Stripe.Event) {
  const payout = event.data.object as Stripe.Payout

  // Payout object has account as a string when using Connect
  const accountId = (payout as any).destination || (event.account as string)
  if (!accountId) {
    console.log('[payout.paid] No account ID found')
    return
  }

  // Find the creator by their Stripe account
  const profile = await db.profile.findFirst({
    where: { stripeAccountId: accountId },
  })

  if (!profile) {
    console.log(`[payout.paid] No profile found for account ${accountId}`)
    return
  }

  // Check if we already recorded this payout (idempotency)
  const existing = await db.payment.findFirst({
    where: {
      stripePaymentIntentId: payout.id,
      type: 'payout',
    },
  })

  if (existing) {
    console.log(`[payout.paid] Payout ${payout.id} already recorded`)
    return
  }

  // Create a Payment record with type 'payout'
  // This allows payroll to accurately determine paid vs pending status
  await db.payment.create({
    data: {
      creatorId: profile.userId,
      type: 'payout',
      status: 'succeeded',
      amountCents: payout.amount,
      currency: payout.currency.toUpperCase(),
      netCents: payout.amount, // Payout is what creator receives
      feeCents: 0, // No fee on payout itself
      occurredAt: payout.arrival_date ? new Date(payout.arrival_date * 1000) : new Date(),
      stripePaymentIntentId: payout.id, // Store payout ID for reference
      stripeEventId: event.id,
    },
  })

  // Update profile payout status and last payout info
  await db.profile.update({
    where: { id: profile.id },
    data: {
      payoutStatus: 'active',
      lastPayoutStatus: 'paid',
      lastPayoutAmountCents: payout.amount,
      lastPayoutAt: payout.arrival_date ? new Date(payout.arrival_date * 1000) : new Date(),
    },
  })

  // Sync balance to reflect completed payout (pending decreases, available may decrease)
  await syncCreatorBalance(profile.userId).catch(err =>
    console.error(`[payout.paid] Balance sync failed:`, err)
  )

  // Create activity event so creator sees "Payout Received" in their feed
  await db.activity.create({
    data: {
      userId: profile.userId,
      type: 'payout_completed',
      payload: {
        payoutId: payout.id,
        amount: payout.amount,
        currency: payout.currency.toUpperCase(),
        arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null,
      },
    },
  })

  console.log(`[payout.paid] Recorded successful payout for creator ${profile.userId}: ${payout.amount} ${payout.currency}`)
}

// Handle payout.failed - when automatic payout to connected account fails
export async function handlePayoutFailed(event: Stripe.Event) {
  const payout = event.data.object as Stripe.Payout

  // Payout object has account as a string when using Connect
  const accountId = (payout as any).destination || (event.account as string)
  if (!accountId) {
    console.log('[payout.failed] No account ID found')
    return
  }

  // Find the creator by their Stripe account
  const profile = await db.profile.findFirst({
    where: { stripeAccountId: accountId },
  })

  if (!profile) {
    console.log(`[payout.failed] No profile found for account ${accountId}`)
    return
  }

  // Get creator details for notifications
  const creator = await db.user.findUnique({
    where: { id: profile.userId },
    select: { email: true },
  })

  // Create activity event to notify creator
  await db.activity.create({
    data: {
      userId: profile.userId,
      type: 'payout_failed',
      payload: {
        payoutId: payout.id,
        amount: payout.amount,
        currency: payout.currency,
        failureCode: payout.failure_code,
        failureMessage: payout.failure_message,
        arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null,
      },
    },
  })

  // Update profile payout status to indicate an issue
  await db.profile.update({
    where: { id: profile.id },
    data: {
      payoutStatus: 'restricted',
      lastPayoutStatus: 'failed',
    },
  })

  // Send real-time notification (WhatsApp/SMS/Email)
  notifyPayoutFailed(
    profile.userId,
    payout.amount,
    payout.currency.toUpperCase()
  ).catch(err => console.error('[payout.failed] Notification failed:', err))

  // Alert ops team via Slack
  alertPayoutFailed({
    creatorEmail: creator?.email || 'unknown',
    creatorName: profile.displayName || 'Unknown Creator',
    amount: payout.amount,
    currency: payout.currency.toUpperCase(),
    error: payout.failure_message || 'Payout failed',
    stripePayoutId: payout.id,
  }).catch(err => console.error('[slack] Failed to send payout failed alert:', err))

  console.log(`[payout.failed] Recorded failed payout for creator ${profile.userId}: ${payout.failure_message}`)
}
