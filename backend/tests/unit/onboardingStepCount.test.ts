import { describe, it, expect } from 'vitest'
import { getOnboardingCompleteStep } from '../../src/services/auth.js'

/**
 * V5 Onboarding Step Count:
 *
 * Personal flow (all countries): 6 steps
 *   email(0) → otp(1) → identity(2) → setup(3) → payments(4) → review(5)
 *
 * Service flow (all countries): 7 steps
 *   email(0) → otp(1) → identity(2) → setup(3) → payments(4) → service(5) → review(6)
 *
 * No address step in V5. Country code no longer affects step count.
 */

describe('getOnboardingCompleteStep', () => {
  describe('personal mode (non-service)', () => {
    it('returns 6 for NG (personal)', () => {
      expect(getOnboardingCompleteStep('NG')).toBe(6)
      expect(getOnboardingCompleteStep('NG', undefined)).toBe(6)
      expect(getOnboardingCompleteStep('NG', 'personal')).toBe(6)
    })

    it('returns 6 for GH (personal)', () => {
      expect(getOnboardingCompleteStep('GH')).toBe(6)
    })

    it('returns 6 for KE (personal)', () => {
      expect(getOnboardingCompleteStep('KE')).toBe(6)
    })

    it('returns 6 for US (personal)', () => {
      expect(getOnboardingCompleteStep('US')).toBe(6)
      expect(getOnboardingCompleteStep('US', undefined)).toBe(6)
      expect(getOnboardingCompleteStep('US', 'personal')).toBe(6)
    })

    it('returns 6 for GB (personal)', () => {
      expect(getOnboardingCompleteStep('GB')).toBe(6)
    })

    it('returns 6 for CA (personal)', () => {
      expect(getOnboardingCompleteStep('CA')).toBe(6)
    })

    it('treats legacy purpose values as personal', () => {
      // Old purpose values like 'support', 'tips' etc. should map to personal (6 steps)
      expect(getOnboardingCompleteStep('US', 'support')).toBe(6)
      expect(getOnboardingCompleteStep('US', 'tips')).toBe(6)
    })
  })

  describe('service mode', () => {
    it('returns 7 for NG + service', () => {
      expect(getOnboardingCompleteStep('NG', 'service')).toBe(7)
    })

    it('returns 7 for GH + service', () => {
      expect(getOnboardingCompleteStep('GH', 'service')).toBe(7)
    })

    it('returns 7 for KE + service', () => {
      expect(getOnboardingCompleteStep('KE', 'service')).toBe(7)
    })

    it('returns 7 for US + service', () => {
      expect(getOnboardingCompleteStep('US', 'service')).toBe(7)
    })

    it('returns 7 for GB + service', () => {
      expect(getOnboardingCompleteStep('GB', 'service')).toBe(7)
    })
  })

  describe('edge cases', () => {
    it('handles null/undefined countryCode (same step count in V5)', () => {
      // V5: no address step means country code does not affect step count
      expect(getOnboardingCompleteStep(null)).toBe(6)
      expect(getOnboardingCompleteStep(undefined)).toBe(6)
      expect(getOnboardingCompleteStep(null, 'service')).toBe(7)
    })

    it('handles lowercase country codes', () => {
      // Country code case shouldn't matter — same step count regardless
      expect(getOnboardingCompleteStep('ng')).toBe(6)
      expect(getOnboardingCompleteStep('us')).toBe(6)
    })

    it('handles unknown country codes', () => {
      expect(getOnboardingCompleteStep('XX')).toBe(6)
      expect(getOnboardingCompleteStep('ZZ', 'service')).toBe(7)
    })
  })
})
