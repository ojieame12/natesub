/**
 * Slack Alerting Service
 *
 * Sends operational alerts to Slack for critical events like:
 * - Disputes/chargebacks
 * - Payment failures (above threshold)
 * - System errors
 *
 * Uses Slack Incoming Webhooks - simple and reliable.
 * Configure SLACK_WEBHOOK_URL in environment variables.
 */

import type Stripe from 'stripe'

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL

interface SlackMessage {
  text?: string
  blocks?: SlackBlock[]
  attachments?: SlackAttachment[]
}

interface SlackBlock {
  type: 'section' | 'divider' | 'header' | 'context'
  text?: {
    type: 'mrkdwn' | 'plain_text'
    text: string
  }
  fields?: {
    type: 'mrkdwn' | 'plain_text'
    text: string
  }[]
  elements?: {
    type: 'mrkdwn' | 'plain_text'
    text: string
  }[]
}

interface SlackAttachment {
  color?: string
  title?: string
  text?: string
  fields?: { title: string; value: string; short?: boolean }[]
  footer?: string
  ts?: number
}

/**
 * Send a message to Slack
 * Non-blocking - errors are logged but don't throw
 */
async function sendSlackMessage(message: SlackMessage): Promise<boolean> {
  if (!SLACK_WEBHOOK_URL) {
    // Silently skip if not configured - common in dev
    return false
  }

  try {
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    })

    if (!response.ok) {
      console.error(`[slack] Failed to send message: ${response.status}`)
      return false
    }

    return true
  } catch (error) {
    console.error('[slack] Error sending message:', error)
    return false
  }
}

/**
 * Format currency amount
 */
function formatCurrency(cents: number, currency: string): string {
  const amount = cents / 100
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount)
}

// ============================================
// ALERT FUNCTIONS
// ============================================

/**
 * Alert: Dispute/Chargeback Created
 * Critical alert - requires immediate attention
 */
export async function alertDisputeCreated(params: {
  creatorEmail: string
  creatorName: string
  subscriberEmail?: string
  amount: number
  currency: string
  reason: string
  stripeDisputeId: string
}): Promise<void> {
  const amountFormatted = formatCurrency(params.amount, params.currency)

  await sendSlackMessage({
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🚨 Dispute Filed',
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Creator:*\n${params.creatorName}` },
          { type: 'mrkdwn', text: `*Amount:*\n${amountFormatted}` },
          { type: 'mrkdwn', text: `*Reason:*\n${params.reason}` },
          { type: 'mrkdwn', text: `*Creator Email:*\n${params.creatorEmail}` },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Stripe Dispute ID: \`${params.stripeDisputeId}\`${params.subscriberEmail ? ` | Subscriber: ${params.subscriberEmail}` : ''}`,
          },
        ],
      },
    ],
    attachments: [
      {
        color: '#dc2626', // Red
        footer: 'NatePay Alerts',
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  })
}

/**
 * Alert: Dispute Resolved
 */
export async function alertDisputeResolved(params: {
  creatorEmail: string
  creatorName: string
  amount: number
  currency: string
  won: boolean
  stripeDisputeId: string
}): Promise<void> {
  const amountFormatted = formatCurrency(params.amount, params.currency)
  const emoji = params.won ? '✅' : '❌'
  const status = params.won ? 'WON' : 'LOST'
  const color = params.won ? '#16a34a' : '#dc2626'

  await sendSlackMessage({
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${emoji} Dispute ${status}`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Creator:*\n${params.creatorName}` },
          { type: 'mrkdwn', text: `*Amount:*\n${amountFormatted}` },
          { type: 'mrkdwn', text: `*Result:*\n${params.won ? 'Funds returned' : 'Funds lost'}` },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Stripe Dispute ID: \`${params.stripeDisputeId}\``,
          },
        ],
      },
    ],
    attachments: [
      {
        color,
        footer: 'NatePay Alerts',
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  })
}

/**
 * Alert: Payment Failure Spike
 * Triggered when failure rate exceeds threshold
 */
