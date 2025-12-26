import Stripe from 'stripe'
import { db } from '../../../db/client.js'
import { stripe, getAccountBalance } from '../../../services/stripe.js'
import { cancelSubscription } from '../../../services/stripe.js'
import { sendDisputeCreatedEmail, sendDisputeResolvedEmail } from '../../../services/email.js'
import { alertDisputeCreated, alertDisputeResolved, alertPlatformLiability } from '../../../services/slack.js'
import { convertLocalCentsToUSD } from '../../../services/fx.js'

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

  // Find the original payment to copy fee breakdown
  const originalPayment = await db.payment.findFirst({
    where: {
      subscriptionId: subscription.id,
      stripeChargeId: dispute.charge as string,
      status: 'succeeded',
    },
  })

  // Calculate proportional fee breakdown if original payment has split fees
  let creatorFeeCents: number | null = null
  let subscriberFeeCents: number | null = null
  let netCents = -dispute.amount

  if (originalPayment && originalPayment.grossCents && originalPayment.grossCents > 0) {
    const disputeRatio = dispute.amount / originalPayment.grossCents

    if (originalPayment.creatorFeeCents !== null) {
      creatorFeeCents = -Math.round(originalPayment.creatorFeeCents * disputeRatio)
    }
    if (originalPayment.subscriberFeeCents !== null) {
      subscriberFeeCents = -Math.round(originalPayment.subscriberFeeCents * disputeRatio)
    }
    // Use proportional net for partial disputes
    netCents = -Math.round(originalPayment.netCents * disputeRatio)
  }

  // Calculate reporting currency fields using original payment's rate
  let reportingData: Record<string, unknown> = {}
  if (originalPayment?.reportingExchangeRate && originalPayment.reportingCurrency) {
    const rate = originalPayment.reportingExchangeRate
    const isUSD = dispute.currency.toUpperCase() === 'USD'
    reportingData = {
      reportingCurrency: 'USD',
      reportingGrossCents: isUSD ? -dispute.amount : -convertLocalCentsToUSD(dispute.amount, rate),
      reportingFeeCents: 0, // No fee on dispute
      reportingNetCents: isUSD ? netCents : convertLocalCentsToUSD(netCents, rate),
      reportingExchangeRate: rate,
      reportingRateSource: 'original_payment',
      reportingRateTimestamp: new Date(),
      reportingIsEstimated: false,
    }
  }

  // Create dispute payment record (funds held) with fee breakdown
  await db.payment.create({
    data: {
      subscriptionId: subscription.id,
      creatorId: subscription.creatorId,
      subscriberId: subscription.subscriberId,
      amountCents: -dispute.amount, // Negative - funds held
      currency: dispute.currency.toUpperCase(),
      feeCents: 0,
      netCents,
      creatorFeeCents,
      subscriberFeeCents,
      feeModel: originalPayment?.feeModel || null,
      type: subscription.interval === 'month' ? 'recurring' : 'one_time',
      status: 'disputed', // Dispute is open, funds held - use 'disputed' for payroll tracking
      stripeDisputeId: dispute.id, // Track dispute for later resolution
      stripeChargeId: dispute.charge as string || null,
      stripeEventId: event.id,
      // Reporting currency (use original payment's rate)
      ...reportingData,
    },
  })

  // ===========================================
  // EXPRESS ACCOUNT NEGATIVE BALANCE PROTECTION
  // ===========================================
  // When a dispute occurs on an Express account, check if the creator's balance
  // can cover it. If not, the platform is liable for the shortfall.
  const creatorProfile = await db.profile.findUnique({
    where: { userId: subscription.creatorId },
    select: { stripeAccountId: true, platformDebitCents: true },
  })

  // Track platform liability for alerting later (after creator is fetched)
  let platformLiabilityInfo: {
    shortfall: number
    totalBalance: number
  } | null = null

  if (creatorProfile?.stripeAccountId) {
    try {
      const balance = await getAccountBalance(creatorProfile.stripeAccountId)
      const totalBalance = balance.available + balance.pending

      if (totalBalance < dispute.amount) {
        // Creator can't cover - platform is liable for the difference
        const shortfall = dispute.amount - Math.max(0, totalBalance)

        // Track platform liability as platformDebitCents
        await db.profile.update({
          where: { userId: subscription.creatorId },
          data: {
            platformDebitCents: { increment: shortfall },
          },
        })

        // Store for alerting later (after creator email is fetched)
        platformLiabilityInfo = { shortfall, totalBalance }

        console.log(`[dispute] Platform liable for ${shortfall} cents on dispute ${dispute.id} (creator balance: ${totalBalance}, dispute: ${dispute.amount})`)
      }
    } catch (err) {
      // Don't fail the webhook if balance check fails - log and continue
      console.error(`[dispute] Failed to check Express account balance:`, err)
    }
  }

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

  // Send email notification to creator
  const creator = await db.user.findUnique({
    where: { id: subscription.creatorId },
    include: { profile: { select: { displayName: true } } },
  })

  if (creator?.email && creator.profile?.displayName) {
    await sendDisputeCreatedEmail(
      creator.email,
      creator.profile.displayName,
      dispute.amount,
      dispute.currency.toUpperCase(),
      dispute.reason || 'Unknown'
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
    amount: dispute.amount,
    currency: dispute.currency.toUpperCase(),
    reason: dispute.reason || 'Unknown',
    stripeDisputeId: dispute.id,
  }).catch((err) => console.error('[slack] Failed to send dispute alert:', err))

  // Send platform liability alert if applicable (now we have creator email)
  if (platformLiabilityInfo) {
    alertPlatformLiability({
      creatorId: subscription.creatorId,
      creatorEmail: creator?.email || 'unknown',
      disputeAmount: dispute.amount,
      accountBalance: platformLiabilityInfo.totalBalance,
      platformLiability: platformLiabilityInfo.shortfall,
      disputeId: dispute.id,
    }).catch((err) => console.error('[slack] Failed to send platform liability alert:', err))
  }
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
        status: 'disputed',
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
  if (won && disputePayment.subscriptionId) {
    await db.subscription.update({
      where: { id: disputePayment.subscriptionId },
      data: {
        ltvCents: { increment: dispute.amount },
      },
    })
  }

  // If lost, auto-cancel the subscription (industry standard)
  if (!won && disputePayment.subscriptionId) {
    const subscription = await db.subscription.findUnique({
      where: { id: disputePayment.subscriptionId },
    })

    if (subscription && subscription.status !== 'canceled') {
      // Cancel with Stripe if applicable
      if (subscription.stripeSubscriptionId) {
        try {
          await cancelSubscription(subscription.stripeSubscriptionId, false) // immediate
        } catch (err) {
          console.error(`[stripe] Failed to cancel subscription ${subscription.stripeSubscriptionId}:`, err)
        }
      }

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
            stripeDisputeId: dispute.id,
          },
        },
      })

      console.log(`[stripe] Subscription ${subscription.id} auto-canceled due to dispute loss`)
    }
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

  // Send email notification to creator
  const creator = await db.user.findUnique({
    where: { id: disputePayment.creatorId },
    include: { profile: { select: { displayName: true } } },
  })

  if (creator?.email && creator.profile?.displayName) {
    await sendDisputeResolvedEmail(
      creator.email,
      creator.profile.displayName,
      dispute.amount,
      dispute.currency.toUpperCase(),
      won
    )
  }

  // Send Slack alert for resolution (non-blocking)
  alertDisputeResolved({
    creatorEmail: creator?.email || 'unknown',
    creatorName: creator?.profile?.displayName || 'Unknown Creator',
    amount: dispute.amount,
    currency: dispute.currency.toUpperCase(),
    won,
    stripeDisputeId: dispute.id,
  }).catch((err) => console.error('[slack] Failed to send dispute resolution alert:', err))
}
