// Vercel Cron Job: Sync creator balances from Stripe/Paystack
// Schedule: Every 15 minutes

import type { VercelRequest, VercelResponse } from '@vercel/node'

const API_URL = process.env.API_URL || 'https://natesub-production-b530.up.railway.app'
const JOBS_API_KEY = process.env.JOBS_API_KEY

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify this is a cron request from Vercel
  const authHeader = req.headers['authorization']
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // Allow manual trigger in development
    if (process.env.NODE_ENV === 'production') {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  if (!JOBS_API_KEY) {
    console.error('[cron/sync-balances] JOBS_API_KEY not configured')
    return res.status(500).json({ error: 'JOBS_API_KEY not configured' })
  }

  console.log('[cron/sync-balances] Starting balance sync job')

  // 8s timeout to prevent hanging if Railway is slow
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch(`${API_URL}/jobs/sync-balances`, {
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
      console.error('[cron/sync-balances] Job failed:', data)
      return res.status(response.status).json(data)
    }

    console.log('[cron/sync-balances] Job completed:', data)
    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      ...data,
    })
  } catch (error: any) {
    clearTimeout(timeout)
    if (error.name === 'AbortError') {
      console.error('[cron/sync-balances] Request timed out after 8s')
      return res.status(504).json({ error: 'Railway request timeout' })
    }
    console.error('[cron/sync-balances] Error:', error.message)
    return res.status(500).json({
      error: 'Failed to run balance sync job',
      message: error.message,
    })
  }
}
