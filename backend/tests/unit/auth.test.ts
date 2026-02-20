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
 * V5 Onboarding Step Count:
 *
 * Personal flow (all countries): 6 steps
 *   email(0) → otp(1) → identity(2) → setup(3) → payments(4) → review(5)
 *
 * Service flow (all countries): 7 steps
 *   email(0) → otp(1) → identity(2) → setup(3) → payments(4) → service(5) → review(6)
 *
 * No address step. Country code no longer affects step count.
 */

describe('auth service - dynamic onboarding completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('computeOnboardingState', () => {
    it('uses step 6 as completion threshold for personal mode (any country)', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 5,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'NG' },
        profile: null,
      }

      const result = computeOnboardingState(user)

      // Step 5 < 6, so onboarding is in progress
      expect(result.redirectTo).toBe('/onboarding?step=5')
    })

    it('uses step 6 as completion threshold for US personal mode too', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 5,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'US' },
        profile: null,
      }

      const result = computeOnboardingState(user)

      // Step 5 < 6 for US, so onboarding is in progress (same as NG in V5)
      expect(result.redirectTo).toBe('/onboarding?step=5')
    })

    it('uses step 7 as completion threshold for service mode', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 6,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'NG', purpose: 'service' },
        profile: null,
      }

      const result = computeOnboardingState(user)

      // Step 6 < 7 for service, so onboarding is in progress
      expect(result.redirectTo).toBe('/onboarding?step=6')
    })

    it('uses step 7 as completion threshold for US + service', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 6,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'US', purpose: 'service' },
        profile: null,
      }

      const result = computeOnboardingState(user)

      // Step 6 < 7 for US + service, so onboarding is in progress
      expect(result.redirectTo).toBe('/onboarding?step=6')
    })

    it('same completion threshold for GH, KE, GB as personal', () => {
      for (const countryCode of ['GH', 'KE', 'GB']) {
        const user = {
          id: 'user-1',
          onboardingStep: 5,
          onboardingBranch: 'personal' as const,
          onboardingData: { countryCode },
          profile: null,
        }

        const result = computeOnboardingState(user)
        expect(result.redirectTo).toBe('/onboarding?step=5')
      }
    })

    it('defaults to step 6 completion when no countryCode', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 5,
        onboardingBranch: 'personal' as const,
        onboardingData: null, // No country data
        profile: null,
      }

      const result = computeOnboardingState(user)

      // V5: 6 steps for personal regardless of country
      expect(result.redirectTo).toBe('/onboarding?step=5')
    })

    it('redirects to dashboard when step >= completion threshold (personal)', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 6,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'US' },
        profile: { payoutStatus: 'active', paymentProvider: 'stripe' },
      }

      const result = computeOnboardingState(user)

      // Step 6 >= 6 for personal, so complete → dashboard
      expect(result.redirectTo).toBe('/dashboard')
    })

    it('redirects to dashboard when step >= completion threshold (service mode)', () => {
      const user = {
        id: 'user-1',
        onboardingStep: 7,
        onboardingBranch: 'personal' as const,
        onboardingData: { countryCode: 'US', purpose: 'service' },
        profile: { payoutStatus: 'active', paymentProvider: 'stripe' },
      }

      const result = computeOnboardingState(user)

      // Step 7 >= 7 for service, so complete → dashboard
      expect(result.redirectTo).toBe('/dashboard')
    })
  })

  describe('saveOnboardingProgress', () => {
    it('clears state at step 6 for personal users (any country)', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        onboardingData: { countryCode: 'NG' },
      } as any)
      vi.mocked(db.user.update).mockResolvedValue({} as any)

      const result = await saveOnboardingProgress('user-1', {
        step: 6,
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

    it('clears state at step 6 for US personal users too', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        onboardingData: { countryCode: 'US' },
      } as any)
      vi.mocked(db.user.update).mockResolvedValue({} as any)

      const result = await saveOnboardingProgress('user-1', {
        step: 6,
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

    it('clears state at step 7 for service users (any country)', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        onboardingData: { countryCode: 'NG', purpose: 'service' },
      } as any)
      vi.mocked(db.user.update).mockResolvedValue({} as any)

      const result = await saveOnboardingProgress('user-1', {
        step: 7,
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

    it('clears state at step 7 for US + service users', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        onboardingData: { countryCode: 'US', purpose: 'service' },
      } as any)
      vi.mocked(db.user.update).mockResolvedValue({} as any)

      const result = await saveOnboardingProgress('user-1', {
        step: 7,
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

    it('does NOT clear state at step 5 for personal users (need step 6)', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        onboardingData: { countryCode: 'US' },
      } as any)
      vi.mocked(db.user.update).mockResolvedValue({} as any)

      await saveOnboardingProgress('user-1', {
        step: 5,
        branch: 'personal',
        data: { countryCode: 'US' },
      })

      // Should save step 5, not clear
      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStep: 5,
          }),
        })
      )
    })

    it('does NOT clear state at step 5 for service users (need step 7)', async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue({
        onboardingData: { countryCode: 'US', purpose: 'service' },
      } as any)
      vi.mocked(db.user.update).mockResolvedValue({} as any)

      await saveOnboardingProgress('user-1', {
        step: 5,
        branch: 'personal',
        data: {},
      })

      // Should save step 5, not clear (service needs 7)
      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStep: 5,
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
        step: 6,
        branch: 'personal',
        data: { countryCode: 'NG' }, // Incoming countryCode
      })

      // With personal mode, step 6 should trigger clear
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
        step: 6,
        branch: 'personal',
        data: { purpose: 'service' }, // Incoming purpose
      })

      // With service, step 6 < 7, so should NOT clear
      expect(db.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            onboardingStep: 6,
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
        step: 3,
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
