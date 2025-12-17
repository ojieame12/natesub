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

  await db.subscription.update({
    where: { id: subscription.id },
    data: {
      status: stripeSubscription.status === 'active' ? 'active' :
        stripeSubscription.status === 'canceled' ? 'canceled' :
          stripeSubscription.status === 'past_due' ? 'past_due' : 'paused',
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
      currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd * 1000) : null,
    },
  })
}

// Handle subscription deleted
export async function handleSubscriptionDeleted(event: Stripe.Event) {
  const stripeSubscription = event.data.object as Stripe.Subscription

  const subscription = await db.subscription.findUnique({
    where: { stripeSubscriptionId: stripeSubscription.id },
  })

  if (!subscription) return

  await db.subscription.update({
    where: { id: subscription.id },
    data: {
      status: 'canceled',
      canceledAt: new Date(),
    },
  })

  // Create activity event
  await db.activity.create({
    data: {
      userId: subscription.creatorId,
      type: 'subscription_canceled',
      payload: {
        subscriptionId: subscription.id,
      },
    },
  })
}
