import { Job } from 'bullmq'
import { _sendEmail } from '../services/email.js'
import { env } from '../config/env.js'

export interface EmailJobData {
  to: string
  subject: string
  html: string
  text?: string
  from?: string
}

// Mask email for logging (e.g., "te***@example.com")
function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  const masked = local.length > 2 ? `${local.slice(0, 2)}***` : '***'
  return `${masked}@${domain}`
}

export async function emailProcessor(job: Job<EmailJobData>) {
  const { to, subject, html, text, from } = job.data

  console.log(`[worker] Processing email job ${job.id} to ${maskEmail(to)}`)

  const result = await _sendEmail({
    from: from || env.EMAIL_FROM,
    to,
    subject,
    html,
    text,
  })

  if (!result.success) {
    throw new Error(result.error || 'Email send failed')
  }

  console.log(`[worker] Email job ${job.id} completed`)
}
