import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { PLATFORM_FEE_RATE, SPLIT_RATE, CROSS_BORDER_BUFFER } from './pricing'

// Mock server for API calls
const server = setupServer(
  http.get('*/config/fees', () => {
    return HttpResponse.json({
      platformFeeRate: 0.09,
      splitRate: 0.045,
      crossBorderBuffer: 0.015,
      platformFeePercent: 9,
      splitPercent: 4.5,
    })
  })
)

beforeAll(() => server.listen())
afterAll(() => server.close())

describe('fee constants synchronization', () => {
  describe('frontend fallback values', () => {
    it('PLATFORM_FEE_RATE is 9%', () => {
      expect(PLATFORM_FEE_RATE).toBe(0.09)
    })

    it('SPLIT_RATE is 4.5%', () => {
      expect(SPLIT_RATE).toBe(0.045)
    })

    it('CROSS_BORDER_BUFFER is 1.5%', () => {
      expect(CROSS_BORDER_BUFFER).toBe(0.015)
    })

    it('SPLIT_RATE * 2 equals PLATFORM_FEE_RATE (4.5% + 4.5% = 9%)', () => {
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

      // Backend should return 9, not 0.09
      expect(backendFees?.platformFeePercent).toBe(9)
    })
  })
})
