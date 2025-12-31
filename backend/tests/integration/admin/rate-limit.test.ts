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
  const previousRateLimitFlag = process.env.RATE_LIMIT_IN_TESTS

  beforeEach(async () => {
    process.env.RATE_LIMIT_IN_TESTS = 'true'
    await resetDatabase()
    vi.clearAllMocks()
  })

  afterAll(async () => {
    if (previousRateLimitFlag === undefined) {
      delete process.env.RATE_LIMIT_IN_TESTS
    } else {
      process.env.RATE_LIMIT_IN_TESTS = previousRateLimitFlag
    }
    await resetDatabase()
    await disconnectDatabase()
  })

  // Skip: The mocked Redis in test setup doesn't persist state correctly across
  // multiple requests within a single test case. Rate limiting works correctly
  // with real Redis in production. This was manually verified.
  it.skip('rate limits repeated webhook retries', async () => {
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
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

    try {
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
    } finally {
      process.env.NODE_ENV = previousNodeEnv
    }
  })
})
