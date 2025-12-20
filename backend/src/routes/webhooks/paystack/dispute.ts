/**
 * Paystack Dispute/Chargeback Webhook Handlers
 *
 * Handles charge.dispute.create and charge.dispute.resolve events.
 * Mirrors the Stripe dispute handler pattern but adapted for Paystack's event structure.
 */

import { db } from '../../../db/client.js'
import { sendDisputeCreatedEmail, sendDisputeResolvedEmail } from '../../../services/email.js'
import { alertDisputeCreated, alertDisputeResolved } from '../../../services/slack.js'

interface PaystackDisputeData {
  id: number | string
  reference: string
  amount: number // In smallest currency unit (kobo for NGN)
  currency: string
  reason?: string
  status: string
  resolution?: 'won' | 'lost' | 'pending'
  createdAt?: string
}

/**
 * Handle Paystack dispute/chargeback created
 * Called when a subscriber files a chargeback with their bank
 */
export async function handlePaystackDisputeCreated(data: PaystackDisputeData, eventId: string) {
  const { id: disputeId, reference, amount, currency, reason, status } = data

  console.log(`[paystack] Dispute created: ${disputeId}, reference: ${reference}`)

  // Find original payment by transaction reference
  const originalPayment = await db.payment.findFirst({
    where: {
      paystackTransactionRef: reference,
      type: { in: ['recurring', 'one_time'] },
      status: 'succeeded',
    },
    include: {
      subscription: {
        select: { id: true, creatorId: true, subscriberId: true, ltvCents: true, interval: true },
      },
    },
  })

  if (!originalPayment?.subscription) {
    console.log(`[paystack] Dispute created but no original payment found: ${reference}`)
    return
  }

  // Idempotency check - don't create duplicate dispute records
  const existingDispute = await db.payment.findFirst({
    where: { paystackDisputeId: String(disputeId) },
  })
  if (existingDispute) {
    console.log(`[paystack] Dispute ${disputeId} already processed, skipping`)
    return
  }

  const subscription = originalPayment.subscription

  // Create dispute payment record (funds held)
  await db.payment.create({
    data: {
      subscriptionId: subscription.id,
      creatorId: originalPayment.creatorId,
      subscriberId: originalPayment.subscriberId,
      amountCents: -amount, // Negative - funds held
      currency: currency?.toUpperCase() || 'NGN',
      feeCents: 0,
      netCents: -amount,
      type: subscription.interval === 'month' ? 'recurring' : 'one_time',
      status: 'disputed',
      paystackDisputeId: String(disputeId),
      paystackEventId: eventId,
      paystackTransactionRef: reference,
    },
  })

  // Decrement LTV when dispute is opened (funds are held)
  const currentLtv = subscription.ltvCents || 0
  const decrementAmount = Math.min(amount, currentLtv)
  if (decrementAmount > 0) {
    await db.subscription.update({
      where: { id: subscription.id },
      data: { ltvCents: { decrement: decrementAmount } },
    })
  }

  // Track dispute count on subscriber (for blocking repeat offenders)
  if (subscription.subscriberId) {
    const subscriber = await db.user.findUnique({
      where: { id: subscription.subscriberId },
      select: { disputeCount: true },
    })

    const newDisputeCount = (subscriber?.disputeCount || 0) + 1

    await db.user.update({
      where: { id: subscription.subscriberId },
      data: {
        disputeCount: newDisputeCount,
        // Block after 2 disputes (industry standard pattern-based blocking)
        ...(newDisputeCount >= 2 && {
          blockedReason: 'Multiple chargebacks filed',
        }),
      },
    })
  }

  // Create activity event for creator
  await db.activity.create({
    data: {
      userId: subscription.creatorId,
      type: 'dispute_created',
      payload: {
        subscriptionId: subscription.id,
        amount,
        currency: currency?.toUpperCase() || 'NGN',
        reason: reason || 'Unknown',
        status,
        paystackDisputeId: String(disputeId),
      },
    },
  })

  // Send email notification to creator
  const creator = await db.user.findUnique({
    where: { id: subscription.creatorId },
    include: { profile: { select: { displayName: true } } },
  })

  if (creator?.email && creator.profile?.displayName) {
    await sendDisputeCreatedEmail(
      creator.email,
      creator.profile.displayName,
      amount,
      currency?.toUpperCase() || 'NGN',
      reason || 'Unknown'
    )
  }

  // Send Slack alert (non-blocking)
  const subscriber = await db.user.findUnique({
    where: { id: subscription.subscriberId },
    select: { email: true },
  })

  alertDisputeCreated({
    creatorEmail: creator?.email || 'unknown',
    creatorName: creator?.profile?.displayName || 'Unknown Creator',
    subscriberEmail: subscriber?.email,
    amount,
    currency: currency?.toUpperCase() || 'NGN',
    reason: reason || 'Unknown',
    stripeDisputeId: `paystack_${disputeId}`, // Prefix to distinguish
  }).catch((err) => console.error('[slack] Failed to send dispute alert:', err))

  console.log(`[paystack] Dispute recorded: ${disputeId}, amount: ${amount}, creator: ${subscription.creatorId}`)
}

