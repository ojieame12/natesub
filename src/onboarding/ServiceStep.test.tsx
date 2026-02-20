import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOnboardingStore } from './store'
import { renderWithProviders } from '../test/testUtils'
import ServiceStep from './ServiceStep'

const saveProgress = vi.fn()
const generatePerks = vi.fn()

vi.mock('../api/hooks', () => {
  return {
    useSaveOnboardingProgress: () => ({ mutateAsync: saveProgress }),
    useGeneratePerks: () => ({ mutateAsync: generatePerks }),
    useAIConfig: () => ({
      data: { available: true },
      isError: false,
    }),
  }
})

describe('onboarding/ServiceStep', () => {
  beforeEach(() => {
    saveProgress.mockReset()
    generatePerks.mockReset()
    useOnboardingStore.getState().reset()
    useOnboardingStore.setState({
      currentStep: 5,
      currentStepKey: 'service',
      purpose: 'service',
      firstName: 'Test',
      singleAmount: 25,
    })
  })

  it('renders description input and generate perks button', () => {
    renderWithProviders(<ServiceStep />)

    expect(screen.getByTestId('service-description-input')).toBeInTheDocument()
    // Button component doesn't forward data-testid, query by role/text
    expect(screen.getByRole('button', { name: /generate perks/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument()
  })

  it('disables generate button when description is too short', () => {
    renderWithProviders(<ServiceStep />)

    const generateBtn = screen.getByRole('button', { name: /generate perks/i })
    expect(generateBtn).toBeDisabled()
  })

  it('generates perks and shows them inline', async () => {
    renderWithProviders(<ServiceStep />)
    const user = userEvent.setup()

    const input = screen.getByTestId('service-description-input')
    await user.type(input, 'I provide weekly fitness coaching with personalized workout plans')

    generatePerks.mockResolvedValueOnce({
      perks: [
        { id: 'p1', title: 'Weekly coaching session', enabled: true },
        { id: 'p2', title: 'Personalized workout plan', enabled: true },
        { id: 'p3', title: 'Monthly progress review', enabled: true },
      ],
    })

    await user.click(screen.getByRole('button', { name: /generate perks/i }))

    await waitFor(() => {
      expect(screen.getByTestId('service-perks')).toBeInTheDocument()
      expect(screen.getByText('Weekly coaching session')).toBeInTheDocument()
      expect(screen.getByText('Personalized workout plan')).toBeInTheDocument()
      expect(screen.getByText('Monthly progress review')).toBeInTheDocument()
    })
  })

  it('falls back to placeholder perks when AI generation fails', async () => {
    renderWithProviders(<ServiceStep />)
    const user = userEvent.setup()

    const input = screen.getByTestId('service-description-input')
    await user.type(input, 'I provide weekly fitness coaching with personalized workout plans')

    generatePerks.mockRejectedValueOnce(new Error('AI unavailable'))

    await user.click(screen.getByRole('button', { name: /generate perks/i }))

    await waitFor(() => {
      expect(screen.getByTestId('service-perks')).toBeInTheDocument()
      expect(screen.getByText('Monthly subscription access')).toBeInTheDocument()
      expect(screen.getByText('Direct support for my work')).toBeInTheDocument()
      expect(screen.getByText('Exclusive updates and content')).toBeInTheDocument()
    })
  })

  it('saves with stepKey review and purpose service on continue', async () => {
    useOnboardingStore.setState({
      servicePerks: [
        { id: 'p1', title: 'Perk 1', enabled: true },
        { id: 'p2', title: 'Perk 2', enabled: true },
        { id: 'p3', title: 'Perk 3', enabled: true },
      ],
    })

    renderWithProviders(<ServiceStep />)
    const user = userEvent.setup()

    const input = screen.getByTestId('service-description-input')
    await user.type(input, 'I provide weekly fitness coaching with personalized plans')

    saveProgress.mockResolvedValueOnce({})
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => {
      expect(saveProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          stepKey: 'review',
          data: expect.objectContaining({
            purpose: 'service',
          }),
        })
      )
    })
  })

  it('shows error when save fails', async () => {
    useOnboardingStore.setState({
      servicePerks: [
        { id: 'p1', title: 'Perk 1', enabled: true },
        { id: 'p2', title: 'Perk 2', enabled: true },
        { id: 'p3', title: 'Perk 3', enabled: true },
      ],
    })

    renderWithProviders(<ServiceStep />)
    const user = userEvent.setup()

    const input = screen.getByTestId('service-description-input')
    await user.type(input, 'I provide weekly fitness coaching with personalized plans')

    saveProgress.mockRejectedValueOnce(new Error('Network error'))
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => {
      expect(screen.getByText(/failed to save/i)).toBeInTheDocument()
    })
  })
})
