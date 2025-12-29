import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import StripeComplete from './StripeComplete'
import { renderWithProviders } from './test/testUtils'
import { api } from './api'
import { useOnboardingStore } from './onboarding/store'

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
  useCurrentUser: () => ({ data: { onboarding: { step: 0, data: {} } } }),
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

  it('navigates to review step 9 for US users (10-step non-service flow)', async () => {
    // US users have 10-step non-service flow, review is at step 9
    // Flow: Start(0) → Email(1) → OTP(2) → Identity(3) → Address(4) → Purpose(5) → Avatar(6) → Username(7) → Payment(8) → Review(9)
    useOnboardingStore.setState({ countryCode: 'US', purpose: 'support' })
    vi.mocked(api.stripe.getStatus).mockResolvedValue({ connected: true, status: 'active', details: {} as any })

    renderWithProviders(<StripeComplete />)

    await waitFor(() => {
      expect(screen.getByText('Continue to Dashboard')).toBeInTheDocument()
    })

    const continueBtn = screen.getByText('Continue to Dashboard')
    fireEvent.click(continueBtn)

    // US non-service has 10-step flow, review is at step 9
    expect(mockNavigate).toHaveBeenCalledWith('/onboarding?step=9', { replace: true })
  })

  it('navigates to review step 8 for NG users (9-step non-service flow)', async () => {
    // NG users skip address step, have 9-step non-service flow, review is at step 8
    // Flow: Start(0) → Email(1) → OTP(2) → Identity(3) → Purpose(4) → Avatar(5) → Username(6) → Payment(7) → Review(8)
    useOnboardingStore.setState({ countryCode: 'NG', purpose: 'support' })
    vi.mocked(api.stripe.getStatus).mockResolvedValue({ connected: true, status: 'active', details: {} as any })

    renderWithProviders(<StripeComplete />)

    await waitFor(() => {
      expect(screen.getByText('Continue to Dashboard')).toBeInTheDocument()
    })

    const continueBtn = screen.getByText('Continue to Dashboard')
    fireEvent.click(continueBtn)

    // NG non-service has 9-step flow (no address), review is at step 8
    expect(mockNavigate).toHaveBeenCalledWith('/onboarding?step=8', { replace: true })
  })

  it('navigates to review step 10 for NG service users (11-step flow)', async () => {
    // NG service users have 11-step flow, review is at step 10
    // Flow: Start(0) → Email(1) → OTP(2) → Identity(3) → Purpose(4) → Avatar(5) → Username(6) → Payment(7) → ServiceDesc(8) → AIGen(9) → Review(10)
    useOnboardingStore.setState({ countryCode: 'NG', purpose: 'service' })
    vi.mocked(api.stripe.getStatus).mockResolvedValue({ connected: true, status: 'active', details: {} as any })

    renderWithProviders(<StripeComplete />)

    await waitFor(() => {
      expect(screen.getByText('Continue to Dashboard')).toBeInTheDocument()
    })

    const continueBtn = screen.getByText('Continue to Dashboard')
    fireEvent.click(continueBtn)

    // NG service has 11-step flow, review is at step 10
    expect(mockNavigate).toHaveBeenCalledWith('/onboarding?step=10', { replace: true })
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
