import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import PaymentMethodStep from './PaymentMethodStep'
import { renderWithProviders } from '../test/testUtils'
import { useOnboardingStore } from './store'
import { api } from '../api'

// Mock API
vi.mock('../api', () => ({
  api: {
    profile: {
      update: vi.fn(),
      updateSettings: vi.fn(),
    },
    auth: {
      saveOnboardingProgress: vi.fn().mockResolvedValue({}),
    },
    stripe: {
      connect: vi.fn(),
    },
  },
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

describe('PaymentMethodStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useOnboardingStore.getState().reset()
    
    // Ensure mocks return promises with correct types
    vi.mocked(api.auth.saveOnboardingProgress).mockResolvedValue({ success: true })
    vi.mocked(api.profile.update).mockResolvedValue({ profile: {} as any })
    
    // Setup minimal store state required for validation
    // NG users default to local currency (NGN), payment method choice handles currency
    useOnboardingStore.setState({
      username: 'testuser',
      name: 'Test User',
      country: 'Nigeria',
      countryCode: 'NG',
      currency: 'NGN', // Default to local currency
      pricingModel: 'single',
      singleAmount: 5000, // ₦5000 (minimum for NGN is ₦500)
      paymentProvider: null,
    })
  })

  it('renders payment options correctly', () => {
    renderWithProviders(<PaymentMethodStep />)

    expect(screen.getByText('Connect payments')).toBeInTheDocument()
    expect(screen.getByText('Stripe')).toBeInTheDocument()
    // Both Stripe and Paystack available for NG - user can choose
    expect(screen.getByText('Paystack')).toBeInTheDocument()
  })

  it('selects Stripe and initiates connect flow', async () => {
    // Mock Stripe connect response
    const mockConnectRes = { success: true, onboardingUrl: 'https://connect.stripe.com/setup' }
    vi.mocked(api.stripe.connect).mockResolvedValue(mockConnectRes)
    vi.mocked(api.profile.update).mockResolvedValue({ profile: {} as any })

    // Assign window.location for redirect test
    const originalLocation = window.location
    delete (window as any).location
    window.location = { href: '' } as any

    renderWithProviders(<PaymentMethodStep />)

    // Select Stripe
    fireEvent.click(screen.getByText('Stripe'))

    // Click Continue
    const continueBtn = screen.getByText('Connect with Stripe')
    fireEvent.click(continueBtn)

    await waitFor(() => {
      // Currency should switch to USD for cross-border Stripe
      expect(api.profile.update).toHaveBeenCalledWith(expect.objectContaining({
        paymentProvider: 'stripe',
        username: 'testuser',
        currency: 'USD', // Auto-switched from NGN to USD for Stripe
      }))
      expect(api.stripe.connect).toHaveBeenCalled()
      expect(window.location.href).toBe(mockConnectRes.onboardingUrl)
    })

    // Restore location
    ;(window as any).location = originalLocation
  })

  it('selects Paystack and keeps local currency', async () => {
    // NG user defaults to NGN, Paystack keeps it
    renderWithProviders(<PaymentMethodStep />)

    // Select Paystack
    fireEvent.click(screen.getByText('Paystack'))

    // Click Continue
    const continueBtn = screen.getByText('Connect Payment Method')
    fireEvent.click(continueBtn)

    await waitFor(() => {
      // Currency stays NGN for Paystack
      expect(api.profile.update).toHaveBeenCalledWith(expect.objectContaining({
        paymentProvider: 'paystack',
        currency: 'NGN',
      }))
      expect(mockNavigate).toHaveBeenCalledWith('/onboarding/paystack')
    })
  })

  it('shows validation error if store data is missing', async () => {
    // Clear username to force error
    useOnboardingStore.setState({ username: '' })

    renderWithProviders(<PaymentMethodStep />)

    // Select Stripe
    fireEvent.click(screen.getByText('Stripe'))

    // Click Continue
    const continueBtn = screen.getByText('Connect with Stripe')
    fireEvent.click(continueBtn)

    await waitFor(() => {
      expect(screen.getByText(/Username is required/)).toBeInTheDocument()
      expect(api.profile.update).not.toHaveBeenCalled()
    })
  })
})
