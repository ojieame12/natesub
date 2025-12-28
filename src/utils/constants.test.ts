import { describe, expect, it } from 'vitest'
import {
  PUBLIC_DOMAIN,
  PUBLIC_PAGE_URL,
  getPublicPageUrl,
  getShareableLink,
  getShareableLinkFull,
  isReservedUsername,
  getReviewStepIndex,
  getOnboardingStepCount,
} from './constants'

describe('utils/constants', () => {
  it('treats reserved usernames as unavailable (case-insensitive)', () => {
    expect(isReservedUsername('dashboard')).toBe(true)
    expect(isReservedUsername('Dashboard')).toBe(true)
    expect(isReservedUsername('onboarding')).toBe(true)
    expect(isReservedUsername('some_creator')).toBe(false)
  })

  it('builds public page URLs and share links', () => {
    expect(getPublicPageUrl('alice')).toBe(`${PUBLIC_PAGE_URL}/alice`)
    expect(getShareableLink('alice')).toBe(`${PUBLIC_DOMAIN}/alice`)
    expect(getShareableLinkFull('alice')).toBe(`https://${PUBLIC_DOMAIN}/alice`)
  })

  describe('getReviewStepIndex', () => {
    // Flow: Start → Email → OTP → Identity → [Address] → Purpose → Avatar → Username → Payment → [ServiceDesc → AIGen] → Review
    // - No address, non-service: 9 steps (0-8), review at 8
    // - With address, non-service: 10 steps (0-9), review at 9
    // - No address, service: 11 steps (0-10), review at 10
    // - With address, service: 12 steps (0-11), review at 11

    it('returns step 8 for NG non-service (no address, no service steps)', () => {
      expect(getReviewStepIndex('NG')).toBe(8)
      expect(getReviewStepIndex('NG', 'support')).toBe(8)
      expect(getReviewStepIndex('NG', 'tips')).toBe(8)
      expect(getReviewStepIndex('NG', null)).toBe(8)
    })

    it('returns step 9 for US non-service (with address, no service steps)', () => {
      expect(getReviewStepIndex('US')).toBe(9)
      expect(getReviewStepIndex('US', 'support')).toBe(9)
      expect(getReviewStepIndex('GB', 'fan_club')).toBe(9)
    })

    it('returns step 10 for NG service (no address, with service steps)', () => {
      expect(getReviewStepIndex('NG', 'service')).toBe(10)
      expect(getReviewStepIndex('GH', 'service')).toBe(10)
      expect(getReviewStepIndex('KE', 'service')).toBe(10)
    })

    it('returns step 11 for US service (with address, with service steps)', () => {
      expect(getReviewStepIndex('US', 'service')).toBe(11)
      expect(getReviewStepIndex('GB', 'service')).toBe(11)
    })

    it('handles null/undefined countryCode', () => {
      // When countryCode is null/undefined, shouldSkipAddress returns false (address shown as default)
      expect(getReviewStepIndex(null)).toBe(9)  // With address, non-service
      expect(getReviewStepIndex(undefined)).toBe(9)
      expect(getReviewStepIndex(null, 'service')).toBe(11) // With address, service
    })
  })

  describe('getOnboardingStepCount', () => {
    it('returns total step count based on country and purpose', () => {
      // Non-service flows
      expect(getOnboardingStepCount('NG')).toBe(9)  // No address, non-service
      expect(getOnboardingStepCount('US')).toBe(10) // With address, non-service

      // Service flows
      expect(getOnboardingStepCount('NG', 'service')).toBe(11) // No address, service
      expect(getOnboardingStepCount('US', 'service')).toBe(12) // With address, service
    })
  })
})
