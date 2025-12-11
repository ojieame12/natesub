import { Resend } from 'resend'
import { env } from '../config/env.js'

const resend = new Resend(env.RESEND_API_KEY)

export async function sendMagicLinkEmail(to: string, magicLink: string): Promise<void> {
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: 'Sign in to Nate',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
        <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 24px; color: #1a1a1a;">Sign in to Nate</h1>
        <p style="font-size: 16px; color: #4a4a4a; margin-bottom: 24px;">Click the button below to sign in. This link expires in 15 minutes.</p>
        <a href="${magicLink}" style="display: inline-block; background-color: #FF941A; color: white; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 16px;">Sign In</a>
        <p style="font-size: 14px; color: #888; margin-top: 32px;">If you didn't request this email, you can safely ignore it.</p>
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
