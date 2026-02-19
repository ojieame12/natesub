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
})
