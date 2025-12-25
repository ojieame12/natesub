/**
 * Admin Rate Limit Tests
 *
 * Validates adminSensitiveRateLimit on high-risk routes.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../../src/app.js'
import { db } from '../../../src/db/client.js'
import { resetDatabase, disconnectDatabase } from '../../helpers/db.js'

const adminHeaders = {
  'x-admin-api-key': 'test-admin-key-12345',
  'user-agent': 'admin-rate-limit-test',
}

describe('admin rate limiting', () => {
  beforeEach(async () => {
    await resetDatabase()
    vi.clearAllMocks()
  })

  afterAll(async () => {
    await resetDatabase()
    await disconnectDatabase()
  })

  it('rate limits repeated webhook retries', async () => {
    const event = await db.webhookEvent.create({
      data: {
        provider: 'stripe',
        eventId: 'evt_rate_limit_1',
        eventType: 'invoice.paid',
        status: 'failed',
        retryCount: 0,
        payload: { id: 'evt_rate_limit_1', type: 'invoice.paid', data: { object: {} } },
      },
    })

    for (let i = 0; i < 10; i += 1) {
      const res = await app.fetch(
        new Request(`http://localhost/admin/webhooks/${event.id}/retry`, {
          method: 'POST',
          headers: adminHeaders,
        })
      )

      expect(res.status).toBe(200)
    }

    const res = await app.fetch(
      new Request(`http://localhost/admin/webhooks/${event.id}/retry`, {
        method: 'POST',
        headers: adminHeaders,
      })
    )

    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toContain('Too many admin operations')
  })
})
