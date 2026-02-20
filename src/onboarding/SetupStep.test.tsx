import { screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useOnboardingStore } from './store'
import { renderWithProviders } from '../test/testUtils'
import SetupStep from './SetupStep'

const saveProgress = vi.fn()

vi.mock('../api/hooks', () => {
  return {
    useSaveOnboardingProgress: () => ({ mutateAsync: saveProgress }),
    useCheckUsername: (username: string) => {
      if (!username || username.length < 3) {
        return { data: undefined, isLoading: false, isError: false, refetch: vi.fn() }
      }
      return {
        data: { available: true },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      }
    },
    useCreatorMinimum: () => ({ usd: 5, local: 5, currency: 'USD' }),
    useMyMinimum: () => ({ data: null }),
  }
})

describe('onboarding/SetupStep', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    saveProgress.mockReset()
    useOnboardingStore.getState().reset()
    useOnboardingStore.setState({
      currentStep: 3,
      currentStepKey: 'setup',
      firstName: 'Test',
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders username input, purpose toggle, and price input', () => {
    renderWithProviders(<SetupStep />)

    expect(screen.getByTestId('username-input')).toBeInTheDocument()
    expect(screen.getByTestId('purpose-toggle')).toBeInTheDocument()
    expect(screen.getByTestId('purpose-personal')).toBeInTheDocument()
    expect(screen.getByTestId('purpose-service')).toBeInTheDocument()
    expect(screen.getByTestId('price-input')).toBeInTheDocument()
    // Button component doesn't forward data-testid, query by role
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument()
  })

  it('defaults to personal purpose', () => {
    renderWithProviders(<SetupStep />)

    const personalBtn = screen.getByTestId('purpose-personal')
    expect(personalBtn.className).toContain('selected')
  })

  it('can toggle to service purpose', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<SetupStep />)

    const serviceBtn = screen.getByTestId('purpose-service')
    await user.click(serviceBtn)

    expect(serviceBtn.className).toContain('selected')
    const personalBtn = screen.getByTestId('purpose-personal')
    expect(personalBtn.className).not.toContain('selected')
  })

  it('saves purpose and username on continue', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<SetupStep />)

    // Type valid username
    await user.type(screen.getByTestId('username-input'), 'testuser')

    // Set price
    const priceInput = screen.getByTestId('price-input')
    await user.clear(priceInput)
    await user.type(priceInput, '10')

    // Advance past the 500ms debounce
    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    const continueBtn = screen.getByRole('button', { name: /continue/i })
    await waitFor(() => {
      expect(continueBtn).toBeEnabled()
    })

    saveProgress.mockResolvedValueOnce({})
    await user.click(continueBtn)

    await waitFor(() => {
      expect(saveProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          stepKey: 'payments',
          data: expect.objectContaining({
            purpose: 'personal',
            username: 'testuser',
          }),
        })
      )
    })
  })

  it('saves service purpose when toggled', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<SetupStep />)

    // Toggle to service
    await user.click(screen.getByTestId('purpose-service'))

    // Type valid username
    await user.type(screen.getByTestId('username-input'), 'myservice')

    // Set price
    const priceInput = screen.getByTestId('price-input')
    await user.clear(priceInput)
    await user.type(priceInput, '25')

    // Advance past debounce
    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    const continueBtn = screen.getByRole('button', { name: /continue/i })
    await waitFor(() => {
      expect(continueBtn).toBeEnabled()
    })

    saveProgress.mockResolvedValueOnce({})
    await user.click(continueBtn)

    await waitFor(() => {
      expect(saveProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            purpose: 'service',
          }),
        })
      )
    })
  })

  it('shows error when save fails', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderWithProviders(<SetupStep />)

    await user.type(screen.getByTestId('username-input'), 'testuser')

    const priceInput = screen.getByTestId('price-input')
    await user.clear(priceInput)
    await user.type(priceInput, '10')

    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    const continueBtn = screen.getByRole('button', { name: /continue/i })
    await waitFor(() => {
      expect(continueBtn).toBeEnabled()
    })

    saveProgress.mockRejectedValueOnce(new Error('Network error'))
    await user.click(continueBtn)

    await waitFor(() => {
      expect(screen.getByText(/failed to save/i)).toBeInTheDocument()
    })
  })
})
