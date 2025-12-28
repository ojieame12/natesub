import Stripe from 'stripe'
import { db } from '../../../db/client.js'
import { isStripeCrossBorderSupported } from '../../../utils/constants.js'
import { sendPaymentSetupCompleteEmail } from '../../../services/email.js'
import { invalidatePublicProfileCache } from '../../../utils/cache.js'

// Handle Connect account updated
export async function handleAccountUpdated(event: Stripe.Event) {
  const account = event.data.object as Stripe.Account

  const profile = await db.profile.findUnique({
    where: { stripeAccountId: account.id },
    include: {
      user: { select: { email: true } },
    },
  })

  if (!profile) return

  // Track previous status to detect activation
  const previousStatus = profile.payoutStatus

  // Check if this is a cross-border account (e.g., Nigeria)
  // Cross-border accounts don't have charges_enabled - only payouts_enabled matters
  const isCrossBorder = isStripeCrossBorderSupported(profile.countryCode)

  let payoutStatus: 'pending' | 'active' | 'restricted' = 'pending'

  if (isCrossBorder) {
    // Cross-border accounts: only need payouts_enabled (transfers capability)
    if (account.payouts_enabled) {
      payoutStatus = 'active'
    } else if (account.requirements?.disabled_reason) {
      payoutStatus = 'restricted'
    }
  } else {
    // Native accounts: need both charges_enabled and payouts_enabled
    if (account.charges_enabled && account.payouts_enabled) {
      payoutStatus = 'active'
    } else if (account.requirements?.disabled_reason) {
      payoutStatus = 'restricted'
    }
  }

  await db.profile.update({
    where: { id: profile.id },
    data: { payoutStatus },
  })

  // Invalidate public profile cache (payoutStatus affects paymentsReady)
  if (profile.username) {
    await invalidatePublicProfileCache(profile.username)
  }

  // Send email notification when status changes to active (verification complete)
  if (payoutStatus === 'active' && previousStatus !== 'active' && profile.user?.email) {
    const shareUrl = `natepay.co/${profile.username}`
    try {
      await sendPaymentSetupCompleteEmail(
        profile.user.email,
        profile.displayName,
        shareUrl
      )
      console.log(`[stripe] Sent payment setup complete email to ${profile.user.email}`)
    } catch (err) {
      console.error('[stripe] Failed to send payment setup complete email:', err)
    }
  }
}
