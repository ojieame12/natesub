import { describe, it, expect } from 'vitest'
import { getOnboardingCompleteStep } from '../../src/services/auth.js'

describe('getOnboardingCompleteStep', () => {
  describe('non-service mode', () => {
    it('returns 9 for NG (skip address, no service)', () => {
      expect(getOnboardingCompleteStep('NG')).toBe(9)
      expect(getOnboardingCompleteStep('NG', undefined)).toBe(9)
      expect(getOnboardingCompleteStep('NG', 'support')).toBe(9)
      expect(getOnboardingCompleteStep('NG', 'tips')).toBe(9)
    })

    it('returns 9 for GH (skip address, no service)', () => {
      expect(getOnboardingCompleteStep('GH')).toBe(9)
    })

    it('returns 9 for KE (skip address, no service)', () => {
      expect(getOnboardingCompleteStep('KE')).toBe(9)
    })

    it('returns 10 for US (with address, no service)', () => {
      expect(getOnboardingCompleteStep('US')).toBe(10)
      expect(getOnboardingCompleteStep('US', undefined)).toBe(10)
      expect(getOnboardingCompleteStep('US', 'support')).toBe(10)
    })

    it('returns 10 for GB (with address, no service)', () => {
      expect(getOnboardingCompleteStep('GB')).toBe(10)
    })

    it('returns 10 for CA (with address, no service)', () => {
      expect(getOnboardingCompleteStep('CA')).toBe(10)
    })
  })

  describe('service mode', () => {
    it('returns 11 for NG + service (skip address, +2 service steps)', () => {
      expect(getOnboardingCompleteStep('NG', 'service')).toBe(11)
    })

    it('returns 11 for GH + service', () => {
      expect(getOnboardingCompleteStep('GH', 'service')).toBe(11)
    })

    it('returns 11 for KE + service', () => {
      expect(getOnboardingCompleteStep('KE', 'service')).toBe(11)
    })

    it('returns 12 for US + service (with address, +2 service steps)', () => {
      expect(getOnboardingCompleteStep('US', 'service')).toBe(12)
    })

    it('returns 12 for GB + service', () => {
      expect(getOnboardingCompleteStep('GB', 'service')).toBe(12)
    })
  })

  describe('edge cases', () => {
    it('handles null/undefined countryCode (defaults to with-address flow)', () => {
      // null/undefined country → shouldSkipAddress returns false → has address step
      expect(getOnboardingCompleteStep(null)).toBe(10)
      expect(getOnboardingCompleteStep(undefined)).toBe(10)
      expect(getOnboardingCompleteStep(null, 'service')).toBe(12)
    })

    it('handles lowercase country codes', () => {
      expect(getOnboardingCompleteStep('ng')).toBe(9)
      expect(getOnboardingCompleteStep('us')).toBe(10)
    })

    it('handles unknown country codes (defaults to with-address flow)', () => {
      expect(getOnboardingCompleteStep('XX')).toBe(10)
      expect(getOnboardingCompleteStep('ZZ', 'service')).toBe(12)
    })
  })
})
