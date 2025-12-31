/**
 * E2E Endpoint Security Tests
 *
 * These tests verify the security guards on /e2e/* endpoints.
 *
 * NOTE: Environment is cached at module import time, so we test against
 * the current test environment configuration. In CI, these endpoints
 * should be disabled (E2E_MODE not set) which makes them return 404.
 *
 * When E2E_MODE is enabled (local dev/E2E runs), we test the auth flow.
 */

import app from '../../src/app.js'
import { env } from '../../src/config/env.js'

describe('E2E endpoint guards', () => {
  // Get the E2E API key from config (cached at import)
  const E2E_API_KEY = env.E2E_API_KEY
  const E2E_MODE = env.E2E_MODE

  if (E2E_MODE !== 'true') {
    // E2E mode is disabled - endpoints should return 404
    describe('when E2E_MODE is not enabled (production-like)', () => {
      it('returns 404 for /e2e/cleanup', async () => {
        const res = await app.fetch(
          new Request('http://localhost/e2e/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          })
        )

        // Should return 404 (not reveal that endpoint exists)
        expect(res.status).toBe(404)
      })

      it('returns 404 for /e2e/subscription/:id', async () => {
        const res = await app.fetch(
          new Request('http://localhost/e2e/subscription/test-id', {
            method: 'GET',
          })
        )

        expect(res.status).toBe(404)
      })

      it('returns 404 for /e2e/seed-subscription', async () => {
        const res = await app.fetch(
          new Request('http://localhost/e2e/seed-subscription', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ creatorUsername: 'test', subscriberEmail: 'test@test.com' }),
          })
        )

        expect(res.status).toBe(404)
      })
    })
  } else {
    // E2E mode is enabled - test auth flow
    describe('when E2E_MODE is enabled', () => {
      it('returns 401 when no API key provided', async () => {
        const res = await app.fetch(
          new Request('http://localhost/e2e/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          })
        )

        expect(res.status).toBe(401)
        const body = await res.json()
        expect(body.error).toBe('Unauthorized')
      })

      it('returns 401 when wrong API key provided', async () => {
        const res = await app.fetch(
          new Request('http://localhost/e2e/cleanup', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-e2e-api-key': 'wrong-key',
            },
            body: JSON.stringify({}),
          })
        )

        expect(res.status).toBe(401)
      })

      if (E2E_API_KEY) {
        it('returns 200 when correct API key provided', async () => {
          const res = await app.fetch(
            new Request('http://localhost/e2e/cleanup', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-e2e-api-key': E2E_API_KEY,
              },
              body: JSON.stringify({}),
            })
          )

          // Should succeed
          expect(res.status).toBe(200)
          const body = await res.json()
          expect(body.success).toBe(true)
          expect(body.deleted).toBeDefined()
        })
      }
    })
  }
})
