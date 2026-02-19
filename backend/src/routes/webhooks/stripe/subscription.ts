import Stripe from 'stripe'
import { db } from '../../../db/client.js'

// Handle subscription updated
export async function handleSubscriptionUpdated(event: Stripe.Event) {
  const stripeSubscription = event.data.object as Stripe.Subscription

  const subscription = await db.subscription.findUnique({
    where: { stripeSubscriptionId: stripeSubscription.id },
  })

  if (!subscription) return

  // Get current period end (property name may vary in different API versions)
  const currentPeriodEnd = (stripeSubscription as any).current_period_end
    ?? (stripeSubscription as any).current_period_end_at

  // Sync price from Stripe if it changed (e.g. creator updated their price in Stripe dashboard)
  const stripePrice = stripeSubscription.items?.data?.[0]?.price?.unit_amount
  const updateData: Record<string, any> = {
    status: stripeSubscription.status === 'active' ? 'active' :
      stripeSubscription.status === 'canceled' ? 'canceled' :
        stripeSubscription.status === 'past_due' ? 'past_due' : 'paused',
    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
    currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
  }

  // If Stripe has a different price than our DB, update it
  // This keeps our records in sync with any price changes made through Stripe
  if (stripePrice && stripePrice !== subscription.amount) {
    console.log(`[subscription] Price sync: ${subscription.amount} → ${stripePrice} for ${subscription.id}`)
    updateData.amount = stripePrice
  }

  await db.subscription.update({
    where: { id: subscription.id },
    data: updateData,
  })
}

// Handle subscription deleted
export async function handleSubscriptionDeleted(event: Stripe.Event) {
  const stripeSubscription = event.data.object as Stripe.Subscription

  const subscription = await db.subscription.findUnique({
    where: { stripeSubscriptionId: stripeSubscription.id },
    include: {
      subscriber: { select: { email: true } },
    },
  })

  if (!subscription) return

  await db.subscription.update({
    where: { id: subscription.id },
    data: {
      status: 'canceled',
      canceledAt: new Date(),
    },
  })

  // Create activity event with subscriber context for meaningful notifications
  await db.activity.create({
    data: {
      userId: subscription.creatorId,
      type: 'subscription_canceled',
      payload: {
        subscriptionId: subscription.id,
        subscriberName: subscription.subscriber?.email || null,
        amount: subscription.amount,
        currency: (subscription.currency || 'USD').toUpperCase(),
        tierName: subscription.tierName || null,
      },
    },
  })
}
