import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import StripeComplete from './StripeComplete'
import { renderWithProviders } from './test/testUtils'
import { api } from './api'

// Mock API
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
}))

// Mock hooks
vi.mock('./api/hooks', () => ({
  useProfile: () => ({ data: { profile: { username: 'test', isPublic: false } } }),
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

  it('navigates to dashboard on continue', async () => {
    vi.mocked(api.stripe.getStatus).mockResolvedValue({ connected: true, status: 'active', details: {} as any })
    
    renderWithProviders(<StripeComplete />)
    
    await waitFor(() => {
      expect(screen.getByText('Continue to Dashboard')).toBeInTheDocument()
    })
    
    const continueBtn = screen.getByText('Continue to Dashboard')
    fireEvent.click(continueBtn)
    
    // Checks that it navigates to dashboard (default behavior if no source)
    expect(mockNavigate).toHaveBeenCalledWith('/onboarding?step=6', { replace: true })
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
