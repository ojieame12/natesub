/**
 * Early Fraud Warning (EFW) Handler
 *
 * Handles Stripe Radar early fraud warnings (TC40/SAFE reports).
 * These are fraud reports from card networks that count toward
 * Visa VAMP ratio even without a dispute being filed.
 *
 * Key points:
 * - TC40s count toward VAMP ratio separately from disputes
 * - If actionable, consider proactive refund to prevent chargeback
 * - Track for fraud rate monitoring and creator risk assessment
 */

import type Stripe from 'stripe'
import { db } from '../../../db/client.js'
import { alertEarlyFraudWarning } from '../../../services/slack.js'

export async function handleEarlyFraudWarning(event: Stripe.Event): Promise<void> {
  const efw = event.data.object as Stripe.Radar.EarlyFraudWarning

  console.log(`[efw] Processing early fraud warning ${efw.id} for charge ${efw.charge}`)

  // Try to find the related payment in our database
  const chargeId = typeof efw.charge === 'string' ? efw.charge : efw.charge?.id
  let paymentId: string | null = null
  let creatorId: string | null = null

  if (chargeId) {
    const payment = await db.payment.findFirst({
      where: { stripeChargeId: chargeId },
      select: { id: true, creatorId: true },
    })

    if (payment) {
      paymentId = payment.id
      creatorId = payment.creatorId
    }
  }

  // Log to database for VAMP ratio tracking
  await db.fraudWarning.create({
    data: {
      stripeWarningId: efw.id,
      chargeId: chargeId || 'unknown',
      fraudType: efw.fraud_type,
      actionable: efw.actionable,
      paymentId,
      creatorId,
    },
  })

  // Alert ops team via Slack
  alertEarlyFraudWarning({
    warningId: efw.id,
    chargeId: chargeId || 'unknown',
    fraudType: efw.fraud_type,
    actionable: efw.actionable,
  }).catch((err) => console.error('[efw] Failed to send Slack alert:', err))

  // TODO: If actionable and high confidence, consider auto-refund
  // This could prevent a chargeback but needs business rules
  if (efw.actionable) {
    console.log(`[efw] Warning ${efw.id} is actionable - consider proactive refund for charge ${chargeId}`)
    // Future: Implement auto-refund logic with business approval
  }

  console.log(`[efw] Successfully processed early fraud warning ${efw.id}`)
}
