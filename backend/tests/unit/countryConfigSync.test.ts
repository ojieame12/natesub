import { describe, it, expect } from 'vitest'
import {
  shouldSkipAddress,
  SKIP_ADDRESS_COUNTRIES,
  PAYSTACK_COUNTRIES,
} from '../../src/utils/countryConfig.js'

/**
 * Country Config Sync Tests
 *
 * These tests verify that backend country configuration matches frontend regionConfig.ts
 * If these tests fail, it means the configs have diverged and need to be synced.
 *
 * Frontend source: src/utils/regionConfig.ts
 * Backend source: backend/src/utils/countryConfig.ts
 */

// Expected values from frontend regionConfig.ts COUNTRIES array
// Update these if frontend changes - test will fail as a reminder to sync
const FRONTEND_SKIP_ADDRESS_COUNTRIES = ['NG', 'GH', 'KE']
const FRONTEND_NON_SKIP_ADDRESS_COUNTRIES = ['US', 'GB', 'CA', 'ZA', 'DE', 'FR', 'AU']
const FRONTEND_PAYSTACK_COUNTRIES = ['NG', 'KE', 'ZA'] // GH is NOT included (Stripe only)

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
    it('backend PAYSTACK_COUNTRIES matches frontend', () => {
      expect([...PAYSTACK_COUNTRIES].sort()).toEqual(
        FRONTEND_PAYSTACK_COUNTRIES.sort()
      )
    })

    it('GH is NOT in Paystack countries (Stripe cross-border only)', () => {
      expect(PAYSTACK_COUNTRIES.includes('GH' as never)).toBe(false)
    })
  })

  describe('consistency rules', () => {
    it('all cross-border countries skip address (simplified KYC)', () => {
      // NG, GH, KE are cross-border (USD→local payout)
      // All of them should skip address step
      const crossBorderCountries = ['NG', 'GH', 'KE']
      crossBorderCountries.forEach((country) => {
        expect(shouldSkipAddress(country)).toBe(true)
      })
    })

    it('non-cross-border countries require address', () => {
      // ZA has native Stripe, not cross-border
      expect(shouldSkipAddress('ZA')).toBe(false)
      // US, GB have native Stripe
      expect(shouldSkipAddress('US')).toBe(false)
      expect(shouldSkipAddress('GB')).toBe(false)
    })
  })
})
