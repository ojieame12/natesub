import { describe, it, expect } from 'vitest'
import {
  shouldSkipAddress,
  isStripeCrossBorder,
  isPaystackSupported,
  canPayWithPaystack,
  SKIP_ADDRESS_COUNTRIES,
  PAYSTACK_COUNTRIES,
  PAYSTACK_PAYER_COUNTRIES,
  STRIPE_CROSS_BORDER_COUNTRIES,
} from '../../src/utils/countryConfig.js'

/**
 * Country Config Sync Tests
 *
 * These tests verify that backend country configuration matches frontend regionConfig.ts
 * If these tests fail, it means the configs have diverged and need to be synced.
 *
 * Frontend source: src/utils/regionConfig.ts (COUNTRIES array with skipAddress, crossBorder, providers)
 * Backend source: backend/src/utils/countryConfig.ts (COUNTRIES array with equivalent fields)
 *
 * IMPORTANT: If you update frontend regionConfig.ts, update these expected values!
 */

// Expected values from frontend regionConfig.ts COUNTRIES array
// These are the source of truth - update here when frontend changes
// Note: ZA (South Africa) is cross-border (not native Stripe) - has * on Stripe pricing
const FRONTEND_SKIP_ADDRESS_COUNTRIES = ['NG', 'GH', 'KE', 'ZA']  // skipAddress: true
const FRONTEND_CROSS_BORDER_COUNTRIES = ['NG', 'GH', 'KE', 'ZA']  // crossBorder: true
const FRONTEND_PAYSTACK_CREATOR_COUNTRIES = ['NG', 'KE', 'ZA']  // providers includes 'paystack'
const FRONTEND_PAYSTACK_PAYER_COUNTRIES = ['NG', 'GH', 'KE', 'ZA']  // can pay via Paystack checkout
const FRONTEND_NON_SKIP_ADDRESS_COUNTRIES = ['US', 'GB', 'CA', 'DE', 'FR', 'AU']  // Native Stripe countries

describe('Country config backend/frontend sync', () => {
  describe('skipAddress countries', () => {
    it('backend SKIP_ADDRESS_COUNTRIES matches frontend', () => {
      expect([...SKIP_ADDRESS_COUNTRIES].sort()).toEqual(
        FRONTEND_SKIP_ADDRESS_COUNTRIES.sort()
      )
    })

    FRONTEND_SKIP_ADDRESS_COUNTRIES.forEach((country) => {
      it(`shouldSkipAddress('${country}') returns true (matching frontend)`, () => {
        expect(shouldSkipAddress(country)).toBe(true)
      })
    })

    FRONTEND_NON_SKIP_ADDRESS_COUNTRIES.forEach((country) => {
      it(`shouldSkipAddress('${country}') returns false (matching frontend)`, () => {
        expect(shouldSkipAddress(country)).toBe(false)
      })
    })
  })

  describe('Paystack countries', () => {
    it('backend PAYSTACK_COUNTRIES matches frontend (creator subaccounts)', () => {
      expect([...PAYSTACK_COUNTRIES].sort()).toEqual(
        FRONTEND_PAYSTACK_CREATOR_COUNTRIES.sort()
      )
    })

    it('backend PAYSTACK_PAYER_COUNTRIES matches frontend (checkout routing)', () => {
      expect([...PAYSTACK_PAYER_COUNTRIES].sort()).toEqual(
        FRONTEND_PAYSTACK_PAYER_COUNTRIES.sort()
      )
    })

    it('GH is NOT in Paystack creator countries (Stripe cross-border only)', () => {
      expect(isPaystackSupported('GH')).toBe(false)
    })

    it('GH IS in Paystack payer countries (can pay via Paystack)', () => {
      expect(canPayWithPaystack('GH')).toBe(true)
    })
  })

  describe('Stripe cross-border countries', () => {
    it('backend STRIPE_CROSS_BORDER_COUNTRIES matches frontend', () => {
      expect([...STRIPE_CROSS_BORDER_COUNTRIES].sort()).toEqual(
        FRONTEND_CROSS_BORDER_COUNTRIES.sort()
      )
    })

    FRONTEND_CROSS_BORDER_COUNTRIES.forEach((country) => {
      it(`isStripeCrossBorder('${country}') returns true`, () => {
        expect(isStripeCrossBorder(country)).toBe(true)
      })
    })

    it('ZA IS cross-border (has * on Stripe pricing)', () => {
      expect(isStripeCrossBorder('ZA')).toBe(true)
    })
  })

  describe('consistency rules', () => {
    it('all cross-border countries skip address (simplified KYC)', () => {
      // NG, GH, KE, ZA are cross-border (USD→local payout)
      // All of them should skip address step
      const crossBorderCountries = ['NG', 'GH', 'KE', 'ZA']
      crossBorderCountries.forEach((country) => {
        expect(shouldSkipAddress(country)).toBe(true)
      })
    })

    it('non-cross-border countries require address', () => {
      // US, GB have native Stripe
      expect(shouldSkipAddress('US')).toBe(false)
      expect(shouldSkipAddress('GB')).toBe(false)
    })
  })
})