export async function alertPaymentFailureSpike(params: {
  failureCount: number
  timeWindowMinutes: number
  recentFailures: Array<{
    creatorEmail: string
    amount: number
    currency: string
    error: string
  }>
}): Promise<void> {
  const failureList = params.recentFailures
    .slice(0, 5)
    .map((f) => `• ${f.creatorEmail}: ${formatCurrency(f.amount, f.currency)} - ${f.error}`)
    .join('\n')

  await sendSlackMessage({
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '⚠️ Payment Failure Spike',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${params.failureCount} failures* in the last ${params.timeWindowMinutes} minutes`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Recent failures:*\n${failureList}`,
        },
      },
    ],
    attachments: [
      {
        color: '#f59e0b', // Amber
        footer: 'NatePay Alerts',
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  })
}

/**
 * Alert: Payout Failed
 */
export async function alertPayoutFailed(params: {
  creatorEmail: string
  creatorName: string
  amount: number
  currency: string
  error: string
  stripePayoutId?: string
  paystackTransferCode?: string
}): Promise<void> {
  const amountFormatted = formatCurrency(params.amount, params.currency)
  const provider = params.stripePayoutId ? 'Stripe' : 'Paystack'
  const refId = params.stripePayoutId || params.paystackTransferCode || 'N/A'

  await sendSlackMessage({
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '💸 Payout Failed',
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Creator:*\n${params.creatorName}` },
          { type: 'mrkdwn', text: `*Amount:*\n${amountFormatted}` },
          { type: 'mrkdwn', text: `*Provider:*\n${provider}` },
          { type: 'mrkdwn', text: `*Error:*\n${params.error}` },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${provider} ID: \`${refId}\` | Creator: ${params.creatorEmail}`,
          },
        ],
      },
    ],
    attachments: [
      {
        color: '#dc2626',
        footer: 'NatePay Alerts',
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  })
}

/**
 * Alert: High-value subscription created
 * Good news alert for visibility
 */
export async function alertHighValueSubscription(params: {
  creatorName: string
  subscriberEmail: string
  amount: number
  currency: string
  interval: string
}): Promise<void> {
  const amountFormatted = formatCurrency(params.amount, params.currency)

  await sendSlackMessage({
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🎉 High-Value Subscription',
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Creator:*\n${params.creatorName}` },
          { type: 'mrkdwn', text: `*Amount:*\n${amountFormatted}/${params.interval}` },
        ],
      },
    ],
    attachments: [
      {
        color: '#16a34a', // Green
        footer: 'NatePay Alerts',
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  })
}

/**
 * Alert: System Error
 * For critical system errors that need attention
 */
export async function alertSystemError(params: {
  service: string
  error: string
  context?: Record<string, any>
}): Promise<void> {
  const contextStr = params.context
    ? Object.entries(params.context)
        .map(([k, v]) => `• ${k}: ${JSON.stringify(v)}`)
        .join('\n')
    : 'No additional context'

  await sendSlackMessage({
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '🔥 System Error',
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Service:*\n${params.service}` },
          { type: 'mrkdwn', text: `*Error:*\n${params.error}` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Context:*\n${contextStr}`,
        },
      },
    ],
    attachments: [
      {
        color: '#dc2626',
        footer: 'NatePay Alerts',
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  })
}

/**
 * Simple text alert (for custom messages)
 */
export async function alertSimple(message: string, emoji = 'ℹ️'): Promise<void> {
  await sendSlackMessage({
    text: `${emoji} ${message}`,
  })
}

/**
 * Alert: Platform Liability on Express Account
 * Critical alert when a dispute creates platform liability due to negative balance
 * on a creator's Express account. Platform must cover the shortfall.
 */
export async function alertPlatformLiability(params: {
  creatorId: string
  creatorEmail: string
  disputeAmount: number
  accountBalance: number
  platformLiability: number
  disputeId: string
}): Promise<void> {
  const disputeFormatted = formatCurrency(params.disputeAmount, 'USD')
  const balanceFormatted = formatCurrency(params.accountBalance, 'USD')
  const liabilityFormatted = formatCurrency(params.platformLiability, 'USD')

  await sendSlackMessage({
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '💰 Platform Liability Alert',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Creator's Express account cannot cover dispute amount. Platform is liable for the shortfall.*`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Dispute Amount:*\n${disputeFormatted}` },
          { type: 'mrkdwn', text: `*Account Balance:*\n${balanceFormatted}` },
          { type: 'mrkdwn', text: `*Platform Liability:*\n${liabilityFormatted}` },
          { type: 'mrkdwn', text: `*Creator:*\n${params.creatorEmail}` },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Creator ID: \`${params.creatorId}\` | Dispute ID: \`${params.disputeId}\``,
          },
        ],
      },
    ],
    attachments: [
      {
        color: '#dc2626', // Red - critical
        footer: 'NatePay Express Account Alert',
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  })
}

