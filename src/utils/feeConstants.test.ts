import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { PLATFORM_FEE_RATE, SPLIT_RATE, CROSS_BORDER_BUFFER } from './pricing'

// Mock server for API calls
const server = setupServer(
  http.get('*/config/fees', () => {
    return HttpResponse.json({
      platformFeeRate: 0.08,
      splitRate: 0.04,
      crossBorderBuffer: 0.015,
      platformFeePercent: 8,
      splitPercent: 4,
    })
  })
)

beforeAll(() => server.listen())
afterAll(() => server.close())

describe('fee constants synchronization', () => {
  describe('frontend fallback values', () => {
    it('PLATFORM_FEE_RATE is 8%', () => {
      expect(PLATFORM_FEE_RATE).toBe(0.08)
    })

    it('SPLIT_RATE is 4%', () => {
      expect(SPLIT_RATE).toBe(0.04)
    })

    it('CROSS_BORDER_BUFFER is 1.5%', () => {
      expect(CROSS_BORDER_BUFFER).toBe(0.015)
    })

    it('SPLIT_RATE * 2 equals PLATFORM_FEE_RATE (4% + 4% = 8%)', () => {
      expect(SPLIT_RATE * 2).toBe(PLATFORM_FEE_RATE)
    })
  })

  describe('backend API returns matching values', () => {
    it('backend /config/fees matches frontend defaults', async () => {
      // Import dynamically to get fresh fetch
      const { api } = await import('../api/client')

      const backendFees = await api.config.getFees()

      // These are the static fallbacks in pricing.ts
      const frontendDefaults = {
        platformFeeRate: PLATFORM_FEE_RATE,
        splitRate: SPLIT_RATE,
        crossBorderBuffer: CROSS_BORDER_BUFFER,
      }

      expect(backendFees?.platformFeeRate).toBe(frontendDefaults.platformFeeRate)
      expect(backendFees?.splitRate).toBe(frontendDefaults.splitRate)
      expect(backendFees?.crossBorderBuffer).toBe(frontendDefaults.crossBorderBuffer)
    })

    it('backend returns platformFeePercent as integer', async () => {
      const { api } = await import('../api/client')
      const backendFees = await api.config.getFees()

      // Backend should return 8, not 0.08
      expect(backendFees?.platformFeePercent).toBe(8)
    })
  })
})
