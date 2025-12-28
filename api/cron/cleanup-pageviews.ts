// Vercel Cron Job: Clean up old page views (90-day retention)
// Schedule: Weekly on Sunday at 05:00 UTC

import type { VercelRequest, VercelResponse } from '@vercel/node'

const API_URL = process.env.API_URL || 'https://natesub-production.up.railway.app'
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
    console.error('[cron/cleanup-pageviews] JOBS_API_KEY not configured')
    return res.status(500).json({ error: 'JOBS_API_KEY not configured' })
  }

  console.log('[cron/cleanup-pageviews] Starting weekly page views cleanup job')

  // 8s timeout to prevent hanging if Railway is slow
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const response = await fetch(`${API_URL}/jobs/cleanup-pageviews`, {
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
      console.error('[cron/cleanup-pageviews] Job failed:', data)
      return res.status(response.status).json(data)
    }

    console.log('[cron/cleanup-pageviews] Job completed:', data)
    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      ...data,
    })
  } catch (error: any) {
    clearTimeout(timeout)
    if (error.name === 'AbortError') {
      console.error('[cron/cleanup-pageviews] Request timed out after 8s')
      return res.status(504).json({ error: 'Railway request timeout' })
    }
    console.error('[cron/cleanup-pageviews] Error:', error.message)
    return res.status(500).json({
      error: 'Failed to run page views cleanup job',
      message: error.message,
    })
  }
}
