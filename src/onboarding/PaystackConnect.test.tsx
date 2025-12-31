import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, act } from '@testing-library/react'
import { renderWithProviders } from '../test/testUtils'
import { useOnboardingStore } from './store'
import PaystackConnect from './PaystackConnect'

// Mock API hooks with factory function
let paystackBanksReturn: any
let profileReturn: any

vi.mock('../api/hooks', () => ({
  usePaystackBanks: () => paystackBanksReturn,
  usePaystackResolveAccount: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  usePaystackConnect: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useProfile: () => profileReturn,
}))

// Mock navigation
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

describe('PaystackConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Reset to hydrated state by default
    paystackBanksReturn = {
      data: { banks: [{ code: '001', name: 'Test Bank', type: 'nuban' }] },
      isLoading: false,
      isError: false,
    }
    profileReturn = {
      data: { profile: { countryCode: 'NG' } },
      isLoading: false,
      isError: false,
    }

    useOnboardingStore.setState({
      countryCode: 'NG',
    })
  })

  describe('Hydration timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('shows loading spinner while waiting for country hydration', async () => {
      // No country in store or profile
      useOnboardingStore.setState({ countryCode: '' })
      profileReturn = { data: null, isLoading: true, isError: false }
      paystackBanksReturn = { data: null, isLoading: true, isError: false }

      renderWithProviders(<PaystackConnect />)

      // Should show spinner
      expect(document.querySelector('.spin')).toBeInTheDocument()
    })

    it('shows error after timeout when country never hydrates', async () => {
      // No country in store
      useOnboardingStore.setState({ countryCode: '' })
      // Profile also has no country and is not loading
      profileReturn = { data: null, isLoading: false, isError: false }
      paystackBanksReturn = { data: null, isLoading: false, isError: false }

      renderWithProviders(<PaystackConnect />)

      // Initially shows spinner
      expect(document.querySelector('.spin')).toBeInTheDocument()

      // Advance past the 10 second timeout (wrapped in act to trigger React updates)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10500)
      })

      // Should now show error with Go Back button
      expect(screen.getByText(/Could not determine your country/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Go Back/i })).toBeInTheDocument()
    })

    it('shows error immediately when profile fetch fails', async () => {
      vi.useRealTimers() // Use real timers for this test

      // No country in store
      useOnboardingStore.setState({ countryCode: '' })
      // Profile fetch failed
      profileReturn = { data: null, isLoading: false, isError: true }
      paystackBanksReturn = { data: null, isLoading: false, isError: false }

      renderWithProviders(<PaystackConnect />)

      // Should show profile error immediately (no waiting for timeout)
      await waitFor(() => {
        expect(screen.getByText(/Failed to load your profile/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Go Back/i })).toBeInTheDocument()
      })
    })
  })

  describe('Banks loading', () => {
    it('shows error when banks API fails', async () => {
      paystackBanksReturn = { data: null, isLoading: false, isError: true }

      renderWithProviders(<PaystackConnect />)

      await waitFor(() => {
        expect(screen.getByText(/Failed to load banks/i)).toBeInTheDocument()
      })
    })

    it('renders form when banks load successfully', async () => {
      renderWithProviders(<PaystackConnect />)

      await waitFor(() => {
        expect(screen.getByText(/Connect your bank/i)).toBeInTheDocument()
        expect(screen.getByText(/Select your bank/i)).toBeInTheDocument()
      })
    })
  })

  describe('Country fallback', () => {
    it('uses profile countryCode as fallback when store is empty', async () => {
      // No country in store
      useOnboardingStore.setState({ countryCode: '' })
      // But profile has country
      profileReturn = {
        data: { profile: { countryCode: 'NG' } },
        isLoading: false,
        isError: false,
      }

      renderWithProviders(<PaystackConnect />)

      // Should show the form (using profile country)
      await waitFor(() => {
        expect(screen.getByText(/Connect your bank/i)).toBeInTheDocument()
      })
    })
  })
})
