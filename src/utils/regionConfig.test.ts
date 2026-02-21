import { describe, it, expect } from 'vitest'
import {
  hasPaystack,
  hasStripe,
  shouldSkipAddress,
  getCountry,
  getPaystackCountryCodes,
  isCrossBorderCountry,
  getAvailableProviders,
  usdToLocalApprox,
  localToUsdExact,
  getApproxFxRate,
} from './regionConfig'

describe('regionConfig', () => {
  // Paystack paused for Stripe-first launch — all countries return false
  describe('hasPaystack', () => {
    it('returns false for all countries (Paystack paused)', () => {
      expect(hasPaystack('NG')).toBe(false)
      expect(hasPaystack('KE')).toBe(false)
      expect(hasPaystack('ZA')).toBe(false)
      expect(hasPaystack('GH')).toBe(false)
      expect(hasPaystack('US')).toBe(false)
      expect(hasPaystack('GB')).toBe(false)
    })

    it('returns false for null/undefined', () => {
      expect(hasPaystack(null)).toBe(false)
      expect(hasPaystack(undefined)).toBe(false)
    })
  })

  describe('hasStripe', () => {
    it('returns true for native Stripe countries', () => {
      expect(hasStripe('US')).toBe(true)
      expect(hasStripe('GB')).toBe(true)
      expect(hasStripe('ZA')).toBe(true)
      expect(hasStripe('DE')).toBe(true)
    })

    it('returns true for cross-border countries', () => {
      expect(hasStripe('NG')).toBe(true)
      expect(hasStripe('GH')).toBe(true)
      expect(hasStripe('KE')).toBe(true)
    })

    it('defaults to true for unknown countries (Stripe has wide coverage)', () => {
      // Unknown countries default to Stripe (getAvailableProviders returns ['stripe'])
      // This is intentional - if a country isn't in our explicit list, Stripe might still work
      expect(hasStripe('XX')).toBe(true)
    })

    it('handles case insensitivity', () => {
      expect(hasStripe('us')).toBe(true)
      expect(hasStripe('Ng')).toBe(true)
    })
  })

  describe('CI removal', () => {
    it('CI is not in country list', () => {
      expect(getCountry('CI')).toBeUndefined()
    })

    it('CI not in Paystack countries', () => {
      expect(getPaystackCountryCodes()).not.toContain('CI')
    })

    it('CI does not have any providers', () => {
      expect(getAvailableProviders('CI')).toEqual(['stripe']) // Default fallback
    })
  })

  describe('shouldSkipAddress', () => {
    it('returns true for NG, GH, KE (cross-border countries)', () => {
      expect(shouldSkipAddress('NG')).toBe(true)
      expect(shouldSkipAddress('GH')).toBe(true)
      expect(shouldSkipAddress('KE')).toBe(true)
    })

    it('returns true for ZA (cross-border like NG/GH/KE)', () => {
      expect(shouldSkipAddress('ZA')).toBe(true)
    })

    it('returns false for US, GB', () => {
      expect(shouldSkipAddress('US')).toBe(false)
      expect(shouldSkipAddress('GB')).toBe(false)
    })
  })

  describe('isCrossBorderCountry', () => {
    it('returns true for NG, GH, KE', () => {
      expect(isCrossBorderCountry('NG')).toBe(true)
      expect(isCrossBorderCountry('GH')).toBe(true)
      expect(isCrossBorderCountry('KE')).toBe(true)
    })

    it('returns true for ZA (cross-border like NG/GH/KE)', () => {
      expect(isCrossBorderCountry('ZA')).toBe(true)
    })

    it('returns false for US, GB (native Stripe)', () => {
      expect(isCrossBorderCountry('US')).toBe(false)
      expect(isCrossBorderCountry('GB')).toBe(false)
    })
  })

  // Paystack paused — no Paystack country codes
  describe('getPaystackCountryCodes', () => {
    it('returns empty array (Paystack paused)', () => {
      const codes = getPaystackCountryCodes()
      expect(codes).toHaveLength(0)
    })
  })

  describe('getCountry', () => {
    it('returns country config for valid codes', () => {
      const ng = getCountry('NG')
      expect(ng).toBeDefined()
      expect(ng?.name).toBe('Nigeria')
      expect(ng?.currency).toBe('NGN')
      expect(ng?.providers).toContain('stripe')
      // Paystack paused — NG no longer lists paystack as a provider
    })

    it('returns undefined for invalid codes', () => {
      expect(getCountry('XX')).toBeUndefined()
      expect(getCountry('CI')).toBeUndefined() // CI removed
    })

    it('handles case insensitivity', () => {
      expect(getCountry('ng')?.code).toBe('NG')
      expect(getCountry('Gh')?.code).toBe('GH')
    })
  })

  // P1 regression: Round-trip drift prevention
  describe('currency conversion round-trip invariants', () => {
    const crossBorderCountries = ['NG', 'ZA', 'KE', 'GH']

    it('usdToLocalApprox → localToUsdExact never drifts MORE than the rounding margin', () => {
      // The P1 bug was: $45 → R900 → $49 ($4 drift)
      // After fix: localToUsdExact uses precise division, so drift is bounded
      for (const code of crossBorderCountries) {
        const usdOriginal = 45
        const local = usdToLocalApprox(usdOriginal, code)
        expect(local).not.toBeNull()

        const usdBack = localToUsdExact(local!.amount, code)
        expect(usdBack).not.toBeNull()

        // The reverse should be >= original (usdToLocalApprox rounds UP)
        // but the overshoot should be bounded by the rounding granularity
        const rate = getApproxFxRate(code)!
        const roundingGranularity = rate >= 100 ? 1000 : rate >= 10 ? 100 : 5
        const maxOvershoot = roundingGranularity / rate

        expect(usdBack!).toBeGreaterThanOrEqual(usdOriginal)
        expect(usdBack! - usdOriginal).toBeLessThanOrEqual(maxOvershoot + 0.01) // +0.01 for float noise
      }
    })

    it('localToUsdExact preserves 2-decimal precision (no whole-dollar rounding)', () => {
      // ZAR rate = 18.2, so R100 / 18.2 = 5.4945... → should be 5.49, not 5
      const usd = localToUsdExact(100, 'ZA')
      expect(usd).toBe(5.49)

      // NGN rate = 1600, so ₦5000 / 1600 = 3.125 → should be 3.13
      const usdNg = localToUsdExact(5000, 'NG')
      expect(usdNg).toBe(3.13)
    })

    it('canonical USD survives user edit flow (type local → store USD → display local)', () => {
      // Simulate: user types R200 → we store $10.99 → re-displaying would show R300
      // Key insight: we should NEVER round-trip. Display comes from user input, not from stored USD.
      const localInput = 200
      const storedUsd = localToUsdExact(localInput, 'ZA')
      expect(storedUsd).not.toBeNull()
      expect(storedUsd!).toBe(10.99)

      // If we round-tripped through usdToLocalApprox, we'd get R300 (not R200!)
      // because usdToLocalApprox rounds UP: ceil(10.99 * 18.2 / 100) * 100 = 300
      const wouldDrift = usdToLocalApprox(storedUsd!, 'ZA')
      expect(wouldDrift?.amount).toBe(300) // R300 ≠ R200 — confirms drift on round-trip

      // This proves the invariant: display must use the original local input, not a round-trip
    })

    it('reversing display rounding inflates the original USD (documents the P1 bug)', () => {
      // This is the core anti-pattern that caused the P1 silent inflation bug:
      // $45 → usdToLocalApprox → R900 → localToUsdExact → $49.45 (NOT $45!)
      // The fix: canonicalUsd must stay at $45, never reverse-derived from R900.
      //
      // This test asserts the inflation EXISTS in the math functions — it's the
      // component's job (PersonalReviewStep) to avoid calling this path.
      const inflatedValues: Record<string, number> = {}
      for (const code of crossBorderCountries) {
        const originalUsd = 45
        const displayLocal = usdToLocalApprox(originalUsd, code)!.amount
        const reversedUsd = localToUsdExact(displayLocal, code)!

        inflatedValues[code] = reversedUsd

        // Key assertion: the reverse is >= original due to ceil rounding
        expect(reversedUsd).toBeGreaterThanOrEqual(originalUsd)
      }

      // Document specific inflation amounts for regression visibility
      expect(inflatedValues['ZA']).toBe(49.45)  // R900 / 18.2 = $49.45 (inflated from $45)
      expect(inflatedValues['NG']).toBe(45)     // ₦72000 / 1600 = $45 (no inflation — exact multiple)
      expect(inflatedValues['KE']).toBe(46.15)  // KSh6000 / 130 = $46.15 (inflated from $45)
      expect(inflatedValues['GH']).toBe(50)     // GH₵800 / 16 = $50 (inflated from $45)
    })

    it('user edit: localToUsdExact produces known exact values for common inputs', () => {
      // These are the actual values that would be stored as canonicalUsd when
      // a user types a local amount. Pinning them prevents silent regressions.
      const testCases = [
        { code: 'ZA', localInput: 1500, expectedUsd: 82.42 },  // 1500 / 18.2
        { code: 'ZA', localInput: 900, expectedUsd: 49.45 },   // 900 / 18.2
        { code: 'NG', localInput: 80000, expectedUsd: 50 },    // 80000 / 1600
        { code: 'NG', localInput: 72000, expectedUsd: 45 },    // 72000 / 1600
        { code: 'KE', localInput: 7000, expectedUsd: 53.85 },  // 7000 / 130
        { code: 'KE', localInput: 6000, expectedUsd: 46.15 },  // 6000 / 130
        { code: 'GH', localInput: 1000, expectedUsd: 62.5 },   // 1000 / 16
        { code: 'GH', localInput: 800, expectedUsd: 50 },      // 800 / 16
      ]

      for (const { code, localInput, expectedUsd } of testCases) {
        const result = localToUsdExact(localInput, code)
        expect(result).toBe(expectedUsd)
      }
    })
  })

  describe('usdToLocalApprox', () => {
    it('returns null for non-cross-border countries', () => {
      expect(usdToLocalApprox(45, 'US')).toBeNull()
      expect(usdToLocalApprox(45, 'GB')).toBeNull()
    })

    it('returns null for null/undefined country', () => {
      expect(usdToLocalApprox(45, null)).toBeNull()
      expect(usdToLocalApprox(45, undefined)).toBeNull()
    })

    it('converts $45 to local for all cross-border countries', () => {
      // ZAR: 45 * 18.2 = 819 → ceil to nearest 100 = 900
      expect(usdToLocalApprox(45, 'ZA')?.amount).toBe(900)
      // NGN: 45 * 1600 = 72000 → ceil to nearest 1000 = 72000
      expect(usdToLocalApprox(45, 'NG')?.amount).toBe(72000)
      // KES: 45 * 130 = 5850 → ceil to nearest 1000 = 6000
      expect(usdToLocalApprox(45, 'KE')?.amount).toBe(6000)
      // GHS: 45 * 16 = 720 → ceil to nearest 100 = 800
      expect(usdToLocalApprox(45, 'GH')?.amount).toBe(800)
    })
  })

  describe('localToUsdExact', () => {
    it('returns null for non-cross-border countries', () => {
      expect(localToUsdExact(900, 'US')).toBeNull()
      expect(localToUsdExact(900, 'GB')).toBeNull()
    })

    it('returns null for null/undefined country', () => {
      expect(localToUsdExact(900, null)).toBeNull()
      expect(localToUsdExact(900, undefined)).toBeNull()
    })

    it('converts local $45-floor minimums back to reasonable USD values', () => {
      // ZAR: R900 / 18.2 = 49.45
      expect(localToUsdExact(900, 'ZA')).toBe(49.45)
      // NGN: ₦72000 / 1600 = 45
      expect(localToUsdExact(72000, 'NG')).toBe(45)
      // KES: KSh6000 / 130 = 46.15
      expect(localToUsdExact(6000, 'KE')).toBe(46.15)
      // GHS: GH₵800 / 16 = 50
      expect(localToUsdExact(800, 'GH')).toBe(50)
    })
  })

  describe('getApproxFxRate', () => {
    it('returns rate for cross-border countries', () => {
      expect(getApproxFxRate('ZA')).toBe(18.2)
      expect(getApproxFxRate('NG')).toBe(1600)
      expect(getApproxFxRate('KE')).toBe(130)
      expect(getApproxFxRate('GH')).toBe(16)
    })

    it('returns null for non-cross-border countries', () => {
      expect(getApproxFxRate('US')).toBeNull()
      expect(getApproxFxRate('GB')).toBeNull()
    })
  })
})
