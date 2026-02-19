/**
 * Fee Model Consistency Tests
 *
 * Verifies that the fee model is consistent across all touchpoints:
 * - Config API responses
 * - Fee calculations
 * - Cross-border vs domestic rates
 *
 * All countries use DESTINATION charges with:
 * - Domestic: 9% total (4.5%/4.5% split)
 * - Cross-border: 10.5% total (5.25%/5.25% split)
 */

import { describe, it, expect } from 'vitest'
import app from '../../src/app.js'
import { calculateServiceFee } from '../../src/services/fees.js'
import {
  PLATFORM_FEE_RATE,
  SPLIT_RATE,
  CROSS_BORDER_BUFFER,
  isCrossBorderCountry,
} from '../../src/constants/fees.js'
import {
  calculateDynamicMinimumUSD,
  getCreatorMinimum,
  getDynamicMinimum,
  getFeeBreakdown,
} from '../../src/constants/creatorMinimums.js'

describe('Fee Model Consistency', () => {
  describe('rate constants', () => {
    it('should have correct base rates', () => {
      expect(PLATFORM_FEE_RATE).toBe(0.09) // 9%
      expect(SPLIT_RATE).toBe(0.045) // 4.5%
      expect(CROSS_BORDER_BUFFER).toBe(0.015) // 1.5%
    })

    it('cross-border rate = base + buffer', () => {
      const crossBorderRate = PLATFORM_FEE_RATE + CROSS_BORDER_BUFFER
      expect(crossBorderRate).toBe(0.105) // 10.5%
    })

    it('split rates add up to total rate', () => {
      // Domestic: 4.5% + 4.5% = 9%
      expect(SPLIT_RATE * 2).toBe(PLATFORM_FEE_RATE)

      // Cross-border: 5.25% + 5.25% = 10.5%
      const crossBorderSplit = SPLIT_RATE + CROSS_BORDER_BUFFER / 2
      expect(crossBorderSplit * 2).toBe(PLATFORM_FEE_RATE + CROSS_BORDER_BUFFER)
    })
  })

  describe('domestic countries (9% fee)', () => {
    const domesticCountries = ['United States', 'United Kingdom', 'Germany', 'France', 'Canada']

    it.each(domesticCountries)('%s should NOT be cross-border', (country) => {
      expect(isCrossBorderCountry(country)).toBe(false)
    })

    it('should apply 9% total fee (4.5%/4.5% split)', () => {
      const result = calculateServiceFee(10000, 'USD', 'personal')
      expect(result.subscriberFeeCents).toBe(450) // 4.5%
      expect(result.creatorFeeCents).toBe(450) // 4.5%
      expect(result.feeCents).toBe(900) // 9% total
    })

    it('should have dynamic minimum based on subscriber count', () => {
      const min1 = calculateDynamicMinimumUSD({ country: 'United States', subscriberCount: 1 })
      const min20 = calculateDynamicMinimumUSD({ country: 'United States', subscriberCount: 20 })

      // Higher minimum for new creators (amortizing $2 account fee)
      expect(min1).toBeGreaterThan(min20)

      // Dynamic minimum varies with subscriber count (unlike cross-border flat $45)
      expect(min1).not.toBe(min20)
    })
  })

  describe('US domestic fees (destination charges = platform pays all)', () => {
    it('US total percent fees should be ~4.45% (processing + billing + payout)', () => {
      const breakdown = getFeeBreakdown('United States')
      // 3.5% processing + 0.7% billing + 0.25% payout + 0% cross-border = 4.45%
      expect(breakdown.totalPercentFees).toBeCloseTo(0.0445, 4)
    })

    it('US net margin should be ~4.55% (9% - 4.45%)', () => {
      const breakdown = getFeeBreakdown('United States')
      expect(breakdown.netMarginRate).toBeCloseTo(0.0455, 4)
    })

    it('US minimum for 1 subscriber should be $60', () => {
      const min = getDynamicMinimum({ country: 'United States', subscriberCount: 1 })
      expect(min.minimumUSD).toBe(60)
    })

    it('US minimum for 20 subscribers should be $15', () => {
      const min = getDynamicMinimum({ country: 'United States', subscriberCount: 20 })
      expect(min.minimumUSD).toBe(15)
    })
  })

  describe('UK/EU domestic fees (higher cross-border transfer)', () => {
    it('UK has higher total fees than US due to cross-border transfer', () => {
      const ukBreakdown = getFeeBreakdown('United Kingdom')
      const usBreakdown = getFeeBreakdown('United States')
      // UK has 0.25% cross-border transfer, US has 0%
      expect(ukBreakdown.totalPercentFees).toBeGreaterThan(usBreakdown.totalPercentFees)
    })

    it('UK has higher minimum than US due to higher account fees and cross-border', () => {
      const ukMin = getDynamicMinimum({ country: 'United Kingdom', subscriberCount: 1 })
      const usMin = getDynamicMinimum({ country: 'United States', subscriberCount: 1 })
      // UK: $2.50/month account + 0.25% cross-border > US: $2.00/month + 0%
      expect(ukMin.minimumUSD).toBeGreaterThan(usMin.minimumUSD)
    })
  })

  describe('monthly account fee amortization', () => {
    it('account fee is $2.00/month for US creators', () => {
      const breakdown = getFeeBreakdown('United States')
      expect(breakdown.monthlyAccountFeeCents).toBe(200)
    })

    it('minimum decreases as subscriber count increases', () => {
      const min1 = getDynamicMinimum({ country: 'United States', subscriberCount: 1 })
      const min5 = getDynamicMinimum({ country: 'United States', subscriberCount: 5 })
      const min20 = getDynamicMinimum({ country: 'United States', subscriberCount: 20 })

      // More subscribers = lower minimum (fixed costs spread out)
      expect(min1.minimumUSD).toBeGreaterThan(min5.minimumUSD)
      expect(min5.minimumUSD).toBeGreaterThanOrEqual(min20.minimumUSD)
    })

    it('account fee is amortized per subscriber in fixed costs', () => {
      const min1 = getDynamicMinimum({ country: 'United States', subscriberCount: 1 })
      const min20 = getDynamicMinimum({ country: 'United States', subscriberCount: 20 })

      // At 1 sub: fixed costs include full $2.00 account fee
      // At 20 subs: fixed costs include $2.00/20 = $0.10 per sub
      expect(min1.fixedCents).toBeGreaterThan(min20.fixedCents)

      // Difference should be roughly $2.00 - $0.10 = $1.90 (190 cents)
      const diff = min1.fixedCents - min20.fixedCents
      expect(diff).toBeCloseTo(190, 0)
    })

    it('cross-border countries also amortize but stay at $45 floor', () => {
      const ng1 = getDynamicMinimum({ country: 'Nigeria', subscriberCount: 1 })
      const ng20 = getDynamicMinimum({ country: 'Nigeria', subscriberCount: 20 })

      // Both hit the $45 floor
      expect(ng1.minimumUSD).toBe(45)
      expect(ng20.minimumUSD).toBe(45)

      // But fixed costs still differ (amortization still happens)
      expect(ng1.fixedCents).toBeGreaterThan(ng20.fixedCents)
    })
  })

  describe('cross-border countries (10.5% fee)', () => {
    // South Africa is cross-border per Stripe pricing (asterisk = cross-border payouts only)
    const crossBorderCountries = ['Nigeria', 'Ghana', 'Kenya', 'South Africa']

    it.each(crossBorderCountries)('%s should be cross-border', (country) => {
      expect(isCrossBorderCountry(country)).toBe(true)
    })

    it('should apply 10.5% total fee (5.25%/5.25% split)', () => {
      const result = calculateServiceFee(10000, 'USD', 'personal', undefined, true)
      expect(result.subscriberFeeCents).toBe(525) // 5.25%
      expect(result.creatorFeeCents).toBe(525) // 5.25%
      expect(result.feeCents).toBe(1050) // 10.5% total
    })

    it('should use flat $45 minimum for cross-border countries', () => {
      const min1 = calculateDynamicMinimumUSD({ country: 'Nigeria', subscriberCount: 1 })
      const min20 = calculateDynamicMinimumUSD({ country: 'Nigeria', subscriberCount: 20 })

      // Cross-border countries use $45 floor (margin-positive at 3+ subs)
      expect(min1).toBe(45)
      expect(min20).toBe(45)
    })

    it('all cross-border countries have minimum at or above $25 floor', () => {
      for (const country of crossBorderCountries) {
        const staticMin = getCreatorMinimum(country)
        expect(staticMin?.usd).toBeGreaterThanOrEqual(25)
      }
    })
  })

  describe('fee calculation math parity', () => {
    it('subscriberFeeCents + creatorFeeCents === feeCents', () => {
      const amounts = [1000, 5000, 10000, 50000]

      for (const amount of amounts) {
        const result = calculateServiceFee(amount, 'USD', 'personal')
        expect(result.subscriberFeeCents + result.creatorFeeCents).toBe(result.feeCents)
      }
    })

    it('grossCents - netCents === feeCents', () => {
      const amounts = [1000, 5000, 10000, 50000]

      for (const amount of amounts) {
        const result = calculateServiceFee(amount, 'USD', 'personal')
        expect(result.grossCents - result.netCents).toBe(result.feeCents)
      }
    })

    it('baseCents + subscriberFeeCents === grossCents', () => {
      const amounts = [1000, 5000, 10000, 50000]

      for (const amount of amounts) {
        const result = calculateServiceFee(amount, 'USD', 'personal')
        expect(result.baseCents + result.subscriberFeeCents).toBe(result.grossCents)
      }
    })

    it('baseCents - creatorFeeCents === netCents', () => {
      const amounts = [1000, 5000, 10000, 50000]

      for (const amount of amounts) {
        const result = calculateServiceFee(amount, 'USD', 'personal')
        expect(result.baseCents - result.creatorFeeCents).toBe(result.netCents)
      }
    })
  })

  describe('config API consistency', () => {
    it('GET /config/fees returns correct rates', async () => {
      const res = await app.fetch(new Request('http://localhost/config/fees'))
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.platformFeeRate).toBe(0.09)
      expect(data.splitRate).toBe(0.045)
      expect(data.crossBorderBuffer).toBe(0.015)
      expect(data.domesticFeePercent).toBe(9)
      expect(data.crossBorderFeePercent).toBe(10.5)
      expect(data.domesticSplitPercent).toBe(4.5)
      expect(data.crossBorderSplitPercent).toBe(5.25)
    })

    it('GET /config/minimums returns correct meta', async () => {
      const res = await app.fetch(new Request('http://localhost/config/minimums'))
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.meta.platformFee).toBe('9% domestic, 10.5% cross-border')
      expect(data.meta.model).toBe('Destination charges - platform absorbs Connect fees only')
      expect(data.meta.feeBreakdown.domestic).toBe('9% total (4.5% subscriber + 4.5% creator)')
      expect(data.meta.feeBreakdown.crossBorder).toBe('10.5% total (5.25% subscriber + 5.25% creator)')
      expect(data.meta.minimumBreakdown.domestic).toBe('$5-15 dynamic (based on subscriber count)')
      expect(data.meta.minimumBreakdown.crossBorder).toBe('$45 floor')
    })

    it('GET /config/minimums/:country returns minimum >= $25 for cross-border', async () => {
      const res = await app.fetch(new Request('http://localhost/config/minimums/Nigeria'))
      expect(res.status).toBe(200)

      const data = await res.json()
      expect(data.usd).toBeGreaterThanOrEqual(25) // Floor minimum
      expect(data.country).toBe('Nigeria')
    })

    it('fee constants match config API', async () => {
      const res = await app.fetch(new Request('http://localhost/config/fees'))
      const data = await res.json()

      expect(data.platformFeeRate).toBe(PLATFORM_FEE_RATE)
      expect(data.splitRate).toBe(SPLIT_RATE)
      expect(data.crossBorderBuffer).toBe(CROSS_BORDER_BUFFER)
    })
  })

  describe('no direct charge artifacts', () => {
    it('all fee calculations use split_v1 model', () => {
      const result = calculateServiceFee(10000, 'USD', 'personal')
      expect(result.feeModel).toBe('split_v1')
      expect(result.feeMode).toBe('split')
    })

    it('cross-border calculations still use destination charges', () => {
      const result = calculateServiceFee(10000, 'USD', 'personal', undefined, true)
      expect(result.feeModel).toBe('split_v1')
      // No direct_v1 model should ever be returned
      expect(result.feeModel).not.toBe('direct_v1')
    })
  })
})

