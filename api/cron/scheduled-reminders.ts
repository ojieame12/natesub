// Vercel Cron Job: Process scheduled reminders (payout, request, invoice, etc.)
// Schedule: Hourly at minute 0

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getErrorInfo } from './utils'

const API_URL = process.env.API_URL || 'https://natesub-production.up.railway.app'
const JOBS_API_KEY = process.env.JOBS_API_KEY

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify this is a cron request from Vercel
  const authHeader = req.headers['authorization']
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  if (!JOBS_API_KEY) {
    console.error('[cron/scheduled-reminders] JOBS_API_KEY not configured')
    return res.status(500).json({ error: 'JOBS_API_KEY not configured' })
  }

  console.log('[cron/scheduled-reminders] Starting scheduled reminders job')

  // 8s timeout to prevent hanging if Railway is slow
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch(`${API_URL}/jobs/scheduled-reminders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jobs-api-key': JOBS_API_KEY,
      },
      signal: controller.signal,
    })
    clearTimeout(timeout)

    const data = await response.json()

    if (!response.ok) {
      console.error('[cron/scheduled-reminders] Job failed:', data)
      return res.status(response.status).json(data)
    }

    console.log('[cron/scheduled-reminders] Job completed:', data)
    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      ...data,
    })
  } catch (error: unknown) {
    clearTimeout(timeout)
    const { name, message } = getErrorInfo(error)
    if (name === 'AbortError') {
      console.error('[cron/scheduled-reminders] Request timed out after 8s')
      return res.status(504).json({ error: 'Railway request timeout' })
    }
    console.error('[cron/scheduled-reminders] Error:', message)
    return res.status(500).json({
      error: 'Failed to run scheduled reminders job',
      message,
    })
  }
}
