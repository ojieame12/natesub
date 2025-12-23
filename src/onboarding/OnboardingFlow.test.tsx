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

  describe('dynamic step rendering based on country', () => {
    it('shows AddressStep for US users at step 4', () => {
      // US users see the address step (8-step flow)
      useOnboardingStore.setState({
        countryCode: 'US',
        currentStep: 4,
        firstName: 'Ada',
        lastName: 'Lovelace',
      })

      renderWithProviders(<OnboardingFlow />)

      // AddressStep should render with its heading
      expect(screen.getByText("What's your address?")).toBeInTheDocument()
    })

    it('shows UsernameStep for NG users at step 4 (no address step)', () => {
      // NG users skip the address step (7-step flow)
      useOnboardingStore.setState({
        countryCode: 'NG',
        currentStep: 4,
        firstName: 'Chidi',
        lastName: 'Okonkwo',
      })

      renderWithProviders(<OnboardingFlow />)

      // Should be at UsernameStep, not AddressStep
      expect(screen.queryByText("What's your address?")).not.toBeInTheDocument()
      expect(screen.getByText('Claim your link')).toBeInTheDocument()
    })

    it('shows AddressStep for UK users at step 4', () => {
      // UK users see the address step
      useOnboardingStore.setState({
        countryCode: 'GB',
        currentStep: 4,
        firstName: 'James',
        lastName: 'Bond',
      })

      renderWithProviders(<OnboardingFlow />)

      expect(screen.getByText("What's your address?")).toBeInTheDocument()
    })

    it('skips address step for GH users', () => {
      // GH (Ghana) is a cross-border country, no address step
      useOnboardingStore.setState({
        countryCode: 'GH',
        currentStep: 4,
        firstName: 'Kwame',
        lastName: 'Asante',
      })

      renderWithProviders(<OnboardingFlow />)

      expect(screen.queryByText("What's your address?")).not.toBeInTheDocument()
      expect(screen.getByText('Claim your link')).toBeInTheDocument()
    })

    it('skips address step for KE users', () => {
      // KE (Kenya) is a cross-border country, no address step
      useOnboardingStore.setState({
        countryCode: 'KE',
        currentStep: 4,
        firstName: 'Wanjiku',
        lastName: 'Mwangi',
      })

      renderWithProviders(<OnboardingFlow />)

      expect(screen.queryByText("What's your address?")).not.toBeInTheDocument()
      expect(screen.getByText('Claim your link')).toBeInTheDocument()
    })
  })

  describe('step indices match flow length', () => {
    it('has 8 steps for US flow (with address)', () => {
      useOnboardingStore.setState({
        countryCode: 'US',
        currentStep: 7, // Last step (Review) in 8-step flow
        firstName: 'Ada',
        lastName: 'Lovelace',
        username: 'ada',
      })

      renderWithProviders(<OnboardingFlow />)

      // Step 7 is PersonalReviewStep in 8-step flow
      expect(screen.getByText('Set up your page')).toBeInTheDocument()
    })

    it('has 7 steps for NG flow (no address)', () => {
      useOnboardingStore.setState({
        countryCode: 'NG',
        currentStep: 6, // Last step (Review) in 7-step flow
        firstName: 'Chidi',
        lastName: 'Okonkwo',
        username: 'chidi',
      })

      renderWithProviders(<OnboardingFlow />)

      // Step 6 is PersonalReviewStep in 7-step flow
      expect(screen.getByText('Set up your page')).toBeInTheDocument()
    })
  })
})
