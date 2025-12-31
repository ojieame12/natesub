import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/testUtils'
import { useOnboardingStore } from './store'
import AddressStep from './AddressStep'

const mockSaveProgress = vi.fn()

vi.mock('../api/hooks', () => ({
  useSaveOnboardingProgress: () => ({ mutateAsync: mockSaveProgress }),
}))

describe('AddressStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useOnboardingStore.getState().reset()
    mockSaveProgress.mockResolvedValue({ success: true })

    // Setup minimal state
    // Reset _lastNavTime to 0 to bypass the 300ms navigation cooldown in tests
    useOnboardingStore.setState({
      country: 'United States',
      countryCode: 'US',
      currentStep: 4,
      _lastNavTime: 0,
    } as any)
  })

  describe('validation', () => {
    it('disables Continue button when address is empty', () => {
      renderWithProviders(<AddressStep />)

      const continueBtn = screen.getByRole('button', { name: /continue/i })
      expect(continueBtn).toBeDisabled()
    })

    it('disables Continue button when address is too short', async () => {
      renderWithProviders(<AddressStep />)
      const user = userEvent.setup()

      // Address needs at least 5 chars
      await user.type(screen.getByPlaceholderText('Street address'), '123')
      await user.type(screen.getByPlaceholderText('City'), 'NYC')

      const continueBtn = screen.getByRole('button', { name: /continue/i })
      expect(continueBtn).toBeDisabled()
    })

    it('disables Continue button when city is too short', async () => {
      renderWithProviders(<AddressStep />)
      const user = userEvent.setup()

      await user.type(screen.getByPlaceholderText('Street address'), '123 Main St')
      // City needs at least 2 chars
      await user.type(screen.getByPlaceholderText('City'), 'A')

      const continueBtn = screen.getByRole('button', { name: /continue/i })
      expect(continueBtn).toBeDisabled()
    })

    it('enables Continue button when address and city are valid', async () => {
      renderWithProviders(<AddressStep />)
      const user = userEvent.setup()

      await user.type(screen.getByPlaceholderText('Street address'), '123 Main St')
      await user.type(screen.getByPlaceholderText('City'), 'San Francisco')

      const continueBtn = screen.getByRole('button', { name: /continue/i })
      expect(continueBtn).not.toBeDisabled()
    })

    it('state and zip are optional', async () => {
      renderWithProviders(<AddressStep />)
      const user = userEvent.setup()

      // Only fill required fields
      await user.type(screen.getByPlaceholderText('Street address'), '123 Main St')
      await user.type(screen.getByPlaceholderText('City'), 'SF')

      // Should be enabled without state/zip
      const continueBtn = screen.getByRole('button', { name: /continue/i })
      expect(continueBtn).not.toBeDisabled()
    })
  })

  describe('saving progress', () => {
    it('calls saveProgress with address data and currentStep + 1', async () => {
      useOnboardingStore.setState({ currentStep: 4, _lastNavTime: 0 } as any)

      renderWithProviders(<AddressStep />)
      const user = userEvent.setup()

      await user.type(screen.getByPlaceholderText('Street address'), '123 Main St')
      await user.type(screen.getByPlaceholderText('City'), 'San Francisco')
      await user.type(screen.getByPlaceholderText('State/Province'), 'CA')
      await user.type(screen.getByPlaceholderText('ZIP/Postal'), '94102')

      const continueBtn = screen.getByRole('button', { name: /continue/i })
      await user.click(continueBtn)

      await waitFor(() => {
        expect(mockSaveProgress).toHaveBeenCalledWith({
          step: 5, // currentStep (4) + 1
          stepKey: 'purpose', // NEXT step key - after address is always purpose
          data: {
            address: '123 Main St',
            city: 'San Francisco',
            state: 'CA',
            zip: '94102',
          },
        })
      })
    })

    it('advances to next step after saving', async () => {
      useOnboardingStore.setState({ currentStep: 4, _lastNavTime: 0 } as any)

      renderWithProviders(<AddressStep />)
      const user = userEvent.setup()

      await user.type(screen.getByPlaceholderText('Street address'), '123 Main St')
      await user.type(screen.getByPlaceholderText('City'), 'SF')

      await user.click(screen.getByRole('button', { name: /continue/i }))

      await waitFor(() => {
        expect(useOnboardingStore.getState().currentStep).toBe(5)
      })
    })

    it('does not advance and shows error if save fails', async () => {
      mockSaveProgress.mockRejectedValueOnce(new Error('Network error'))
      vi.spyOn(console, 'warn').mockImplementation(() => {})

      useOnboardingStore.setState({ currentStep: 4, _lastNavTime: 0 } as any)

      renderWithProviders(<AddressStep />)
      const user = userEvent.setup()

      await user.type(screen.getByPlaceholderText('Street address'), '123 Main St')
      await user.type(screen.getByPlaceholderText('City'), 'SF')

      await user.click(screen.getByRole('button', { name: /continue/i }))

      await waitFor(() => {
        // Should NOT advance when save fails - blocking behavior
        expect(useOnboardingStore.getState().currentStep).toBe(4)
        // Should show error message
        expect(screen.getByText(/Failed to save/i)).toBeInTheDocument()
      })
    })
  })

  describe('UI elements', () => {
    it('shows country name in info text', () => {
      useOnboardingStore.setState({ country: 'United Kingdom' })

      renderWithProviders(<AddressStep />)

      expect(screen.getByText(/Receiving payments in United Kingdom/)).toBeInTheDocument()
    })

    it('has back button that goes to previous step', async () => {
      useOnboardingStore.setState({ currentStep: 4, _lastNavTime: 0 } as any)

      renderWithProviders(<AddressStep />)

      // Find back button by its accessible role or by clicking
      const backButton = document.querySelector('.onboarding-back')
      expect(backButton).toBeInTheDocument()

      fireEvent.click(backButton!)

      expect(useOnboardingStore.getState().currentStep).toBe(3)
    })
  })
})
