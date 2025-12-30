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
 * Send alert for reconciliation discrepancies
 */
export async function sendReconciliationAlert(params: {
  missingInDb: Array<{ reference: string; amount: number; currency: string; paidAt: string }>
  statusMismatches: Array<{ reference: string; dbStatus: string; paystackStatus: string; amount: number }>
  totalDiscrepancyCents: number
}): Promise<void> {
  const { missingInDb, statusMismatches, totalDiscrepancyCents } = params

  if (missingInDb.length === 0 && statusMismatches.length === 0) return

  const missingRows = missingInDb.slice(0, 20).map(t => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${t.reference}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${t.currency} ${(t.amount / 100).toFixed(2)}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${new Date(t.paidAt).toLocaleString()}</td>
    </tr>
  `).join('')

  const mismatchRows = statusMismatches.slice(0, 20).map(t => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${t.reference}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${t.dbStatus}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${t.paystackStatus}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${(t.amount / 100).toFixed(2)}</td>
    </tr>
  `).join('')

  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: ALERT_EMAIL,
    subject: `🚨 Reconciliation Alert: ${missingInDb.length} missing, ${statusMismatches.length} mismatched`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px;">
        <h1 style="font-size: 20px; font-weight: 600; color: #dc2626; margin-bottom: 16px;">
          ⚠️ Paystack Reconciliation Discrepancies Found
        </h1>

        <div style="background: #f3f4f6; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <p style="margin: 0;"><strong>Missing in DB:</strong> ${missingInDb.length} transactions</p>
          <p style="margin: 8px 0 0 0;"><strong>Status Mismatches:</strong> ${statusMismatches.length} transactions</p>
          <p style="margin: 8px 0 0 0;"><strong>Total Discrepancy:</strong> ${(totalDiscrepancyCents / 100).toFixed(2)} (estimated)</p>
        </div>

        ${missingInDb.length > 0 ? `
          <h2 style="font-size: 16px; margin: 20px 0 10px;">Transactions Missing in Database</h2>
          <p style="color: #dc2626; font-size: 14px;">These payments succeeded in Paystack but have no record in your database. Possible webhook failure.</p>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <thead>
              <tr style="background: #fef2f2;">
                <th style="padding: 8px; text-align: left;">Reference</th>
                <th style="padding: 8px; text-align: left;">Amount</th>
                <th style="padding: 8px; text-align: left;">Paid At</th>
              </tr>
            </thead>
            <tbody>${missingRows}</tbody>
          </table>
          ${missingInDb.length > 20 ? `<p style="color: #666; font-size: 12px;">...and ${missingInDb.length - 20} more</p>` : ''}
        ` : ''}

        ${statusMismatches.length > 0 ? `
          <h2 style="font-size: 16px; margin: 20px 0 10px;">Status Mismatches</h2>
          <p style="color: #f59e0b; font-size: 14px;">These transactions have different statuses in DB vs Paystack.</p>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <thead>
              <tr style="background: #fef3c7;">
                <th style="padding: 8px; text-align: left;">Reference</th>
                <th style="padding: 8px; text-align: left;">DB Status</th>
                <th style="padding: 8px; text-align: left;">Paystack Status</th>
                <th style="padding: 8px; text-align: left;">Amount</th>
              </tr>
            </thead>
            <tbody>${mismatchRows}</tbody>
          </table>
          ${statusMismatches.length > 20 ? `<p style="color: #666; font-size: 12px;">...and ${statusMismatches.length - 20} more</p>` : ''}
        ` : ''}

        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 12px; margin-top: 20px;">
          <strong style="color: #dc2626;">Action Required:</strong>
          <p style="margin: 8px 0 0 0; color: #991b1b;">
            Review these discrepancies. Missing transactions may indicate webhook failures and unpaid creators.
          </p>
        </div>
      </div>
    `,
  })

  console.log(`[alerts] Sent reconciliation alert: ${missingInDb.length} missing, ${statusMismatches.length} mismatched`)
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

/**
 * Send alert for stale or failed background jobs
 */
export async function sendJobHealthAlert(
  status: 'degraded' | 'critical',
  staleJobs: string[],
  failedJobs: string[],
  details: Array<{ name: string; staleSinceMinutes?: number | null; lastError?: string | null }>
): Promise<void> {
  if (staleJobs.length === 0 && failedJobs.length === 0) return

  const isCritical = status === 'critical'
  const subject = isCritical
    ? `🚨 CRITICAL: Job Health Alert - ${failedJobs.length} failed, ${staleJobs.length} stale`
    : `⚠️ Degraded: Job Health Alert - ${staleJobs.length} stale job(s)`

  const jobRows = details.slice(0, 20).map(job => {
    const statusBadge = failedJobs.includes(job.name)
      ? '<span style="background: #dc2626; color: white; padding: 2px 6px; border-radius: 4px; font-size: 12px;">FAILED</span>'
      : '<span style="background: #f59e0b; color: white; padding: 2px 6px; border-radius: 4px; font-size: 12px;">STALE</span>'

    const staleInfo = job.staleSinceMinutes
      ? `${Math.round(job.staleSinceMinutes / 60)}h ${job.staleSinceMinutes % 60}m`
      : 'N/A'

    return `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${job.name}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${statusBadge}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${staleInfo}</td>
        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-size: 12px; color: #6b7280;">${job.lastError || '-'}</td>
      </tr>
    `
  }).join('')

  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: ALERT_EMAIL,
    subject,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px;">
        <h1 style="font-size: 20px; font-weight: 600; color: ${isCritical ? '#dc2626' : '#f59e0b'}; margin-bottom: 16px;">
          ${isCritical ? '🚨 Critical Job Health Alert' : '⚠️ Job Health Degraded'}
        </h1>

        <p style="color: #4a4a4a; margin-bottom: 16px;">
          ${isCritical
            ? 'Critical background jobs have failed or stopped running. Billing and payment retries may be affected.'
            : 'Some background jobs have not run recently. System functionality may be degraded.'}
        </p>

        <div style="background: ${isCritical ? '#fef2f2' : '#fef3c7'}; border: 1px solid ${isCritical ? '#fecaca' : '#fde68a'}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <p style="margin: 0;"><strong>Status:</strong> ${status.toUpperCase()}</p>
          <p style="margin: 8px 0 0 0;"><strong>Stale Jobs:</strong> ${staleJobs.length > 0 ? staleJobs.join(', ') : 'None'}</p>
          <p style="margin: 8px 0 0 0;"><strong>Failed Jobs:</strong> ${failedJobs.length > 0 ? failedJobs.join(', ') : 'None'}</p>
        </div>

        <h2 style="font-size: 16px; margin: 20px 0 10px;">Job Details</h2>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="background: #f3f4f6;">
              <th style="padding: 8px; text-align: left;">Job</th>
              <th style="padding: 8px; text-align: left;">Status</th>
              <th style="padding: 8px; text-align: left;">Stale For</th>
              <th style="padding: 8px; text-align: left;">Last Error</th>
            </tr>
          </thead>
          <tbody>
            ${jobRows}
          </tbody>
        </table>
        ${details.length > 20 ? `<p style="color: #666; font-size: 12px;">...and ${details.length - 20} more</p>` : ''}

        <div style="background: ${isCritical ? '#fef2f2' : '#f3f4f6'}; border: 1px solid ${isCritical ? '#fecaca' : '#e5e7eb'}; border-radius: 8px; padding: 12px; margin-top: 20px;">
          <strong style="color: ${isCritical ? '#dc2626' : '#4a4a4a'};">Action Required:</strong>
          <p style="margin: 8px 0 0 0; color: ${isCritical ? '#991b1b' : '#4a4a4a'};">
            ${isCritical
              ? 'Check Railway logs immediately. Critical jobs (billing, retries) being down affects revenue.'
              : 'Review job logs when convenient. Non-critical jobs being stale may affect reports and cleanup.'}
          </p>
        </div>

        <p style="color: #6b7280; font-size: 12px; margin-top: 20px;">
          Check job health: ${env.API_URL}/jobs/health
        </p>
      </div>
    `,
  })

  console.log(`[alerts] Sent job health alert: ${status}, ${staleJobs.length} stale, ${failedJobs.length} failed`)
}
