import Stripe from 'stripe'
import { db } from '../../../db/client.js'
import { stripe } from '../../../services/stripe.js'

// Handle dispute/chargeback created
export async function handleDisputeCreated(event: Stripe.Event) {
  const dispute = event.data.object as Stripe.Dispute

  const stripeCustomerId = dispute.charge
    ? (await stripe.charges.retrieve(dispute.charge as string)).customer as string
    : null

  if (!stripeCustomerId) return

  const subscription = await db.subscription.findFirst({
    where: { stripeCustomerId },
    orderBy: { createdAt: 'desc' },
  })

  if (!subscription) return

  // Create dispute payment record (funds held)
  await db.payment.create({
    data: {
      subscriptionId: subscription.id,
      creatorId: subscription.creatorId,
      subscriberId: subscription.subscriberId,
      amountCents: -dispute.amount, // Negative - funds held
      currency: dispute.currency.toUpperCase(),
      feeCents: 0,
      netCents: -dispute.amount,
      type: subscription.interval === 'month' ? 'recurring' : 'one_time',
      status: 'disputed', // Dispute is open, funds held - use 'disputed' for payroll tracking
      stripeDisputeId: dispute.id, // Track dispute for later resolution
      stripeChargeId: dispute.charge as string || null,
      stripeEventId: event.id,
    },
  })

  // Decrement LTV when dispute is opened (funds are held)
  // This will be restored if dispute is won in handleDisputeClosed
  const currentLtv = subscription.ltvCents || 0
  const decrementAmount = Math.min(dispute.amount, currentLtv)
  if (decrementAmount > 0) {
    await db.subscription.update({
      where: { id: subscription.id },
      data: { ltvCents: { decrement: decrementAmount } },
    })
  }

  // Create activity event
  await db.activity.create({
    data: {
      userId: subscription.creatorId,
      type: 'dispute_created',
      payload: {
        subscriptionId: subscription.id,
        amount: dispute.amount,
        currency: dispute.currency,
        reason: dispute.reason,
        status: dispute.status,
      },
    },
  })
}

// Handle dispute closed (won or lost)
export async function handleDisputeClosed(event: Stripe.Event) {
  const dispute = event.data.object as Stripe.Dispute

  // Find the open dispute payment by dispute ID (more reliable than amount matching)
  let disputePayment = await db.payment.findUnique({
    where: { stripeDisputeId: dispute.id },
  })

  // Fallback to amount-based matching for older disputes without ID
  if (!disputePayment) {
    disputePayment = await db.payment.findFirst({
      where: {
        status: 'pending',
        amountCents: -dispute.amount,
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  if (!disputePayment) return

  const won = dispute.status === 'won'

  // Update the dispute payment status with proper semantics
  // dispute_won = creator won, funds returned
  // dispute_lost = creator lost, funds deducted
  await db.payment.update({
    where: { id: disputePayment.id },
    data: {
      status: won ? 'dispute_won' : 'dispute_lost',
    },
  })

  // If won, restore the LTV
  if (won) {
    await db.subscription.update({
      where: { id: disputePayment.subscriptionId! },
      data: {
        ltvCents: { increment: dispute.amount },
      },
    })
  }

  // Create activity event
  await db.activity.create({
    data: {
      userId: disputePayment.creatorId,
      type: won ? 'dispute_won' : 'dispute_lost',
      payload: {
        subscriptionId: disputePayment.subscriptionId,
        amount: dispute.amount,
        currency: dispute.currency,
        reason: dispute.reason,
      },
    },
  })
}
