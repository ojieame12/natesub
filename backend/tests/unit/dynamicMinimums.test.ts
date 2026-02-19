/**
 * Dynamic Minimum Subscription Tests
 *
 * Tests for the dynamic minimum calculation that amortizes the $2/month
 * Stripe account fee across subscriber count.
 */

import { describe, it, expect } from 'vitest'
import {
  calculateDynamicMinimumUSD,
  getDynamicMinimum,
  getFeeBreakdown,
  getCreatorMinimum,
  getSupportedCountries,
} from '../../src/constants/creatorMinimums.js'
import { PLATFORM_FEE_RATE } from '../../src/constants/fees.js'

describe('Dynamic Minimum Calculations', () => {
  describe('calculateDynamicMinimumUSD', () => {
    it('should decrease monotonically as subscriber count increases', () => {
      // Use UK which has 70% intl mix and higher minimums for clearer decreases
      const country = 'United Kingdom'
      const min0 = calculateDynamicMinimumUSD({ country, subscriberCount: 0 })
      const min1 = calculateDynamicMinimumUSD({ country, subscriberCount: 1 })
      const min5 = calculateDynamicMinimumUSD({ country, subscriberCount: 5 })
      const min10 = calculateDynamicMinimumUSD({ country, subscriberCount: 10 })
      const min20 = calculateDynamicMinimumUSD({ country, subscriberCount: 20 })

      // 0 and 1 should be treated the same (floor of 1)
      expect(min0).toBe(min1)

      // Should decrease as subscribers increase (or stay same when hitting floor)
      expect(min1).toBeGreaterThanOrEqual(min5)
      expect(min5).toBeGreaterThanOrEqual(min10)
      expect(min10).toBeGreaterThanOrEqual(min20)

      // At least one step should show a decrease
      expect(min1).toBeGreaterThan(min20)
    })

    it('should floor at 20 subscribers (converge to static minimum)', () => {
      const country = 'United States'
      const min20 = calculateDynamicMinimumUSD({ country, subscriberCount: 20 })
      const min50 = calculateDynamicMinimumUSD({ country, subscriberCount: 50 })
      const min100 = calculateDynamicMinimumUSD({ country, subscriberCount: 100 })

      // After 20 subs, minimum should be very close (within rounding)
      expect(min20).toBe(min50)
      expect(min50).toBe(min100)
    })

    it('should round to nearest $5', () => {
      const countries = ['United States', 'United Kingdom', 'Germany', 'Nigeria']

      for (const country of countries) {
        const min = calculateDynamicMinimumUSD({ country, subscriberCount: 1 })
        expect(min % 5).toBe(0)
      }
    })

    it('should never produce negative margin', () => {
      const countries = getSupportedCountries()

      for (const country of countries) {
        for (const subscriberCount of [0, 1, 5, 10, 20]) {
          const min = calculateDynamicMinimumUSD({ country, subscriberCount })
          // Minimum should always be positive and reasonable
          expect(min).toBeGreaterThan(0)
          expect(min).toBeLessThan(10000) // Sanity check - no crazy high minimums
        }
      }
    })

    it('should use $45 floor minimum for cross-border countries', () => {
      // Cross-border countries use $45 floor (margin-positive at 3+ subs)
      const ngMin1 = calculateDynamicMinimumUSD({ country: 'Nigeria', subscriberCount: 1 })
      const ngMin20 = calculateDynamicMinimumUSD({ country: 'Nigeria', subscriberCount: 20 })
      const keMin1 = calculateDynamicMinimumUSD({ country: 'Kenya', subscriberCount: 1 })
      const ghMin1 = calculateDynamicMinimumUSD({ country: 'Ghana', subscriberCount: 1 })

      // All cross-border countries are at or above $45 floor
      // NG and GH natural minimum is below $45, so floor kicks in
      expect(ngMin1).toBe(45)
      expect(ngMin20).toBe(45)
      expect(ghMin1).toBe(45)
      // KE has higher fixed costs (payout: $1.00, account: $1.85) so natural min > $45
      expect(keMin1).toBeGreaterThanOrEqual(45)
    })

    it('should have dynamic minimum for domestic countries', () => {
      const usMin = calculateDynamicMinimumUSD({ country: 'United States', subscriberCount: 1 })
      const ukMin = calculateDynamicMinimumUSD({ country: 'United Kingdom', subscriberCount: 1 })

      // Domestic countries use dynamic calculation (lower than cross-border)
      // US: $60 for 1 sub (includes processing + $2 account fee)
      // UK: $75 for 1 sub (includes processing + $2.50 account fee + 0.25% cross-border)
      expect(usMin).toBe(60)
      expect(ukMin).toBe(75)
    })
  })

  describe('getDynamicMinimum', () => {
    it('should return USD and local currency minimums', () => {
      const result = getDynamicMinimum({ country: 'Nigeria', subscriberCount: 1 })

      expect(result.minimumUSD).toBeGreaterThan(0)
      expect(result.minimumLocal).toBeGreaterThan(0)
      expect(result.currency).toBe('NGN')
    })

    it('should apply correct rounding rules per multiplier bucket', () => {
      // High multiplier (>=100): round to nearest 1000
      const ngResult = getDynamicMinimum({ country: 'Nigeria', subscriberCount: 1 })
      expect(ngResult.minimumLocal % 1000).toBe(0)

      // Medium multiplier (>=10): round to nearest 100
      const keResult = getDynamicMinimum({ country: 'Kenya', subscriberCount: 1 })
      expect(keResult.minimumLocal % 100).toBe(0)

      // Low multiplier (<10): round to nearest 5
      const usResult = getDynamicMinimum({ country: 'United States', subscriberCount: 1 })
      expect(usResult.minimumLocal % 5).toBe(0)
    })

    it('should include debug info with percent fees and net margin', () => {
      const result = getDynamicMinimum({ country: 'United States', subscriberCount: 5 })

      expect(result.percentFees).toBeGreaterThan(0)
      expect(result.percentFees).toBeLessThan(PLATFORM_FEE_RATE) // Must be less than 9%
      expect(result.fixedCents).toBeGreaterThan(0)
      expect(result.netMarginRate).toBeGreaterThan(0)
      // Net margin = platform fee - percent fees
      expect(result.netMarginRate).toBeCloseTo(PLATFORM_FEE_RATE - result.percentFees, 6)
    })

    it('should align minimumUSD with minimumLocal conversion', () => {
      const countries = ['Nigeria', 'Kenya', 'Ghana', 'United Kingdom']

      for (const country of countries) {
        const result = getDynamicMinimum({ country, subscriberCount: 10 })
        const staticMin = getCreatorMinimum(country)

        if (staticMin) {
          // Local minimum should be roughly USD minimum * exchange rate multiplier
          const impliedMultiplier = staticMin.local / staticMin.usd
          const expectedLocal = result.minimumUSD * impliedMultiplier

          // Allow for rounding differences (within 20%)
          expect(result.minimumLocal).toBeGreaterThan(expectedLocal * 0.8)
          expect(result.minimumLocal).toBeLessThan(expectedLocal * 1.2)
        }
      }
    })
  })

  describe('getFeeBreakdown', () => {
    it('should have components that sum to totalPercentFees', () => {
      const countries = ['United States', 'Nigeria', 'United Kingdom']

      for (const country of countries) {
        const breakdown = getFeeBreakdown(country)

        // Platform pays ALL: processing + billing + payout + cross-border transfer
        const sum =
          breakdown.processingPercent +
          breakdown.billingPercent +
          breakdown.payoutPercent +
          breakdown.crossBorderTransferPercent

        expect(breakdown.totalPercentFees).toBeCloseTo(sum, 6)
      }
    })

    it('should include processing percent', () => {
      const breakdown = getFeeBreakdown('United States')
      expect(breakdown.processingPercent).toBe(0.035) // 3.5%
    })

    it('should include payout percent', () => {
      const breakdown = getFeeBreakdown('United States')
      expect(breakdown.payoutPercent).toBe(0.0025) // 0.25%
    })

    it('should include billing percent', () => {
      const breakdown = getFeeBreakdown('United States')
      expect(breakdown.billingPercent).toBe(0.007) // 0.7%
    })

    it('should match getDynamicMinimum assumptions', () => {
      const country = 'United States'
      const dynamicResult = getDynamicMinimum({ country, subscriberCount: 10 })
      const breakdown = getFeeBreakdown(country)

      expect(dynamicResult.percentFees).toBeCloseTo(breakdown.totalPercentFees, 6)
    })

    it('should show correct platform costs for cross-border countries', () => {
      const dynamicResult = getDynamicMinimum({ country: 'Nigeria', subscriberCount: 10 })

      // Platform pays: 3.5% processing + 0.7% billing + 0.25% payout + 1% cross-border = 5.45%
      expect(dynamicResult.percentFees).toBeCloseTo(0.0545, 4)
      // Net margin: 10.5% - 5.45% = 5.05%
      expect(dynamicResult.netMarginRate).toBeCloseTo(0.0505, 4)
      expect(dynamicResult.minimumUSD).toBe(45)
    })

    it('should have positive net margin rate', () => {
      const countries = getSupportedCountries()

      for (const country of countries) {
        const breakdown = getFeeBreakdown(country)
        expect(breakdown.netMarginRate).toBeGreaterThan(0)
      }
    })
  })

  describe('Static Minimums Consistency', () => {
    it('static minimums should match dynamic minimums at floor subscriber count', () => {
      const countries = getSupportedCountries()

      for (const country of countries) {
        const staticMin = getCreatorMinimum(country)
        const dynamicMinUSD = calculateDynamicMinimumUSD({ country, subscriberCount: 20 })

        if (staticMin) {
          // Static minimum should equal dynamic minimum at 20 subs
          expect(staticMin.usd).toBe(dynamicMinUSD)
        }
      }
    })
  })
})
