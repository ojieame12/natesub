import Stripe from 'stripe'
import { db } from '../../../db/client.js'
import { notifyPayoutFailed } from '../../../services/notifications.js'
import { alertPayoutFailed } from '../../../services/slack.js'

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
    data: { payoutStatus: 'restricted' },
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