/**
 * Alert: Early Fraud Warning (TC40/SAFE)
 * Triggered when Stripe Radar detects fraud on a charge
 * These count toward Visa VAMP ratio even without a dispute
 */
export async function alertEarlyFraudWarning(params: {
  warningId: string
  chargeId: string | Stripe.Charge
  fraudType: string
  actionable: boolean
}): Promise<void> {
  const chargeIdStr = typeof params.chargeId === 'string' ? params.chargeId : params.chargeId.id

  await sendSlackMessage({
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: '⚠️ Early Fraud Warning (TC40)',
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Fraud Type:*\n${params.fraudType}` },
          { type: 'mrkdwn', text: `*Actionable:*\n${params.actionable ? 'Yes' : 'No'}` },
        ],
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Warning ID: \`${params.warningId}\` | Charge: \`${chargeIdStr}\``,
          },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: params.actionable
            ? '⚡ *Consider proactive refund to prevent chargeback*'
            : '_No action required - informational only_',
        },
      },
    ],
    attachments: [
      {
        color: params.actionable ? '#f59e0b' : '#6b7280', // Amber if actionable, gray if not
        footer: 'NatePay Fraud Monitoring',
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  })
}

/**
 * Alert: Dispute Ratio Warning
 * Triggered when 30-day rolling dispute ratio approaches Visa VAMP thresholds
 * - 0.4%: Early warning
 * - 0.6%: Elevated (approaching 0.65% Visa early warning)
 * - 0.8%: Critical (approaching 0.9% Visa standard threshold)
 */
export async function alertDisputeRatioWarning(params: {
  currentRatio: number       // As decimal (e.g., 0.004 for 0.4%)
  threshold: 'early' | 'elevated' | 'critical'
  disputeCount: number       // Total disputes in 30-day window
  transactionCount: number   // Total successful transactions in 30-day window
  topOffenders?: Array<{     // Top creators by dispute count
    creatorEmail: string
    displayName: string
    disputeCount: number
  }>
}): Promise<void> {
  const ratioPercent = (params.currentRatio * 100).toFixed(2)

  const thresholdConfig = {
    early: { emoji: '⚠️', label: 'Early Warning (0.4%)', color: '#f59e0b', visaThreshold: '0.65%' },
    elevated: { emoji: '🚨', label: 'Elevated (0.6%)', color: '#ea580c', visaThreshold: '0.65%' },
    critical: { emoji: '🔴', label: 'CRITICAL (0.8%)', color: '#dc2626', visaThreshold: '0.9%' },
  }

  const config = thresholdConfig[params.threshold]

  const offendersList = params.topOffenders?.length
    ? params.topOffenders.slice(0, 5)
        .map((o) => `• ${o.displayName} (${o.creatorEmail}): ${o.disputeCount} disputes`)
        .join('\n')
    : 'None'

  await sendSlackMessage({
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${config.emoji} Dispute Ratio ${config.label}`,
        },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Current Ratio:*\n${ratioPercent}%` },
          { type: 'mrkdwn', text: `*Visa Threshold:*\n${config.visaThreshold}` },
          { type: 'mrkdwn', text: `*Disputes (30d):*\n${params.disputeCount}` },
          { type: 'mrkdwn', text: `*Transactions (30d):*\n${params.transactionCount}` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Top creators by disputes:*\n${offendersList}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Visa VAMP thresholds: 0.65% early warning, 0.9% standard, 1.8% excessive`,
          },
        ],
      },
    ],
    attachments: [
      {
        color: config.color,
        footer: 'NatePay Dispute Monitoring',
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  })
}
