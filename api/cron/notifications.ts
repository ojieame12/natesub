// Vercel Cron Job: Send notification emails (reminders, dunning, cancellations)
// Schedule: Daily at 08:00 UTC

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
    console.error('[cron/notifications] JOBS_API_KEY not configured')
    return res.status(500).json({ error: 'JOBS_API_KEY not configured' })
  }

  console.log('[cron/notifications] Starting notifications job')

  try {
    const response = await fetch(`${API_URL}/jobs/notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jobs-api-key': JOBS_API_KEY,
      },
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('[cron/notifications] Job failed:', data)
      return res.status(response.status).json(data)
    }

    console.log('[cron/notifications] Job completed:', data)
    return res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      ...data,
    })
  } catch (error: any) {
    console.error('[cron/notifications] Error:', error.message)
    return res.status(500).json({
      error: 'Failed to run notifications job',
      message: error.message,
    })
  }
}
