/**
 * FX Rate Conversion Unit Tests
 *
 * Tests for the FX rate functions used in payment reporting.
 */

import { describe, it, expect } from 'vitest'
import { convertUSDCentsToLocal, convertLocalCentsToUSD } from '../../src/services/fx.js'

describe('FX conversion functions', () => {
  describe('convertUSDCentsToLocal', () => {
    it('converts USD cents to local currency using rate', () => {
      // 1 USD = 1600 NGN, so 100 cents ($1) = 160000 kobo
      expect(convertUSDCentsToLocal(100, 1600)).toBe(160000)
    })

    it('handles fractional amounts with rounding', () => {
      // 1 USD = 1600 NGN, 50 cents = 80000 kobo
      expect(convertUSDCentsToLocal(50, 1600)).toBe(80000)
    })

    it('returns 0 for 0 input', () => {
      expect(convertUSDCentsToLocal(0, 1600)).toBe(0)
    })
  })

  describe('convertLocalCentsToUSD', () => {
    it('converts local currency to USD cents using rate', () => {
      // 1 USD = 1600 NGN, so 160000 kobo = 100 cents ($1)
      expect(convertLocalCentsToUSD(160000, 1600)).toBe(100)
    })

    it('handles fractional amounts with rounding', () => {
      // 80000 kobo at rate 1600 = 50 cents
      expect(convertLocalCentsToUSD(80000, 1600)).toBe(50)
    })

    it('returns 0 for rate of 0', () => {
      expect(convertLocalCentsToUSD(160000, 0)).toBe(0)
    })

    it('returns 0 for 0 input', () => {
      expect(convertLocalCentsToUSD(0, 1600)).toBe(0)
    })

    it('rounds correctly for non-exact conversions', () => {
      // 1000 kobo at rate 1600 = 0.625 cents, should round to 1
      expect(convertLocalCentsToUSD(1000, 1600)).toBe(1)
    })
  })

  describe('round-trip conversion', () => {
    it('preserves value when converting back and forth (exact)', () => {
      const original = 1000 // 1000 USD cents = $10
      const rate = 1600
      const local = convertUSDCentsToLocal(original, rate)
      const backToUSD = convertLocalCentsToUSD(local, rate)
      expect(backToUSD).toBe(original)
    })

    it('Stripe rate usage example', () => {
      // If Stripe's exchange_rate is 1600 (NGN per USD)
      // And we have a payment of 160000 kobo
      // Then USD amount = 160000 / 1600 = 100 cents
      const stripeRate = 1600
      const localAmount = 160000
      const usdAmount = convertLocalCentsToUSD(localAmount, stripeRate)
      expect(usdAmount).toBe(100)
    })
  })
})
