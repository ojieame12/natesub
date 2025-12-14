/**
 * Alerts Service
 *
 * Send operational alerts for critical issues like stuck transfers,
 * failed webhooks, or system anomalies.
 */

import { Resend } from 'resend'
import { env } from '../config/env.js'
import { db } from '../db/client.js'

const resend = new Resend(env.RESEND_API_KEY)

// Alert recipient - defaults to EMAIL_FROM, can be overridden with ALERT_EMAIL
const ALERT_EMAIL = process.env.ALERT_EMAIL || env.EMAIL_FROM

interface StuckTransfer {
  id: string
  creatorId: string
  amountCents: number
  currency: string
  createdAt: Date
  paystackTransferCode: string | null
  subscription: {
    creator: {
      email: string
      profile: { displayName: string | null; username: string } | null
    }
  } | null
}

/**
 * Send alert for stuck OTP transfers
 */
export async function sendStuckTransfersAlert(transfers: StuckTransfer[]): Promise<void> {
  if (transfers.length === 0) return

  const transferRows = transfers.map(t => {
    const creatorName = t.subscription?.creator?.profile?.displayName
      || t.subscription?.creator?.profile?.username
      || 'Unknown'
    const amount = (t.amountCents / 100).toFixed(2)
    const age = Math.round((Date.now() - t.createdAt.getTime()) / (1000 * 60 * 60)) // hours

    return `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${creatorName}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${t.currency} ${amount}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${age}h ago</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${t.paystackTransferCode || 'N/A'}</td>
      </tr>
    `
  }).join('')

  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: ALERT_EMAIL,
    subject: `🚨 Alert: ${transfers.length} Paystack transfer(s) stuck waiting for OTP`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="font-size: 20px; font-weight: 600; color: #dc2626; margin-bottom: 16px;">
          ⚠️ Stuck Transfers Detected
        </h1>

        <p style="color: #4a4a4a; margin-bottom: 16px;">
          ${transfers.length} transfer(s) are stuck in <code>otp_pending</code> status and require manual OTP entry.
        </p>

        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px; margin-bottom: 20px;">
          <strong style="color: #dc2626;">Action Required:</strong>
          <p style="margin: 8px 0 0 0; color: #991b1b;">
            Either disable OTP in Paystack Dashboard → Settings → Transfers, or manually approve these transfers.
          </p>
        </div>

        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="background: #f3f4f6;">
              <th style="padding: 8px; text-align: left;">Creator</th>
              <th style="padding: 8px; text-align: left;">Amount</th>
              <th style="padding: 8px; text-align: left;">Age</th>
              <th style="padding: 8px; text-align: left;">Transfer Code</th>
            </tr>
          </thead>
          <tbody>
            ${transferRows}
          </tbody>
        </table>

        <p style="color: #6b7280; font-size: 12px; margin-top: 20px;">
          View all stuck transfers: ${env.API_URL}/admin/transfers/stuck
        </p>
      </div>
    `,
  })

  console.log(`[alerts] Sent stuck transfers alert for ${transfers.length} transfer(s)`)
}

/**
 * Send alert for high failure rate
 */
export async function sendHighFailureRateAlert(
  type: 'payments' | 'webhooks' | 'transfers',
  failedCount: number,
  totalCount: number,
  timeWindowMinutes: number
): Promise<void> {
  const failureRate = totalCount > 0 ? ((failedCount / totalCount) * 100).toFixed(1) : '0'

  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: ALERT_EMAIL,
    subject: `🚨 Alert: High ${type} failure rate (${failureRate}%)`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="font-size: 20px; font-weight: 600; color: #dc2626; margin-bottom: 16px;">
          ⚠️ High Failure Rate Detected
        </h1>

        <p style="color: #4a4a4a; margin-bottom: 16px;">
          ${failedCount} out of ${totalCount} ${type} failed in the last ${timeWindowMinutes} minutes (${failureRate}% failure rate).
        </p>

        <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <p style="margin: 0;"><strong>Type:</strong> ${type}</p>
          <p style="margin: 8px 0 0 0;"><strong>Failed:</strong> ${failedCount}</p>
          <p style="margin: 8px 0 0 0;"><strong>Total:</strong> ${totalCount}</p>
          <p style="margin: 8px 0 0 0;"><strong>Rate:</strong> ${failureRate}%</p>
        </div>

        <p style="color: #6b7280; font-size: 12px;">
          Check the admin dashboard for more details.
        </p>
      </div>
    `,
  })

  console.log(`[alerts] Sent high failure rate alert: ${type} ${failureRate}%`)
}

/**
 * Send alert for fee mismatch (potential revenue loss)
 */
export async function sendFeeMismatchAlert(
  paymentId: string,
  expectedFeeCents: number,
  actualFeeCents: number,
  currency: string
): Promise<void> {
  const diff = expectedFeeCents - actualFeeCents
  const diffAmount = (Math.abs(diff) / 100).toFixed(2)
  const direction = diff > 0 ? 'less' : 'more'

  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: ALERT_EMAIL,
    subject: `⚠️ Fee Mismatch: ${currency} ${diffAmount} ${direction} than expected`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h1 style="font-size: 20px; font-weight: 600; color: #f59e0b; margin-bottom: 16px;">
          ⚠️ Fee Mismatch Detected
        </h1>

        <p style="color: #4a4a4a; margin-bottom: 16px;">
          Payment <code>${paymentId}</code> has a fee mismatch of ${currency} ${diffAmount}.
        </p>

        <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <p style="margin: 0;"><strong>Expected Fee:</strong> ${currency} ${(expectedFeeCents / 100).toFixed(2)}</p>
          <p style="margin: 8px 0 0 0;"><strong>Actual Fee:</strong> ${currency} ${(actualFeeCents / 100).toFixed(2)}</p>
          <p style="margin: 8px 0 0 0;"><strong>Difference:</strong> ${currency} ${diffAmount} ${direction}</p>
        </div>

        <p style="color: #6b7280; font-size: 12px;">
          This may indicate a pricing bug or payment provider fee changes.
        </p>
      </div>
    `,
  })

  console.log(`[alerts] Sent fee mismatch alert: ${paymentId} ${currency} ${diffAmount} ${direction}`)
}

/**
 * Check for stuck transfers and send alert if found
 * Returns the count of stuck transfers
 */
export async function checkAndAlertStuckTransfers(
  maxAgeHours: number = 1
): Promise<{ stuckCount: number; alerted: boolean }> {
  const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000)

  const stuckTransfers = await db.payment.findMany({
    where: {
      status: 'otp_pending',
      type: 'payout',
      createdAt: { lte: cutoff },
    },
    include: {
      subscription: {
        include: {
          creator: {
            select: {
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
    take: 50, // Limit to prevent huge emails
  })

  if (stuckTransfers.length > 0) {
    await sendStuckTransfersAlert(stuckTransfers as unknown as StuckTransfer[])
    return { stuckCount: stuckTransfers.length, alerted: true }
  }

  return { stuckCount: 0, alerted: false }
}