describe('Test Matrix Scenarios', () => {
  // From the plan:
  // | Scenario | Subscriber Pays | Creator Receives | Platform Keeps |
  // |----------|-----------------|------------------|----------------|
  // | US $100 | $104.50 | $95.50 | $9.00 (9%) |
  // | NG $100 | $105.25 | $94.75 | $10.50 (10.5%) |
  // | NG $45 (minimum) | $47.36 | $42.64 | $4.73 (10.5%) |

  it('US $100: subscriber pays $104.50, creator gets $95.50', () => {
    const result = calculateServiceFee(10000, 'USD', 'personal', undefined, false)
    expect(result.grossCents).toBe(10450) // $104.50
    expect(result.netCents).toBe(9550) // $95.50
    expect(result.feeCents).toBe(900) // $9.00 (9%)
  })

  it('NG $100 cross-border: subscriber pays $105.25, creator gets $94.75', () => {
    const result = calculateServiceFee(10000, 'USD', 'personal', undefined, true)
    expect(result.grossCents).toBe(10525) // $105.25
    expect(result.netCents).toBe(9475) // $94.75
    expect(result.feeCents).toBe(1050) // $10.50 (10.5%)
  })

  it('NG $45 minimum cross-border: subscriber pays ~$47.36, creator gets ~$42.64', () => {
    const result = calculateServiceFee(4500, 'USD', 'personal', undefined, true)
    // 4500 * 1.0525 = 4736.25 (rounds to 4737 with ceiling)
    expect(result.grossCents).toBeCloseTo(4737, 0) // ~$47.37
    // 4500 - (4500 * 0.0525) = 4263.75 (rounds to 4264)
    expect(result.netCents).toBeCloseTo(4264, 0) // ~$42.64
    // Fee = gross - net
    expect(result.feeCents).toBe(result.grossCents - result.netCents)
  })
})
