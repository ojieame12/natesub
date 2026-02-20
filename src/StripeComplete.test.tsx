import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import StripeComplete from './StripeComplete'
import { renderWithProviders } from './test/testUtils'
import { api } from './api'
import { useOnboardingStore } from './onboarding/store'

// Mock API (include safe session storage helpers)
vi.mock('./api', () => ({
  api: {
    stripe: {
      getStatus: vi.fn(),
      getDashboardLink: vi.fn(),
      refreshOnboarding: vi.fn(),
    },
    profile: {
      updateSettings: vi.fn(),
    },
  },
  // Safe sessionStorage wrappers - use real sessionStorage for testing
  safeSessionSetItem: (key: string, value: string) => sessionStorage.setItem(key, value),
  safeSessionGetItem: (key: string) => sessionStorage.getItem(key),
  safeSessionRemoveItem: (key: string) => sessionStorage.removeItem(key),
}))

// Mock hooks - useCurrentUser includes profile (no separate useProfile call)
vi.mock('./api/hooks', () => ({
  useCurrentUser: () => ({
    data: {
      profile: { username: 'test', isPublic: false },
      onboarding: { step: 0, data: {} },
    },
  }),
}))

// Mock navigation
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

describe('StripeComplete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    useOnboardingStore.getState().reset()
  })

  // Removed useFakeTimers to allow async useEffects to run naturally in waitFor

  it('shows loading state initially', () => {
    // Return pending promise to keep it loading
    vi.mocked(api.stripe.getStatus).mockReturnValue(new Promise(() => {}))
    
    renderWithProviders(<StripeComplete />)
    
    expect(screen.getByText('Verifying your account...')).toBeInTheDocument()
  })

  it('shows success state when status is active', async () => {
    vi.mocked(api.stripe.getStatus).mockResolvedValue({ connected: true, status: 'active', details: {} as any })
    
    renderWithProviders(<StripeComplete />)
    
    await waitFor(() => {
      expect(screen.getByText("You're ready to get paid!")).toBeInTheDocument()
    })
    
    expect(screen.getByText('Continue to Dashboard')).toBeInTheDocument()
  })

  it('shows restricted state when status is restricted', async () => {
    vi.mocked(api.stripe.getStatus).mockResolvedValue({
      connected: true,
      status: 'restricted',
      details: { requirements: { currentlyDue: ['individual.id_number'] } } as any
    })
    
    renderWithProviders(<StripeComplete />)
    
    await waitFor(() => {
      expect(screen.getByText('Action Required')).toBeInTheDocument()
      expect(screen.getByText('ID number (SSN/Tax ID)')).toBeInTheDocument()
    })
    
    expect(screen.getByText('Complete Setup')).toBeInTheDocument()
  })

  it('shows pending state when status is pending', async () => {
    vi.mocked(api.stripe.getStatus).mockResolvedValue({ connected: true, status: 'pending', details: {} as any })
    
    renderWithProviders(<StripeComplete />)
    
    await waitFor(() => {
      expect(screen.getByText('Almost There!')).toBeInTheDocument()
    })
    
    expect(screen.getByText(/Checking status/)).toBeInTheDocument()
  })

  it('navigates to review step for US users (non-service flow)', async () => {
    // US users with non-service purpose go to review step after Stripe completion
    useOnboardingStore.setState({ countryCode: 'US', purpose: 'personal' })
    vi.mocked(api.stripe.getStatus).mockResolvedValue({ connected: true, status: 'active', details: {} as any })

    renderWithProviders(<StripeComplete />)

    await waitFor(() => {
      expect(screen.getByText('Continue to Dashboard')).toBeInTheDocument()
    })

    const continueBtn = screen.getByText('Continue to Dashboard')
    fireEvent.click(continueBtn)

    // Non-service flow navigates to review step using step key
    expect(mockNavigate).toHaveBeenCalledWith('/onboarding?step=review', { replace: true })
  })

  it('navigates to review step for NG users (non-service flow)', async () => {
    // NG users with non-service purpose go to review step after Stripe completion
    useOnboardingStore.setState({ countryCode: 'NG', purpose: 'personal' })
    vi.mocked(api.stripe.getStatus).mockResolvedValue({ connected: true, status: 'active', details: {} as any })

    renderWithProviders(<StripeComplete />)

    await waitFor(() => {
      expect(screen.getByText('Continue to Dashboard')).toBeInTheDocument()
    })

    const continueBtn = screen.getByText('Continue to Dashboard')
    fireEvent.click(continueBtn)

    // Non-service flow navigates to review step using step key
    expect(mockNavigate).toHaveBeenCalledWith('/onboarding?step=review', { replace: true })
  })

  it('navigates to service step for service users', async () => {
    // Service users go to service step after Stripe completion (not review)
    useOnboardingStore.setState({ countryCode: 'NG', purpose: 'service' })
    vi.mocked(api.stripe.getStatus).mockResolvedValue({ connected: true, status: 'active', details: {} as any })

    renderWithProviders(<StripeComplete />)

    await waitFor(() => {
      expect(screen.getByText('Continue to Dashboard')).toBeInTheDocument()
    })

    const continueBtn = screen.getByText('Continue to Dashboard')
    fireEvent.click(continueBtn)

    // Service flow navigates to service step (V5: combined service-desc + ai-gen)
    expect(mockNavigate).toHaveBeenCalledWith('/onboarding?step=service', { replace: true })
  })

  it('retries setup when restricted', async () => {
    vi.mocked(api.stripe.getStatus).mockResolvedValue({ connected: true, status: 'restricted', details: {} as any })
    vi.mocked(api.stripe.refreshOnboarding).mockResolvedValue({ onboardingUrl: 'https://connect.stripe.com/retry' })
    
    // Mock location
    const originalLocation = window.location
    delete (window as any).location
    window.location = { href: '' } as any
    
    renderWithProviders(<StripeComplete />)
    
    await waitFor(() => {
      expect(screen.getByText('Complete Setup')).toBeInTheDocument()
    })
    
    const retryBtn = screen.getByText('Complete Setup')
    fireEvent.click(retryBtn)
    
    await waitFor(() => {
      expect(api.stripe.refreshOnboarding).toHaveBeenCalled()
      expect(window.location.href).toBe('https://connect.stripe.com/retry')
    })
    
    ;(window as any).location = originalLocation
  })
})
