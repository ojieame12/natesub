import { describe, it, expect } from 'vitest'
import {
  shouldSkipAddress,
  isPaystackSupported,
  isStripeCrossBorder,
  getPaystackCurrency,
  SKIP_ADDRESS_COUNTRIES,
  PAYSTACK_COUNTRIES,
  PAYSTACK_PAYER_COUNTRIES,
  STRIPE_CROSS_BORDER_COUNTRIES,
} from '../../src/utils/countryConfig'

describe('countryConfig', () => {
  describe('shouldSkipAddress', () => {
    it('returns true for NG, GH, KE', () => {
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

    it('handles case insensitivity', () => {
      expect(shouldSkipAddress('ng')).toBe(true)
      expect(shouldSkipAddress('Ke')).toBe(true)
      expect(shouldSkipAddress('gh')).toBe(true)
    })

    it('returns false for null/undefined/empty', () => {
      expect(shouldSkipAddress(null)).toBe(false)
      expect(shouldSkipAddress(undefined)).toBe(false)
      expect(shouldSkipAddress('')).toBe(false)
    })

    it('returns false for unknown country codes', () => {
      expect(shouldSkipAddress('XX')).toBe(false)
      expect(shouldSkipAddress('CI')).toBe(false)
    })
  })

  // Paystack paused for Stripe-first launch — all countries return false
  describe('isPaystackSupported', () => {
    it('returns false for all countries (Paystack paused)', () => {
      expect(isPaystackSupported('NG')).toBe(false)
      expect(isPaystackSupported('KE')).toBe(false)
      expect(isPaystackSupported('ZA')).toBe(false)
      expect(isPaystackSupported('GH')).toBe(false)
      expect(isPaystackSupported('CI')).toBe(false)
      expect(isPaystackSupported('US')).toBe(false)
      expect(isPaystackSupported('GB')).toBe(false)
    })

    it('handles case insensitivity', () => {
      expect(isPaystackSupported('ng')).toBe(false)
      expect(isPaystackSupported('Za')).toBe(false)
    })

    it('returns false for null/undefined/empty', () => {
      expect(isPaystackSupported(null)).toBe(false)
      expect(isPaystackSupported(undefined)).toBe(false)
      expect(isPaystackSupported('')).toBe(false)
    })
  })

  describe('isStripeCrossBorder', () => {
    it('returns true for NG, GH, KE', () => {
      expect(isStripeCrossBorder('NG')).toBe(true)
      expect(isStripeCrossBorder('GH')).toBe(true)
      expect(isStripeCrossBorder('KE')).toBe(true)
    })

    it('returns true for ZA (cross-border like NG/GH/KE)', () => {
      expect(isStripeCrossBorder('ZA')).toBe(true)
    })

    it('returns false for US, GB (native Stripe)', () => {
      expect(isStripeCrossBorder('US')).toBe(false)
      expect(isStripeCrossBorder('GB')).toBe(false)
    })

    it('handles case insensitivity', () => {
      expect(isStripeCrossBorder('ng')).toBe(true)
      expect(isStripeCrossBorder('Gh')).toBe(true)
    })

    it('returns false for null/undefined/empty', () => {
      expect(isStripeCrossBorder(null)).toBe(false)
      expect(isStripeCrossBorder(undefined)).toBe(false)
      expect(isStripeCrossBorder('')).toBe(false)
    })
  })

  // Paystack paused — getPaystackCurrency returns undefined for all countries
  describe('getPaystackCurrency', () => {
    it('returns undefined for all countries (Paystack paused)', () => {
      expect(getPaystackCurrency('NG')).toBeUndefined()
      expect(getPaystackCurrency('KE')).toBeUndefined()
      expect(getPaystackCurrency('ZA')).toBeUndefined()
      expect(getPaystackCurrency('GH')).toBeUndefined()
      expect(getPaystackCurrency('US')).toBeUndefined()
    })

    it('handles case insensitivity', () => {
      expect(getPaystackCurrency('ng')).toBeUndefined()
      expect(getPaystackCurrency('za')).toBeUndefined()
    })

    it('returns undefined for null/undefined/empty', () => {
      expect(getPaystackCurrency(null)).toBeUndefined()
      expect(getPaystackCurrency(undefined)).toBeUndefined()
      expect(getPaystackCurrency('')).toBeUndefined()
    })
  })

  describe('constant arrays', () => {
    it('SKIP_ADDRESS_COUNTRIES contains exactly NG, GH, KE, ZA', () => {
      // Use Set comparison - order doesn't matter for this logic
      expect(new Set(SKIP_ADDRESS_COUNTRIES)).toEqual(new Set(['NG', 'GH', 'KE', 'ZA']))
      expect(SKIP_ADDRESS_COUNTRIES).toHaveLength(4)
    })

    // Paystack paused — both arrays are empty
    it('PAYSTACK_COUNTRIES is empty (Paystack paused)', () => {
      expect(PAYSTACK_COUNTRIES).toHaveLength(0)
    })

    it('STRIPE_CROSS_BORDER_COUNTRIES contains exactly NG, GH, KE, ZA', () => {
      expect(new Set(STRIPE_CROSS_BORDER_COUNTRIES)).toEqual(new Set(['NG', 'GH', 'KE', 'ZA']))
      expect(STRIPE_CROSS_BORDER_COUNTRIES).toHaveLength(4)
    })

    it('PAYSTACK_PAYER_COUNTRIES is empty (Paystack paused)', () => {
      expect(PAYSTACK_PAYER_COUNTRIES).toHaveLength(0)
    })
  })
})
