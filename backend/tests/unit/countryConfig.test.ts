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

    it('returns false for ZA (native Stripe)', () => {
      expect(shouldSkipAddress('ZA')).toBe(false)
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

  describe('isPaystackSupported', () => {
    it('returns true for NG, KE, ZA', () => {
      expect(isPaystackSupported('NG')).toBe(true)
      expect(isPaystackSupported('KE')).toBe(true)
      expect(isPaystackSupported('ZA')).toBe(true)
    })

    it('returns false for GH (Stripe cross-border only)', () => {
      expect(isPaystackSupported('GH')).toBe(false)
    })

    it('returns false for CI (not supported)', () => {
      expect(isPaystackSupported('CI')).toBe(false)
    })

    it('returns false for US, GB', () => {
      expect(isPaystackSupported('US')).toBe(false)
      expect(isPaystackSupported('GB')).toBe(false)
    })

    it('handles case insensitivity', () => {
      expect(isPaystackSupported('ng')).toBe(true)
      expect(isPaystackSupported('Za')).toBe(true)
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

    it('returns false for ZA (native Stripe)', () => {
      expect(isStripeCrossBorder('ZA')).toBe(false)
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

  describe('getPaystackCurrency', () => {
    it('returns correct currency for supported countries', () => {
      expect(getPaystackCurrency('NG')).toBe('NGN')
      expect(getPaystackCurrency('KE')).toBe('KES')
      expect(getPaystackCurrency('ZA')).toBe('ZAR')
    })

    it('returns undefined for unsupported countries', () => {
      expect(getPaystackCurrency('GH')).toBeUndefined()
      expect(getPaystackCurrency('US')).toBeUndefined()
      expect(getPaystackCurrency('CI')).toBeUndefined()
    })

    it('handles case insensitivity', () => {
      expect(getPaystackCurrency('ng')).toBe('NGN')
      expect(getPaystackCurrency('za')).toBe('ZAR')
    })

    it('returns undefined for null/undefined/empty', () => {
      expect(getPaystackCurrency(null)).toBeUndefined()
      expect(getPaystackCurrency(undefined)).toBeUndefined()
      expect(getPaystackCurrency('')).toBeUndefined()
    })
  })

  describe('constant arrays', () => {
    it('SKIP_ADDRESS_COUNTRIES contains exactly NG, GH, KE', () => {
      // Use Set comparison - order doesn't matter for this logic
      expect(new Set(SKIP_ADDRESS_COUNTRIES)).toEqual(new Set(['NG', 'GH', 'KE']))
      expect(SKIP_ADDRESS_COUNTRIES).toHaveLength(3)
    })

    it('PAYSTACK_COUNTRIES contains exactly NG, KE, ZA (no GH)', () => {
      expect(new Set(PAYSTACK_COUNTRIES)).toEqual(new Set(['NG', 'KE', 'ZA']))
      expect(PAYSTACK_COUNTRIES).not.toContain('GH')
      expect(PAYSTACK_COUNTRIES).not.toContain('CI')
    })

    it('STRIPE_CROSS_BORDER_COUNTRIES contains exactly NG, GH, KE', () => {
      expect(new Set(STRIPE_CROSS_BORDER_COUNTRIES)).toEqual(new Set(['NG', 'GH', 'KE']))
      expect(STRIPE_CROSS_BORDER_COUNTRIES).not.toContain('ZA')
    })

    it('PAYSTACK_PAYER_COUNTRIES includes GH (for checkout routing)', () => {
      expect(new Set(PAYSTACK_PAYER_COUNTRIES)).toEqual(new Set(['NG', 'KE', 'ZA', 'GH']))
      // GH payers can use Paystack to pay NG/KE/ZA creators
      expect(PAYSTACK_PAYER_COUNTRIES).toContain('GH')
    })

    it('PAYSTACK_COUNTRIES excludes GH (creator subaccounts only)', () => {
      expect(PAYSTACK_COUNTRIES).not.toContain('GH')
      expect(PAYSTACK_PAYER_COUNTRIES).toContain('GH')
      // This documents the intentional difference between creator vs payer countries
    })
  })
})
