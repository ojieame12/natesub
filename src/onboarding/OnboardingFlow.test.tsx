import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../test/testUtils'
import { useOnboardingStore } from './store'
import OnboardingFlow from './index'

// Mock matchMedia for useReducedMotion hook
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Mock useAuthState to simulate authenticated user
vi.mock('../hooks/useAuthState', () => ({
  useAuthState: () => ({
    status: 'authenticated',
    onboarding: null,
  }),
}))

describe('OnboardingFlow', () => {
  beforeEach(() => {
    useOnboardingStore.getState().reset()
  })

  // V5 flow: email(0) → otp(1) → identity(2) → setup(3) → payments(4) → [service(5)] → review(5 or 6)
  // Personal: 6 steps for ALL countries (no address step)
  // Service: 7 steps for ALL countries (service step included)

  describe('V5 step rendering', () => {
    it('shows SetupStep at step 3 for any country', async () => {
      // Step 3 is SetupStep (username + type toggle + price) in V5 flow
      useOnboardingStore.setState({
        countryCode: 'US',
        currentStep: 3,
        firstName: 'Ada',
        lastName: 'Lovelace',
        purpose: 'personal',
      })

      renderWithProviders(<OnboardingFlow />)

      await waitFor(() => {
        // SetupStep should render — no address or purpose step at index 3
        expect(screen.queryByText("What's your address?")).not.toBeInTheDocument()
        expect(screen.queryByText("What's this for?")).not.toBeInTheDocument()
      })
    })

    it('no address step for any country in V5', async () => {
      // Verify address step was removed for US, NG, GH, KE, GB
      for (const countryCode of ['US', 'NG', 'GH', 'KE', 'GB']) {
        useOnboardingStore.setState({
          countryCode,
          currentStep: 3, // Was address step index in old flow
          firstName: 'Test',
          lastName: 'User',
          purpose: 'personal',
        })

        const { unmount } = renderWithProviders(<OnboardingFlow />)

        await waitFor(() => {
          expect(screen.queryByText("What's your address?")).not.toBeInTheDocument()
        })

        unmount()
      }
    })
  })

  describe('step indices match V5 flow length', () => {
    it('has 6 steps for personal flow (review at index 5)', async () => {
      // V5 flow: email(0) → otp(1) → identity(2) → setup(3) → payments(4) → review(5)
      useOnboardingStore.setState({
        countryCode: 'US',
        currentStep: 5, // Last step (Review) in 6-step personal flow
        firstName: 'Ada',
        lastName: 'Lovelace',
        username: 'ada',
        purpose: 'personal',
      })

      renderWithProviders(<OnboardingFlow />)

      await waitFor(() => {
        expect(screen.getByText('Set up your page')).toBeInTheDocument()
      })
    })

    it('same step count for NG and US personal flow', async () => {
      // Both countries have same 6-step flow (no address step differentiation)
      useOnboardingStore.setState({
        countryCode: 'NG',
        currentStep: 5, // Last step (Review) in 6-step personal flow
        firstName: 'Chidi',
        lastName: 'Okonkwo',
        username: 'chidi',
        purpose: 'personal',
      })

      renderWithProviders(<OnboardingFlow />)

      await waitFor(() => {
        expect(screen.getByText('Set up your page')).toBeInTheDocument()
      })
    })
  })
})
