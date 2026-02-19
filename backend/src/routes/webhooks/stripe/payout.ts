import Stripe from 'stripe'
import { db } from '../../../db/client.js'
import { notifyPayoutFailed } from '../../../services/notifications.js'
import { alertPayoutFailed } from '../../../services/slack.js'
import { syncCreatorBalance, PAYOUT_STATUS } from '../../../services/balanceSync.js'
import { invalidatePublicProfileCache } from '../../../utils/cache.js'

// Map Stripe payout status to our status constants
function mapStripePayoutStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case 'paid':
      return PAYOUT_STATUS.PAID
    case 'in_transit':
      return PAYOUT_STATUS.IN_TRANSIT
    case 'failed':
      return PAYOUT_STATUS.FAILED
    case 'canceled':
      return PAYOUT_STATUS.CANCELED
    case 'pending':
    default:
      return PAYOUT_STATUS.PENDING
  }
}

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

  // Use actual payout status from Stripe (might already be 'in_transit')
  const payoutStatus = mapStripePayoutStatus(payout.status)

  // Update profile with payout info
  await db.profile.update({
    where: { id: profile.id },
    data: {
      lastPayoutAmountCents: payout.amount,
      lastPayoutAt: new Date(payout.created * 1000),
      lastPayoutStatus: payoutStatus,
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
        status: payoutStatus,
      },
    },
  })

  // Sync balance to reflect the pending payout (force = true bypasses cooldown)
  await syncCreatorBalance(profile.userId, true).catch(err =>
    console.error(`[payout.created] Balance sync failed:`, err)
  )

  console.log(`[payout.created] Payout initiated for creator ${profile.userId}: ${payout.amount} ${payout.currency} (status: ${payoutStatus})`)
}

// Handle payout.updated - when payout status changes (e.g. pending → in_transit)
// This captures the real-time "In Transit" state from Stripe
export async function handlePayoutUpdated(event: Stripe.Event) {
  const payout = event.data.object as Stripe.Payout

  // Get account ID from event (Connect webhooks include the account)
  const accountId = event.account as string
  if (!accountId) {
    console.log('[payout.updated] No account ID found')
    return
  }

  // Find the creator by their Stripe account
  const profile = await db.profile.findFirst({
    where: { stripeAccountId: accountId },
  })

  if (!profile) {
    console.log(`[payout.updated] No profile found for account ${accountId}`)
    return
  }

  // Map the Stripe status to our status
  const payoutStatus = mapStripePayoutStatus(payout.status)

  // Update profile with new payout status
  await db.profile.update({
    where: { id: profile.id },
    data: {
      lastPayoutStatus: payoutStatus,
      // Update arrival date if it changed
      ...(payout.arrival_date && {
        lastPayoutAt: new Date(payout.arrival_date * 1000),
      }),
    },
  })

  // If transitioning to in_transit, create an activity so the user sees the update
  if (payoutStatus === PAYOUT_STATUS.IN_TRANSIT) {
    await db.activity.create({
      data: {
        userId: profile.userId,
        type: 'payout_in_transit',
        payload: {
          payoutId: payout.id,
          amount: payout.amount,
          currency: payout.currency.toUpperCase(),
          arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null,
          status: payoutStatus,
        },
      },
    })
  }

  console.log(`[payout.updated] Payout status updated for creator ${profile.userId}: ${payoutStatus}`)
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
      lastPayoutStatus: PAYOUT_STATUS.PAID,
      lastPayoutAmountCents: payout.amount,
      lastPayoutAt: payout.arrival_date ? new Date(payout.arrival_date * 1000) : new Date(),
    },
  })

  // Invalidate public profile cache (payoutStatus affects paymentsReady)
  if (profile.username) {
    await invalidatePublicProfileCache(profile.username)
  }

  // Sync balance to reflect completed payout (force = true bypasses cooldown)
  await syncCreatorBalance(profile.userId, true).catch(err =>
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
        currency: payout.currency.toUpperCase(),
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
      lastPayoutStatus: PAYOUT_STATUS.FAILED,
    },
  })

  // Invalidate public profile cache (payoutStatus affects paymentsReady)
  if (profile.username) {
    await invalidatePublicProfileCache(profile.username)
  }

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
