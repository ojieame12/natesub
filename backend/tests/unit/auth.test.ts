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

describe('auth service - dynamic onboarding completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('computeOnboardingState', () => {
    it('uses step 7 as completion threshold for NG (no address step)', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 6,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'NG' },
        profile: null,
      }

      const result = computeOnboardingState(user)

      // Step 6 is < 7, so onboarding is in progress
      expect(result.redirectTo).toBe('/onboarding?step=6')
    })

    it('uses step 8 as completion threshold for US (with address step)', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 7,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'US' },
        profile: null,
      }

      const result = computeOnboardingState(user)

      // Step 7 is < 8 for US, so onboarding is in progress
      expect(result.redirectTo).toBe('/onboarding?step=7')
    })

    it('treats GH as cross-border (completion at step 7)', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 6,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'GH' },
        profile: null,
      }

      const result = computeOnboardingState(user)

      expect(result.redirectTo).toBe('/onboarding?step=6')
    })

    it('treats KE as cross-border (completion at step 7)', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 6,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'KE' },
        profile: null,
      }

      const result = computeOnboardingState(user)

      expect(result.redirectTo).toBe('/onboarding?step=6')
    })

    it('treats UK as non-cross-border (completion at step 8)', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 7,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'GB' },
        profile: null,
      }

      const result = computeOnboardingState(user)

      // Step 7 < 8 for GB, so in progress
      expect(result.redirectTo).toBe('/onboarding?step=7')
    })

    it('defaults to step 7 completion when no countryCode (legacy/fallback)', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 6,
        onboardingBranch: 'personal' as const,
        onboardingData: null, // No country data
        profile: null,
      }

      const result = computeOnboardingState(user)

      // With no countryCode, defaults to 7 (cross-border behavior)
      expect(result.redirectTo).toBe('/onboarding?step=6')
    })

    it('redirects to dashboard when step >= completion threshold', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 8,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'US' },
        profile: { payoutStatus: 'active', paymentProvider: 'stripe' },
      }

      const result = computeOnboardingState(user)

      // Step 8 >= 8 for US, so complete → dashboard
      expect(result.redirectTo).toBe('/dashboard')
    })
  })

  describe('saveOnboardingProgress', () => {
    it('clears state at step 7 for NG users', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        onboardingData: { countryCode: 'NG' },
      } as any)
      vi.mocked(db.user.update).mockResolvedValue({} as any)

      const result = await saveOnboardingProgress('user-1', {
        step: 7,
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

    it('clears state at step 8 for US users', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        onboardingData: { countryCode: 'US' },
      } as any)
      vi.mocked(db.user.update).mockResolvedValue({} as any)

      const result = await saveOnboardingProgress('user-1', {
        step: 8,
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

    it('does NOT clear state at step 7 for US users', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        onboardingData: { countryCode: 'US' },
      } as any)
      vi.mocked(db.user.update).mockResolvedValue({} as any)

      await saveOnboardingProgress('user-1', {
        step: 7,
        branch: 'personal',
        data: { countryCode: 'US' },
      })

      // Should save step 7, not clear
      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStep: 7,
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
        step: 7,
        branch: 'personal',
        data: { countryCode: 'NG' }, // Incoming countryCode
      })

      // With NG, step 7 should trigger clear
      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStep: null,
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
