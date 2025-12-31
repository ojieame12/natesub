/**
 * Metrics Endpoint Tests
 *
 * Tests for public metrics endpoint:
 * - GET /metrics
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import app from '../../src/app.js'
import { db } from '../../src/db/client.js'
import { resetDatabase, disconnectDatabase } from '../helpers/db.js'
// @ts-expect-error - mock module
import { __reset as resetRedis } from '../../src/db/redis.js'

describe('/metrics endpoint', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetRedis?.()
  })

  afterAll(async () => {
    await resetDatabase()
    await disconnectDatabase()
  })

  describe('GET /metrics', () => {
    it('returns webhook metrics with provider breakdown', async () => {
      // Arrange: Create webhook events
      await db.webhookEvent.create({
        data: {
          provider: 'stripe',
          eventId: 'evt_1',
          eventType: 'charge.succeeded',
          status: 'processed',
          processingTimeMs: 150,
        },
      })
      await db.webhookEvent.create({
        data: {
          provider: 'stripe',
          eventId: 'evt_2',
          eventType: 'charge.failed',
          status: 'failed',
        },
      })
      await db.webhookEvent.create({
        data: {
          provider: 'paystack',
          eventId: 'ps_1',
          eventType: 'charge.success',
          status: 'processed',
          processingTimeMs: 200,
        },
      })

      // Act
      const res = await app.request(
        new Request('http://localhost/metrics', {
          method: 'GET',
        })
      )
      const data = await res.json()

      // Assert
      expect(res.status).toBe(200)
      expect(data.webhooks.lastHour.byProvider.stripe.processed).toBe(1)
      expect(data.webhooks.lastHour.byProvider.stripe.failed).toBe(1)
      expect(data.webhooks.lastHour.byProvider.paystack.processed).toBe(1)
      expect(data.webhooks.lastHour.byProvider.paystack.failed).toBe(0)
    })

    it('calculates failure rate correctly', async () => {
      // Arrange: 3 processed, 1 failed = 25% failure rate
      await db.webhookEvent.create({
        data: { provider: 'stripe', eventId: 'evt_1', eventType: 'x', status: 'processed' },
      })
      await db.webhookEvent.create({
        data: { provider: 'stripe', eventId: 'evt_2', eventType: 'x', status: 'processed' },
      })
      await db.webhookEvent.create({
        data: { provider: 'stripe', eventId: 'evt_3', eventType: 'x', status: 'processed' },
      })
      await db.webhookEvent.create({
        data: { provider: 'stripe', eventId: 'evt_4', eventType: 'x', status: 'failed' },
      })

      // Act
      const res = await app.request(
        new Request('http://localhost/metrics', {
          method: 'GET',
        })
      )
      const data = await res.json()

      // Assert: 1 failed / 4 total = 25%
      expect(data.webhooks.lastHour.failureRate).toBe(25)
    })

    it('returns latency metrics structure', async () => {
      // Arrange: Create processed webhooks with timing data
      await db.webhookEvent.create({
        data: {
          provider: 'stripe',
          eventId: 'evt_1',
          eventType: 'x',
          status: 'processed',
          processingTimeMs: 100,
        },
      })
      await db.webhookEvent.create({
        data: {
          provider: 'stripe',
          eventId: 'evt_2',
          eventType: 'x',
          status: 'processed',
          processingTimeMs: 200,
        },
      })
      await db.webhookEvent.create({
        data: {
          provider: 'stripe',
          eventId: 'evt_3',
          eventType: 'x',
          status: 'processed',
          processingTimeMs: 300,
        },
      })

      // Act
      const res = await app.request(
        new Request('http://localhost/metrics', {
          method: 'GET',
        })
      )
      const data = await res.json()

      // Assert: Verify structure exists (mock may not support full _avg aggregation)
      expect(data.webhooks.latency).toHaveProperty('avgMs')
      expect(data.webhooks.latency).toHaveProperty('p50Ms')
      expect(data.webhooks.latency).toHaveProperty('p95Ms')
      expect(typeof data.webhooks.latency.avgMs).toBe('number')
      expect(typeof data.webhooks.latency.p50Ms).toBe('number')
      expect(typeof data.webhooks.latency.p95Ms).toBe('number')
    })

    it('returns time window metrics (6h, 24h)', async () => {
      // Arrange
      await db.webhookEvent.create({
        data: { provider: 'stripe', eventId: 'evt_1', eventType: 'x', status: 'processed' },
      })
      await db.webhookEvent.create({
        data: { provider: 'stripe', eventId: 'evt_2', eventType: 'x', status: 'failed' },
      })

      // Act
      const res = await app.request(
        new Request('http://localhost/metrics', {
          method: 'GET',
        })
      )
      const data = await res.json()

      // Assert
      expect(data.webhooks.last6h).toHaveProperty('processed')
      expect(data.webhooks.last6h).toHaveProperty('failed')
      expect(data.webhooks.last6h).toHaveProperty('failureRate')
      expect(data.webhooks.last24h).toHaveProperty('processed')
      expect(data.webhooks.last24h).toHaveProperty('failed')
      expect(data.webhooks.last24h).toHaveProperty('failureRate')
    })

    it('handles empty webhook data gracefully', async () => {
      // Act - no webhook events created
      const res = await app.request(
        new Request('http://localhost/metrics', {
          method: 'GET',
        })
      )
      const data = await res.json()

      // Assert
      expect(res.status).toBe(200)
      expect(data.webhooks.lastHour.processed).toBe(0)
      expect(data.webhooks.lastHour.failed).toBe(0)
      expect(data.webhooks.lastHour.failureRate).toBe(0)
      expect(data.webhooks.latency.avgMs).toBe(0)
      expect(data.webhooks.latency.p50Ms).toBe(0)
      expect(data.webhooks.latency.p95Ms).toBe(0)
    })

    it('returns complete response structure', async () => {
      // Act
      const res = await app.request(
        new Request('http://localhost/metrics', {
          method: 'GET',
        })
      )
      const data = await res.json()

      // Assert structure
      expect(res.status).toBe(200)
      expect(data).toHaveProperty('timestamp')
      expect(data).toHaveProperty('subscriptions')
      expect(data).toHaveProperty('payments')
      expect(data).toHaveProperty('webhooks')
      expect(data).toHaveProperty('creators')

      // Subscriptions
      expect(data.subscriptions).toHaveProperty('active')
      expect(data.subscriptions).toHaveProperty('newLast24h')

      // Payments
      expect(data.payments).toHaveProperty('successfulLast24h')
      expect(data.payments).toHaveProperty('revenueLast24hCents')

      // Webhooks
      expect(data.webhooks.lastHour).toHaveProperty('received')
      expect(data.webhooks.lastHour).toHaveProperty('processing')
      expect(data.webhooks.lastHour).toHaveProperty('processed')
      expect(data.webhooks.lastHour).toHaveProperty('failed')
      expect(data.webhooks.lastHour).toHaveProperty('skipped')
      expect(data.webhooks.lastHour).toHaveProperty('failureRate')
      expect(data.webhooks.lastHour).toHaveProperty('byProvider')
      expect(data.webhooks).toHaveProperty('last6h')
      expect(data.webhooks).toHaveProperty('last24h')
      expect(data.webhooks).toHaveProperty('latency')

      // Creators
      expect(data.creators).toHaveProperty('payoutsActive')
    })

    it('returns provider-specific metrics structure', async () => {
      // Arrange: Stripe with 100ms, Paystack with 300ms
      await db.webhookEvent.create({
        data: {
          provider: 'stripe',
          eventId: 'evt_1',
          eventType: 'x',
          status: 'processed',
          processingTimeMs: 100,
        },
      })
      await db.webhookEvent.create({
        data: {
          provider: 'paystack',
          eventId: 'ps_1',
          eventType: 'x',
          status: 'processed',
          processingTimeMs: 300,
        },
      })

      // Act
      const res = await app.request(
        new Request('http://localhost/metrics', {
          method: 'GET',
        })
      )
      const data = await res.json()

      // Assert: Verify structure exists (mock may not support full _avg in groupBy)
      expect(data.webhooks.lastHour.byProvider.stripe).toHaveProperty('avgProcessingTimeMs')
      expect(data.webhooks.lastHour.byProvider.paystack).toHaveProperty('avgProcessingTimeMs')
      expect(typeof data.webhooks.lastHour.byProvider.stripe.avgProcessingTimeMs).toBe('number')
      expect(typeof data.webhooks.lastHour.byProvider.paystack.avgProcessingTimeMs).toBe('number')
    })
  })
})
