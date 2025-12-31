import { test, expect } from '@playwright/test'

/**
 * Config Endpoint E2E Tests
 *
 * Tests public configuration endpoints used by the frontend.
 * These endpoints provide fee rates and AI availability status.
 *
 * Run with: npx playwright test config.spec.ts
 */

const API_URL = 'http://localhost:3001'

test.describe('Config Endpoints', () => {
  test.describe('/config/fees', () => {
    test('returns fee configuration with correct structure', async ({ request }) => {
      const response = await request.get(`${API_URL}/config/fees`)

      expect(response.status()).toBe(200)

      const data = await response.json()

      // Verify all required fields are present
      expect(data).toHaveProperty('platformFeeRate')
      expect(data).toHaveProperty('splitRate')
      expect(data).toHaveProperty('crossBorderBuffer')
      expect(data).toHaveProperty('platformFeePercent')
      expect(data).toHaveProperty('splitPercent')
    })

    test('returns correct fee values (9% platform, 4.5% split)', async ({ request }) => {
      const response = await request.get(`${API_URL}/config/fees`)

      expect(response.status()).toBe(200)

      const data = await response.json()

      // Platform fee should be 9% (0.09)
      expect(data.platformFeeRate).toBe(0.09)
      expect(data.platformFeePercent).toBe(9)

      // Split rate should be 4.5% each (0.045)
      expect(data.splitRate).toBe(0.045)
      expect(data.splitPercent).toBe(4.5)

      // Cross-border buffer should be 1.5% (0.015)
      expect(data.crossBorderBuffer).toBe(0.015)
    })

    test('returns cacheable response headers', async ({ request }) => {
      const response = await request.get(`${API_URL}/config/fees`)

      expect(response.status()).toBe(200)

      // Should have cache-control header for 1 hour
      const cacheControl = response.headers()['cache-control']
      expect(cacheControl).toContain('public')
      expect(cacheControl).toContain('max-age=3600')
    })

    test('is publicly accessible without auth', async ({ request }) => {
      // No auth header
      const response = await request.get(`${API_URL}/config/fees`)

      // Should still succeed (public endpoint)
      expect(response.status()).toBe(200)
    })
  })

  test.describe('/config/ai', () => {
    test('returns AI availability status', async ({ request }) => {
      const response = await request.get(`${API_URL}/config/ai`)

      expect(response.status()).toBe(200)

      const data = await response.json()

      // Verify structure
      expect(data).toHaveProperty('available')
      expect(typeof data.available).toBe('boolean')
    })

    test('returns cacheable response headers', async ({ request }) => {
      const response = await request.get(`${API_URL}/config/ai`)

      expect(response.status()).toBe(200)

      // Should have cache-control header for 5 minutes
      const cacheControl = response.headers()['cache-control']
      expect(cacheControl).toContain('public')
      expect(cacheControl).toContain('max-age=300')
    })

    test('is publicly accessible without auth', async ({ request }) => {
      const response = await request.get(`${API_URL}/config/ai`)
      expect(response.status()).toBe(200)
    })
  })

  test.describe('Frontend Integration', () => {
    test('fees match expected calculation for $10 subscription', async ({ request }) => {
      const response = await request.get(`${API_URL}/config/fees`)
      const { platformFeeRate, splitRate } = await response.json()

      // Test calculation: $10 subscription
      const subscriptionAmount = 1000 // cents
      const platformFee = Math.round(subscriptionAmount * platformFeeRate)
      const creatorSplit = Math.round(subscriptionAmount * splitRate)
      const subscriberSplit = Math.round(subscriptionAmount * splitRate)

      // Platform fee: $0.90
      expect(platformFee).toBe(90)

      // Creator pays: $0.45
      expect(creatorSplit).toBe(45)

      // Subscriber pays: $0.45
      expect(subscriberSplit).toBe(45)

      // Total: $0.90 (matches platform fee when both pay split)
      expect(creatorSplit + subscriberSplit).toBe(platformFee)
    })

    test('fees match expected calculation for NGN 5000 subscription', async ({ request }) => {
      const response = await request.get(`${API_URL}/config/fees`)
      const { platformFeeRate, splitRate, crossBorderBuffer } = await response.json()

      // Test calculation: NGN 5000 subscription (cross-border)
      const subscriptionAmount = 500000 // kobo (5000 NGN)

      const platformFee = Math.round(subscriptionAmount * platformFeeRate)
      const crossBorderFee = Math.round(subscriptionAmount * crossBorderBuffer)

      // Platform fee: 450 NGN
      expect(platformFee).toBe(45000) // 450 NGN in kobo

      // Cross-border buffer: 75 NGN
      expect(crossBorderFee).toBe(7500) // 75 NGN in kobo
    })
  })
})
