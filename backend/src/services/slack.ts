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
