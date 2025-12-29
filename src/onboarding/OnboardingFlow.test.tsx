import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../test/testUtils'
import { useOnboardingStore } from './store'
import OnboardingFlow from './index'

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

  // New flow: Start → Email → OTP → Identity → [Address] → Purpose → Avatar → Username → Payment → [ServiceDesc → AIGen] → Review
  // NG (no address): 9 steps (non-service) or 11 steps (service)
  // US (with address): 10 steps (non-service) or 12 steps (service)

  describe('dynamic step rendering based on country', () => {
    it('shows AddressStep for US users at step 4', () => {
      // US users see the address step (10-step flow for non-service)
      useOnboardingStore.setState({
        countryCode: 'US',
        currentStep: 4,
        firstName: 'Ada',
        lastName: 'Lovelace',
        purpose: 'support',
      })

      renderWithProviders(<OnboardingFlow />)

      // AddressStep should render with its heading
      expect(screen.getByText("What's your address?")).toBeInTheDocument()
    })

    it('shows PurposeStep for NG users at step 4 (no address step)', () => {
      // NG users skip the address step - step 4 is PurposeStep
      useOnboardingStore.setState({
        countryCode: 'NG',
        currentStep: 4,
        firstName: 'Chidi',
        lastName: 'Okonkwo',
        purpose: 'support',
      })

      renderWithProviders(<OnboardingFlow />)

      // Should be at PurposeStep, not AddressStep
      expect(screen.queryByText("What's your address?")).not.toBeInTheDocument()
      expect(screen.getByText("What's this for?")).toBeInTheDocument()
    })

    it('shows AddressStep for UK users at step 4', () => {
      // UK users see the address step
      useOnboardingStore.setState({
        countryCode: 'GB',
        currentStep: 4,
        firstName: 'James',
        lastName: 'Bond',
        purpose: 'support',
      })

      renderWithProviders(<OnboardingFlow />)

      expect(screen.getByText("What's your address?")).toBeInTheDocument()
    })

    it('skips address step for GH users', () => {
      // GH (Ghana) is a cross-border country, no address step - step 4 is PurposeStep
      useOnboardingStore.setState({
        countryCode: 'GH',
        currentStep: 4,
        firstName: 'Kwame',
        lastName: 'Asante',
        purpose: 'support',
      })

      renderWithProviders(<OnboardingFlow />)

      expect(screen.queryByText("What's your address?")).not.toBeInTheDocument()
      expect(screen.getByText("What's this for?")).toBeInTheDocument()
    })

    it('skips address step for KE users', () => {
      // KE (Kenya) is a cross-border country, no address step - step 4 is PurposeStep
      useOnboardingStore.setState({
        countryCode: 'KE',
        currentStep: 4,
        firstName: 'Wanjiku',
        lastName: 'Mwangi',
        purpose: 'support',
      })

      renderWithProviders(<OnboardingFlow />)

      expect(screen.queryByText("What's your address?")).not.toBeInTheDocument()
      expect(screen.getByText("What's this for?")).toBeInTheDocument()
    })
  })

  describe('step indices match flow length', () => {
    it('has 10 steps for US non-service flow (with address)', () => {
      // Flow: Start(0) → Email(1) → OTP(2) → Identity(3) → Address(4) → Purpose(5) → Avatar(6) → Username(7) → Payment(8) → Review(9)
      useOnboardingStore.setState({
        countryCode: 'US',
        currentStep: 9, // Last step (Review) in 10-step flow
        firstName: 'Ada',
        lastName: 'Lovelace',
        username: 'ada',
        purpose: 'support',
      })

      renderWithProviders(<OnboardingFlow />)

      // Step 9 is PersonalReviewStep in 10-step flow (non-service)
      expect(screen.getByText('Set up your page')).toBeInTheDocument()
    })

    it('has 9 steps for NG non-service flow (no address)', () => {
      // Flow: Start(0) → Email(1) → OTP(2) → Identity(3) → Purpose(4) → Avatar(5) → Username(6) → Payment(7) → Review(8)
      useOnboardingStore.setState({
        countryCode: 'NG',
        currentStep: 8, // Last step (Review) in 9-step flow
        firstName: 'Chidi',
        lastName: 'Okonkwo',
        username: 'chidi',
        purpose: 'support',
      })

      renderWithProviders(<OnboardingFlow />)

      // Step 8 is PersonalReviewStep in 9-step flow (non-service)
      expect(screen.getByText('Set up your page')).toBeInTheDocument()
    })
  })
})
