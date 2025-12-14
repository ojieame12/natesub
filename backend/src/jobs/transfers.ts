/**
 * Transfer Monitoring Jobs
 *
 * Monitor Paystack transfers for stuck OTP states and other issues.
 */

import { db } from '../db/client.js'
import { checkAndAlertStuckTransfers, sendHighFailureRateAlert } from '../services/alerts.js'

interface TransferMonitorResult {
  stuckTransfers: number
  failedTransfers: number
  pendingTransfers: number
  alertsSent: number
}

/**
 * Monitor stuck OTP transfers
 * Sends alert if transfers are stuck for more than 1 hour
 */
export async function monitorStuckTransfers(): Promise<TransferMonitorResult> {
  console.log('[transfers] Starting stuck transfer monitoring')

  // Check for transfers stuck in otp_pending for > 1 hour
  const { stuckCount, alerted } = await checkAndAlertStuckTransfers(1)

  // Get counts for reporting
  const [failedCount, pendingCount] = await Promise.all([
    db.payment.count({
      where: {
        type: 'payout',
        status: 'failed',
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
    db.payment.count({
      where: {
        type: 'payout',
        status: 'pending',
      },
    }),
  ])

  // Check failure rate and alert if high
  let alertsSent = alerted ? 1 : 0

  const recentTotal = await db.payment.count({
    where: {
      type: 'payout',
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) }, // last hour
    },
  })

  const recentFailed = await db.payment.count({
    where: {
      type: 'payout',
      status: 'failed',
      createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
    },
  })

  // Alert if failure rate > 20% and at least 5 transfers
  if (recentTotal >= 5 && recentFailed / recentTotal > 0.2) {
    await sendHighFailureRateAlert('transfers', recentFailed, recentTotal, 60)
    alertsSent++
  }

  console.log(`[transfers] Monitoring complete: ${stuckCount} stuck, ${failedCount} failed (24h), ${pendingCount} pending`)

  return {
    stuckTransfers: stuckCount,
    failedTransfers: failedCount,
    pendingTransfers: pendingCount,
    alertsSent,
  }
}

/**
 * Get detailed list of stuck transfers for admin dashboard
 */
export async function getStuckTransfers(maxAgeHours?: number) {
  const where: any = {
    status: 'otp_pending',
    type: 'payout',
  }

  if (maxAgeHours) {
    where.createdAt = { lte: new Date(Date.now() - maxAgeHours * 60 * 60 * 1000) }
  }

  const transfers = await db.payment.findMany({
    where,
    include: {
      subscription: {
        include: {
          creator: {
            select: {
              id: true,
              email: true,
              profile: {
                select: {
                  displayName: true,
                  username: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  return transfers.map(t => ({
    id: t.id,
    creatorId: t.creatorId,
    creatorName: t.subscription?.creator?.profile?.displayName
      || t.subscription?.creator?.profile?.username
      || 'Unknown',
    creatorEmail: t.subscription?.creator?.email,
    amountCents: t.amountCents,
    netCents: t.netCents,
    currency: t.currency,
    status: t.status,
    transferCode: t.paystackTransferCode,
    createdAt: t.createdAt,
    ageHours: Math.round((Date.now() - t.createdAt.getTime()) / (1000 * 60 * 60)),
  }))
}

/**
 * Get transfer statistics for monitoring
 */
export async function getTransferStats() {
  const now = new Date()
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)

  const [
    totalPending,
    totalOtpPending,
    failed24h,
    succeeded24h,
    failed1h,
    succeeded1h,
  ] = await Promise.all([
    db.payment.count({ where: { type: 'payout', status: 'pending' } }),
    db.payment.count({ where: { type: 'payout', status: 'otp_pending' } }),
    db.payment.count({ where: { type: 'payout', status: 'failed', createdAt: { gte: oneDayAgo } } }),
    db.payment.count({ where: { type: 'payout', status: 'succeeded', createdAt: { gte: oneDayAgo } } }),
    db.payment.count({ where: { type: 'payout', status: 'failed', createdAt: { gte: oneHourAgo } } }),
    db.payment.count({ where: { type: 'payout', status: 'succeeded', createdAt: { gte: oneHourAgo } } }),
  ])

  const total1h = failed1h + succeeded1h
  const total24h = failed24h + succeeded24h

  return {
    pending: totalPending,
    otpPending: totalOtpPending,
    last24h: {
      succeeded: succeeded24h,
      failed: failed24h,
      total: total24h,
      failureRate: total24h > 0 ? ((failed24h / total24h) * 100).toFixed(1) + '%' : '0%',
    },
    last1h: {
      succeeded: succeeded1h,
      failed: failed1h,
      total: total1h,
      failureRate: total1h > 0 ? ((failed1h / total1h) * 100).toFixed(1) + '%' : '0%',
    },
  }
}
