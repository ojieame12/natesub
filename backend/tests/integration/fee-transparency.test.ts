/**
 * Fee Transparency Integration Tests
 *
 * Tests that fee information is consistent across:
 * - Config API endpoints
 * - Checkout metadata
 * - Activity detail responses
 *
 * Ensures what we tell users matches what we actually charge.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import app from '../../src/app.js'
import { db } from '../../src/db/client.js'
import { calculateServiceFee } from '../../src/services/fees.js'

describe('Fee Transparency E2E', () => {
  describe('config API accuracy', () => {
    it('GET /config/fees is cacheable', async () => {
      const res = await app.fetch(new Request('http://localhost/config/fees'))
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600')
    })

    it('GET /config/fees returns all required fields', async () => {
      const res = await app.fetch(new Request('http://localhost/config/fees'))
      const data = await res.json()

      // Core rates
      expect(data).toHaveProperty('platformFeeRate')
      expect(data).toHaveProperty('splitRate')
      expect(data).toHaveProperty('crossBorderBuffer')

      // Derived convenience values
      expect(data).toHaveProperty('platformFeePercent')
      expect(data).toHaveProperty('splitPercent')
      expect(data).toHaveProperty('domesticFeePercent')
      expect(data).toHaveProperty('crossBorderFeePercent')
      expect(data).toHaveProperty('domesticSplitPercent')
      expect(data).toHaveProperty('crossBorderSplitPercent')
    })

    it('GET /config/minimums includes all required meta fields', async () => {
      const res = await app.fetch(new Request('http://localhost/config/minimums'))
      const data = await res.json()

      expect(data.meta).toHaveProperty('platformFee')
      expect(data.meta).toHaveProperty('model')
      expect(data.meta).toHaveProperty('feeBreakdown')
      expect(data.meta.feeBreakdown).toHaveProperty('domestic')
      expect(data.meta.feeBreakdown).toHaveProperty('crossBorder')
      expect(data.meta).toHaveProperty('minimumBreakdown')
      expect(data.meta.minimumBreakdown).toHaveProperty('domestic')
      expect(data.meta.minimumBreakdown).toHaveProperty('crossBorder')
    })

    it('GET /config/minimums/:country returns 404 for unknown country', async () => {
      const res = await app.fetch(new Request('http://localhost/config/minimums/Narnia'))
      expect(res.status).toBe(404)
    })

    it('GET /config/minimums/:country returns fee breakdown', async () => {
      const res = await app.fetch(new Request('http://localhost/config/minimums/Nigeria'))
      const data = await res.json()

      expect(data).toHaveProperty('country', 'Nigeria')
      expect(data).toHaveProperty('usd')
      expect(data).toHaveProperty('local')
      expect(data).toHaveProperty('currency')
      expect(data).toHaveProperty('fees')
    })
  })

  describe('minimum validation consistency', () => {
    it('cross-border countries have $85 minimum', async () => {
      const countries = ['Nigeria', 'Ghana', 'Kenya']

      for (const country of countries) {
        const res = await app.fetch(new Request(`http://localhost/config/minimums/${country}`))
        const data = await res.json()
        expect(data.usd).toBe(85)
      }
    })

    it('domestic countries have variable minimums', async () => {
      const res1 = await app.fetch(new Request('http://localhost/config/minimums/United%20States'))
      const data1 = await res1.json()

      const res2 = await app.fetch(new Request('http://localhost/config/minimums/United%20Kingdom'))
      const data2 = await res2.json()

      // Should have minimums, but not necessarily the same
      expect(data1.usd).toBeGreaterThan(0)
      expect(data2.usd).toBeGreaterThan(0)
      // And definitely not $85 flat
      expect(data1.usd).toBeLessThan(85)
    })
  })

  describe('fee calculation consistency', () => {
    it('calculateServiceFee output matches expected format', () => {
      const result = calculateServiceFee(10000, 'USD', 'personal')

      // Required fields
      expect(result).toHaveProperty('baseCents')
      expect(result).toHaveProperty('grossCents')
      expect(result).toHaveProperty('netCents')
      expect(result).toHaveProperty('feeCents')
      expect(result).toHaveProperty('subscriberFeeCents')
      expect(result).toHaveProperty('creatorFeeCents')
      expect(result).toHaveProperty('feeMode')
      expect(result).toHaveProperty('feeModel')
      expect(result).toHaveProperty('estimatedProcessorFee')
      expect(result).toHaveProperty('estimatedMargin')
    })

    it('all calculations use split model', () => {
      const scenarios = [
        { amount: 1000, currency: 'USD', crossBorder: false },
        { amount: 10000, currency: 'USD', crossBorder: false },
        { amount: 10000, currency: 'USD', crossBorder: true },
        { amount: 100000, currency: 'NGN', crossBorder: false },
      ]

      for (const { amount, currency, crossBorder } of scenarios) {
        const result = calculateServiceFee(amount, currency, 'personal', undefined, crossBorder)
        expect(result.feeMode).toBe('split')
        expect(result.feeModel).toBe('split_v1')
      }
    })

    it('processor buffer kicks in on small amounts', () => {
      // $1 transaction - processor fee would eat all of 9%
      const result = calculateServiceFee(100, 'USD', 'personal')
      expect(result.feeWasCapped).toBe(true)
      expect(result.estimatedMargin).toBeGreaterThan(0)
    })

    it('no processor buffer on large amounts', () => {
      // $500 transaction - 9% is plenty
      const result = calculateServiceFee(50000, 'USD', 'personal')
      expect(result.feeWasCapped).toBe(false)
      expect(result.feeCents).toBe(4500) // Exact 9%
    })
  })

  describe('cross-border detection', () => {
    it('config API lists cross-border countries', async () => {
      const res = await app.fetch(new Request('http://localhost/config/minimums'))
      const data = await res.json()

      expect(data.meta.assumptions.crossBorderCountries).toContain('NG')
      expect(data.meta.assumptions.crossBorderCountries).toContain('GH')
      expect(data.meta.assumptions.crossBorderCountries).toContain('KE')
    })
  })

  describe('fee model documentation', () => {
    it('config API documents destination charge model', async () => {
      const res = await app.fetch(new Request('http://localhost/config/minimums'))
      const data = await res.json()

      expect(data.meta.model).toContain('Destination charges')
      expect(data.meta.model).toContain('platform absorbs')
    })

    it('no mention of direct charges in config', async () => {
      const res = await app.fetch(new Request('http://localhost/config/minimums'))
      const text = await res.text()

      expect(text.toLowerCase()).not.toContain('direct charge')
      expect(text.toLowerCase()).not.toContain('direct_v1')
    })
  })
})

describe('Supported Countries', () => {
  it('all supported countries have valid minimums', async () => {
    const res = await app.fetch(new Request('http://localhost/config/minimums'))
    const data = await res.json()

    for (const country of data.supportedCountries) {
      const minRes = await app.fetch(
        new Request(`http://localhost/config/minimums/${encodeURIComponent(country)}`)
      )
      expect(minRes.status).toBe(200)

      const minData = await minRes.json()
      expect(minData.usd).toBeGreaterThan(0)
      expect(minData.local).toBeGreaterThan(0)
      expect(minData.currency).toBeTruthy()
    }
  })
})
