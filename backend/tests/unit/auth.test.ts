import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '../../src/db/client.js'
import {
  computeOnboardingState,
  saveOnboardingProgress,
  clearOnboardingState,
} from '../../src/services/auth.js'

// Mock the database client
vi.mock('../../src/db/client.js', () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

/**
 * Onboarding Step Count Reference (as of 2024):
 *
 * Base flow (non-service, skip address): 9 steps
 *   - NG, GH, KE → 9 steps
 *
 * Base flow (non-service, with address): 10 steps
 *   - US, GB, CA, etc. → 10 steps
 *
 * Service mode adds 2 steps (ServiceDescription + AIGenerating):
 *   - NG + service → 11 steps
 *   - US + service → 12 steps
 */

describe('auth service - dynamic onboarding completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('computeOnboardingState', () => {
    it('uses step 9 as completion threshold for NG (no address step, non-service)', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 8,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'NG' },
        profile: null,
      }

      const result = computeOnboardingState(user)

      // Step 8 is < 9, so onboarding is in progress
      expect(result.redirectTo).toBe('/onboarding?step=8')
    })

    it('uses step 10 as completion threshold for US (with address step, non-service)', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 9,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'US' },
        profile: null,
      }

      const result = computeOnboardingState(user)

      // Step 9 is < 10 for US, so onboarding is in progress
      expect(result.redirectTo).toBe('/onboarding?step=9')
    })

    it('uses step 11 as completion threshold for NG + service', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 10,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'NG', purpose: 'service' },
        profile: null,
      }

      const result = computeOnboardingState(user)

      // Step 10 is < 11 for NG + service, so onboarding is in progress
      expect(result.redirectTo).toBe('/onboarding?step=10')
    })

    it('uses step 12 as completion threshold for US + service', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 11,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'US', purpose: 'service' },
        profile: null,
      }

      const result = computeOnboardingState(user)

      // Step 11 is < 12 for US + service, so onboarding is in progress
      expect(result.redirectTo).toBe('/onboarding?step=11')
    })

    it('treats GH as cross-border (completion at step 9, non-service)', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 8,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'GH' },
        profile: null,
      }

      const result = computeOnboardingState(user)

      expect(result.redirectTo).toBe('/onboarding?step=8')
    })

    it('treats KE as cross-border (completion at step 9, non-service)', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 8,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'KE' },
        profile: null,
      }

      const result = computeOnboardingState(user)

      expect(result.redirectTo).toBe('/onboarding?step=8')
    })

    it('treats UK as non-cross-border (completion at step 10, non-service)', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 9,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'GB' },
        profile: null,
      }

      const result = computeOnboardingState(user)

      // Step 9 < 10 for GB, so in progress
      expect(result.redirectTo).toBe('/onboarding?step=9')
    })

    it('defaults to step 10 completion when no countryCode (assumes with-address)', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 9,
        onboardingBranch: 'personal' as const,
        onboardingData: null, // No country data
        profile: null,
      }

      const result = computeOnboardingState(user)

      // With no countryCode, shouldSkipAddress returns false → has address step → 10 steps
      expect(result.redirectTo).toBe('/onboarding?step=9')
    })

    it('redirects to dashboard when step >= completion threshold', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 10,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'US' },
        profile: { payoutStatus: 'active', paymentProvider: 'stripe' },
      }

      const result = computeOnboardingState(user)

      // Step 10 >= 10 for US non-service, so complete → dashboard
      expect(result.redirectTo).toBe('/dashboard')
    })

    it('redirects to dashboard when step >= completion threshold (service mode)', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 12,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'US', purpose: 'service' },
        profile: { payoutStatus: 'active', paymentProvider: 'stripe' },
      }

      const result = computeOnboardingState(user)

      // Step 12 >= 12 for US + service, so complete → dashboard
      expect(result.redirectTo).toBe('/dashboard')
    })
  })

  describe('saveOnboardingProgress', () => {
    it('clears state at step 9 for NG users (non-service)', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        onboardingData: { countryCode: 'NG' },
      } as any)
      vi.mocked(db.user.update).mockResolvedValue({} as any)

      const result = await saveOnboardingProgress('user-1', {
        step: 9,
        branch: 'personal',
        data: {},
      })

      expect(result).toEqual({ success: true })
      // Should have called update to clear (via clearOnboardingState)
      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            onboardingStep: null,
            onboardingBranch: null,
          }),
        })
      )
    })

    it('clears state at step 10 for US users (non-service)', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        onboardingData: { countryCode: 'US' },
      } as any)
      vi.mocked(db.user.update).mockResolvedValue({} as any)

      const result = await saveOnboardingProgress('user-1', {
        step: 10,
        branch: 'personal',
        data: {},
      })

      expect(result).toEqual({ success: true })
      // Should clear state
      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStep: null,
          }),
        })
      )
    })

    it('clears state at step 11 for NG + service users', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        onboardingData: { countryCode: 'NG', purpose: 'service' },
      } as any)
      vi.mocked(db.user.update).mockResolvedValue({} as any)

      const result = await saveOnboardingProgress('user-1', {
        step: 11,
        branch: 'personal',
        data: {},
      })

      expect(result).toEqual({ success: true })
      // Should clear state
      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStep: null,
          }),
        })
      )
    })

    it('clears state at step 12 for US + service users', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        onboardingData: { countryCode: 'US', purpose: 'service' },
      } as any)
      vi.mocked(db.user.update).mockResolvedValue({} as any)

      const result = await saveOnboardingProgress('user-1', {
        step: 12,
        branch: 'personal',
        data: {},
      })

      expect(result).toEqual({ success: true })
      // Should clear state
      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStep: null,
          }),
        })
      )
    })

    it('does NOT clear state at step 9 for US users (need step 10)', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        onboardingData: { countryCode: 'US' },
      } as any)
      vi.mocked(db.user.update).mockResolvedValue({} as any)

      await saveOnboardingProgress('user-1', {
        step: 9,
        branch: 'personal',
        data: { countryCode: 'US' },
      })

      // Should save step 9, not clear
      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStep: 9,
          }),
        })
      )
    })

    it('does NOT clear state at step 10 for US + service users (need step 12)', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        onboardingData: { countryCode: 'US', purpose: 'service' },
      } as any)
      vi.mocked(db.user.update).mockResolvedValue({} as any)

      await saveOnboardingProgress('user-1', {
        step: 10,
        branch: 'personal',
        data: {},
      })

      // Should save step 10, not clear (service needs 12)
      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStep: 10,
          }),
        })
      )
    })

    it('uses countryCode from incoming data if not in existing data', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        onboardingData: {}, // No existing countryCode
      } as any)
      vi.mocked(db.user.update).mockResolvedValue({} as any)

      await saveOnboardingProgress('user-1', {
        step: 9,
        branch: 'personal',
        data: { countryCode: 'NG' }, // Incoming countryCode
      })

      // With NG, step 9 should trigger clear
      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStep: null,
          }),
        })
      )
    })

    it('uses purpose from incoming data for step count calculation', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        onboardingData: { countryCode: 'NG' }, // No existing purpose
      } as any)
      vi.mocked(db.user.update).mockResolvedValue({} as any)

      await saveOnboardingProgress('user-1', {
        step: 9,
        branch: 'personal',
        data: { purpose: 'service' }, // Incoming purpose
      })

      // With NG + service, step 9 < 11, so should NOT clear
      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStep: 9,
          }),
        })
      )
    })

    it('merges existing and new onboarding data', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        onboardingData: { countryCode: 'US', firstName: 'Ada' },
      } as any)
      vi.mocked(db.user.update).mockResolvedValue({} as any)

      await saveOnboardingProgress('user-1', {
        step: 5,
        branch: 'personal',
        data: { lastName: 'Lovelace' },
      })

      // Should merge data
      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingData: expect.objectContaining({
              countryCode: 'US',
              firstName: 'Ada',
              lastName: 'Lovelace',
            }),
          }),
        })
      )
    })
  })
})
