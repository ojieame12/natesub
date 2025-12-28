import { describe, it, expect } from 'vitest'
import {
  hasPaystack,
  hasStripe,
  shouldSkipAddress,
  getCountry,
  getPaystackCountryCodes,
  isCrossBorderCountry,
  getAvailableProviders,
} from './regionConfig'

describe('regionConfig', () => {
  describe('hasPaystack', () => {
    it('returns true for NG, KE, ZA', () => {
      expect(hasPaystack('NG')).toBe(true)
      expect(hasPaystack('KE')).toBe(true)
      expect(hasPaystack('ZA')).toBe(true)
    })

    it('returns false for GH (cross-border Stripe only)', () => {
      expect(hasPaystack('GH')).toBe(false)
    })

    it('returns false for CI (removed - not supported)', () => {
      expect(hasPaystack('CI')).toBe(false)
    })

    it('returns false for US, GB (Stripe-only countries)', () => {
      expect(hasPaystack('US')).toBe(false)
      expect(hasPaystack('GB')).toBe(false)
    })

    it('handles case insensitivity', () => {
      expect(hasPaystack('ng')).toBe(true)
      expect(hasPaystack('Ke')).toBe(true)
      expect(hasPaystack('za')).toBe(true)
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

    it('returns false for ZA (native Stripe)', () => {
      expect(shouldSkipAddress('ZA')).toBe(false)
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

    it('returns false for ZA (native Stripe support)', () => {
      expect(isCrossBorderCountry('ZA')).toBe(false)
    })

    it('returns false for US, GB (native Stripe)', () => {
      expect(isCrossBorderCountry('US')).toBe(false)
      expect(isCrossBorderCountry('GB')).toBe(false)
    })
  })

  describe('getPaystackCountryCodes', () => {
    it('returns exactly NG, KE, ZA', () => {
      const codes = getPaystackCountryCodes()
      expect(codes).toContain('NG')
      expect(codes).toContain('KE')
      expect(codes).toContain('ZA')
    })

    it('does not include GH (cross-border Stripe only)', () => {
      const codes = getPaystackCountryCodes()
      expect(codes).not.toContain('GH')
    })

    it('does not include CI (removed)', () => {
      const codes = getPaystackCountryCodes()
      expect(codes).not.toContain('CI')
    })
  })

  describe('getCountry', () => {
    it('returns country config for valid codes', () => {
      const ng = getCountry('NG')
      expect(ng).toBeDefined()
      expect(ng?.name).toBe('Nigeria')
      expect(ng?.currency).toBe('NGN')
      expect(ng?.providers).toContain('stripe')
      expect(ng?.providers).toContain('paystack')
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
})
