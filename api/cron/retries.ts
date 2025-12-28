// Vercel Cron Job: Process failed payment retries
// Schedule: Every 6 hours

import type { VercelRequest, VercelResponse } from '@vercel/node'

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
    console.error('[cron/retries] JOBS_API_KEY not configured')
    return res.status(500).json({ error: 'JOBS_API_KEY not configured' })
  }

  console.log('[cron/retries] Starting retry job')

  // 8s timeout to prevent hanging if Railway is slow
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch(`${API_URL}/jobs/retries`, {
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
      console.error('[cron/retries] Job failed:', data)
      return res.status(response.status).json(data)
    }

    console.log('[cron/retries] Job completed:', data)
    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      ...data,
    })
  } catch (error: any) {
    clearTimeout(timeout)
    if (error.name === 'AbortError') {
      console.error('[cron/retries] Request timed out after 8s')
      return res.status(504).json({ error: 'Railway request timeout' })
    }
    console.error('[cron/retries] Error:', error.message)
    return res.status(500).json({
      error: 'Failed to run retry job',
      message: error.message,
    })
  }
}