/**
 * Handle Paystack dispute resolved
 * Called when the dispute is resolved (won by merchant or lost)
 */
export async function handlePaystackDisputeResolved(data: PaystackDisputeData, eventId: string) {
  const { id: disputeId, amount, currency, reason, resolution } = data

  console.log(`[paystack] Dispute resolved: ${disputeId}, resolution: ${resolution}`)

  // Find the open dispute payment by Paystack dispute ID
  const disputePayment = await db.payment.findFirst({
    where: { paystackDisputeId: String(disputeId) },
    include: {
      subscription: {
        select: { id: true, creatorId: true, stripeSubscriptionId: true, status: true },
      },
    },
  })

  if (!disputePayment) {
    console.log(`[paystack] Dispute resolved but no dispute payment found: ${disputeId}`)
    return
  }

  // Already resolved? Skip
  if (disputePayment.status === 'dispute_won' || disputePayment.status === 'dispute_lost') {
    console.log(`[paystack] Dispute ${disputeId} already resolved, skipping`)
    return
  }

  const won = resolution === 'won'
  const newStatus = won ? 'dispute_won' : 'dispute_lost'

  // Update the dispute payment status
  await db.payment.update({
    where: { id: disputePayment.id },
    data: { status: newStatus },
  })

  // If won, restore the LTV
  if (won && disputePayment.subscriptionId) {
    await db.subscription.update({
      where: { id: disputePayment.subscriptionId },
      data: { ltvCents: { increment: amount } },
    })
  }

  // If lost, auto-cancel the subscription (industry standard)
  if (!won && disputePayment.subscription) {
    const subscription = disputePayment.subscription

    if (subscription.status !== 'canceled') {
      // Update local record to canceled
      await db.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'canceled',
          canceledAt: new Date(),
          cancelAtPeriodEnd: false,
        },
      })

      // Log the auto-cancellation
      await db.activity.create({
        data: {
          userId: subscription.creatorId,
          type: 'subscription_auto_canceled',
          payload: {
            subscriptionId: subscription.id,
            reason: 'dispute_lost',
            paystackDisputeId: String(disputeId),
          },
        },
      })

      console.log(`[paystack] Subscription ${subscription.id} auto-canceled due to dispute loss`)
    }
  }

  // Create activity event for creator
  await db.activity.create({
    data: {
      userId: disputePayment.creatorId,
      type: won ? 'dispute_won' : 'dispute_lost',
      payload: {
        subscriptionId: disputePayment.subscriptionId,
        amount,
        currency: currency?.toUpperCase() || 'NGN',
        reason: reason || 'Unknown',
        resolution,
        paystackDisputeId: String(disputeId),
      },
    },
  })

  // Send email notification to creator
  const creator = await db.user.findUnique({
    where: { id: disputePayment.creatorId },
    include: { profile: { select: { displayName: true } } },
  })

  if (creator?.email && creator.profile?.displayName) {
    await sendDisputeResolvedEmail(
      creator.email,
      creator.profile.displayName,
      amount,
      currency?.toUpperCase() || 'NGN',
      won
    )
  }

  // Send Slack alert for resolution (non-blocking)
  alertDisputeResolved({
    creatorEmail: creator?.email || 'unknown',
    creatorName: creator?.profile?.displayName || 'Unknown Creator',
    amount,
    currency: currency?.toUpperCase() || 'NGN',
    won,
    stripeDisputeId: `paystack_${disputeId}`,
  }).catch((err) => console.error('[slack] Failed to send dispute resolution alert:', err))

  console.log(`[paystack] Dispute ${disputeId} marked as ${newStatus}`)
}
