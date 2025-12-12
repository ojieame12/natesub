import { Resend } from 'resend'
import { env } from '../config/env.js'

const resend = new Resend(env.RESEND_API_KEY)

export async function sendOtpEmail(to: string, otp: string): Promise<void> {
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: `${otp} is your Nate verification code`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">Your verification code</h1>
        <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 24px;">Enter this code in the app to sign in:</p>
        <div style="background-color: #f5f5f5; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
          <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #1a1a1a;">${otp}</span>
        </div>
        <p style="font-size: 14px; color: #888;">This code expires in 15 minutes. If you didn't request this, you can safely ignore it.</p>
      </div>
    `,
  })
}

export async function sendWelcomeEmail(to: string, displayName: string): Promise<void> {
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: 'Welcome to Nate!',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">Welcome, ${displayName}!</h1>
        <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 24px;">Your page is live. Share it with your supporters and start receiving subscriptions.</p>
        <a href="${env.APP_URL}/dashboard" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">Go to Dashboard</a>
      </div>
    `,
  })
}

export async function sendNewSubscriberEmail(
  to: string,
  subscriberName: string,
  tierName: string | null,
  amount: number,
  currency: string
): Promise<void> {
  const formattedAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount / 100)

  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: `New subscriber: ${subscriberName}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">You have a new subscriber!</h1>
        <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 16px;"><strong>${subscriberName}</strong> just subscribed${tierName ? ` to ${tierName}` : ''} for <strong>${formattedAmount}/month</strong>.</p>
        <a href="${env.APP_URL}/subscribers" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Subscribers</a>
      </div>
    `,
  })
}

export async function sendRequestEmail(
  to: string,
  senderName: string,
  message: string | null,
  requestLink: string
): Promise<void> {
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: `${senderName} sent you a request`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">${senderName} sent you a request</h1>
        ${message ? `<p style="font-size: 16px; color: #4a4a4a; margin-bottom: 24px; font-style: italic;">"${message}"</p>` : ''}
        <a href="${requestLink}" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Request</a>
      </div>
    `,
  })
}

export async function sendUpdateEmail(
  to: string,
  creatorName: string,
  title: string | null,
  body: string
): Promise<void> {
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: title || `New update from ${creatorName}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
        <p style="font-size: 14px; color: #888; margin-bottom: 8px;">Update from ${creatorName}</p>
        ${title ? `<h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">${title}</h1>` : ''}
        <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 24px; white-space: pre-wrap;">${body}</p>
      </div>
    `,
  })
}

// Payment reminder - sent 3 days before renewal
export async function sendRenewalReminderEmail(
  to: string,
  creatorName: string,
  amount: number,
  currency: string,
  renewalDate: Date
): Promise<void> {
  const formattedAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount / 100)

  const formattedDate = renewalDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: `Subscription renewal reminder - ${creatorName}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">Your subscription renews soon</h1>
        <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 16px;">Your subscription to <strong>${creatorName}</strong> will renew on <strong>${formattedDate}</strong> for <strong>${formattedAmount}</strong>.</p>
        <p style="font-size: 14px; color: #888; margin-bottom: 24px;">No action needed if you'd like to continue your subscription. If you need to update your payment method or cancel, visit your account settings.</p>
        <a href="${env.APP_URL}/settings" style="display: inline-block; background-color: #1a1a1a; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">Manage Subscription</a>
      </div>
    `,
  })
}

// Payment failed - dunning email
export async function sendPaymentFailedEmail(
  to: string,
  creatorName: string,
  amount: number,
  currency: string,
  retryDate: Date | null
): Promise<void> {
  const formattedAmount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount / 100)

  const retryMessage = retryDate
    ? `We'll automatically retry charging your card on ${retryDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.`
    : 'Please update your payment method to continue your subscription.'

  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: `Action required: Payment failed for ${creatorName} subscription`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #dc2626;">Payment failed</h1>
        <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 16px;">We couldn't process your ${formattedAmount} payment for your subscription to <strong>${creatorName}</strong>.</p>
        <p style="font-size: 14px; color: #888; margin-bottom: 24px;">${retryMessage}</p>
        <a href="${env.APP_URL}/settings" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">Update Payment Method</a>
      </div>
    `,
  })
}

// Subscription canceled due to payment failure
export async function sendSubscriptionCanceledEmail(
  to: string,
  creatorName: string
): Promise<void> {
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: `Subscription to ${creatorName} has ended`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">Your subscription has ended</h1>
        <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 16px;">Your subscription to <strong>${creatorName}</strong> has been canceled due to payment issues.</p>
        <p style="font-size: 14px; color: #888; margin-bottom: 24px;">You can resubscribe anytime to continue supporting ${creatorName}.</p>
        <a href="${env.APP_URL}" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">Resubscribe</a>
      </div>
    `,
  })
}
