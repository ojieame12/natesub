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
      firstName: 'Test',
      lastName: 'User',
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
    // Use US user to test direct redirect (NG shows SWIFT modal first)
    useOnboardingStore.setState({
      username: 'testuser',
      firstName: 'Test',
      lastName: 'User',
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      pricingModel: 'single',
      singleAmount: 10,
      paymentProvider: null,
    })

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
      expect(api.profile.update).toHaveBeenCalledWith(expect.objectContaining({
        paymentProvider: 'stripe',
        username: 'testuser',
        displayName: 'Test User', // firstName + lastName composite
        currency: 'USD',
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
        displayName: 'Test User', // firstName + lastName composite
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

  it('includes trimmed address fields in profile update', async () => {
    // Setup US user with address (US shows address step)
    useOnboardingStore.setState({
      username: 'ususer',
      firstName: 'Ada',
      lastName: 'Lovelace',
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      pricingModel: 'single',
      singleAmount: 10,
      currentStep: 6, // Payment step with address flow
      // Address with extra whitespace to test trimming
      address: '  123 Main St  ',
      city: '  San Francisco  ',
      state: '  CA  ',
      zip: '  94102  ',
    })

    vi.mocked(api.stripe.connect).mockResolvedValue({ success: true, alreadyOnboarded: true })

    renderWithProviders(<PaymentMethodStep />)

    fireEvent.click(screen.getByText('Stripe'))
    fireEvent.click(screen.getByText('Connect with Stripe'))

    await waitFor(() => {
      expect(api.profile.update).toHaveBeenCalledWith(expect.objectContaining({
        displayName: 'Ada Lovelace',
        // Address fields should be trimmed
        address: '123 Main St',
        city: 'San Francisco',
        state: 'CA',
        zip: '94102',
      }))
    })
  })

  it('saves progress with currentStep + 1 and countryCode', async () => {
    useOnboardingStore.setState({
      username: 'testuser',
      firstName: 'Test',
      lastName: 'User',
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      pricingModel: 'single',
      singleAmount: 10,
      currentStep: 6, // Payment step in 8-step flow
    })

    vi.mocked(api.stripe.connect).mockResolvedValue({ success: true, alreadyOnboarded: true })

    renderWithProviders(<PaymentMethodStep />)

    fireEvent.click(screen.getByText('Stripe'))
    fireEvent.click(screen.getByText('Connect with Stripe'))

    await waitFor(() => {
      // Should save currentStep + 1 with stepKey and purpose for safe cross-device resume
      expect(api.auth.saveOnboardingProgress).toHaveBeenCalledWith({
        step: 7, // currentStep (6) + 1
        stepKey: 'review', // Non-service flow, next step is review
        data: { paymentProvider: 'stripe', countryCode: 'US', purpose: 'support' },
      })
    })
  })

  it('sets stripe_return_to to next step (currentStep + 1) for NG 9-step flow', async () => {
    // New flow: Start(0) → Email(1) → OTP(2) → Identity(3) → Purpose(4) → Avatar(5) → Username(6) → Payment(7) → Review(8)
    useOnboardingStore.setState({
      username: 'testuser',
      firstName: 'Test',
      lastName: 'User',
      country: 'Nigeria',
      countryCode: 'NG',
      currency: 'NGN',
      pricingModel: 'single',
      singleAmount: 5000,
      purpose: 'support', // Non-service mode
      currentStep: 7, // Payment step in 9-step flow (no address)
    })

    const mockConnectRes = { success: true, onboardingUrl: 'https://connect.stripe.com/setup' }
    vi.mocked(api.stripe.connect).mockResolvedValue(mockConnectRes)

    // Mock sessionStorage
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    // Mock window.location
    const originalLocation = window.location
    delete (window as any).location
    window.location = { href: '' } as any

    renderWithProviders(<PaymentMethodStep />)

    fireEvent.click(screen.getByText('Stripe'))
    fireEvent.click(screen.getByText('Connect with Stripe'))

    await waitFor(() => {
      // Should set stripe_return_to to step key (review for non-service flow)
      expect(setItemSpy).toHaveBeenCalledWith('stripe_return_to', '/onboarding?step=review')
    })

    // Cleanup
    setItemSpy.mockRestore()
    ;(window as any).location = originalLocation
  })

  it('sets stripe_return_to to step 9 for US 10-step flow', async () => {
    // New flow with address: Start(0) → Email(1) → OTP(2) → Identity(3) → Address(4) → Purpose(5) → Avatar(6) → Username(7) → Payment(8) → Review(9)
    useOnboardingStore.setState({
      username: 'testuser',
      firstName: 'Test',
      lastName: 'User',
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      pricingModel: 'single',
      singleAmount: 10,
      purpose: 'support', // Non-service mode
      currentStep: 8, // Payment step in 10-step flow (with address)
    })

    const mockConnectRes = { success: true, onboardingUrl: 'https://connect.stripe.com/setup' }
    vi.mocked(api.stripe.connect).mockResolvedValue(mockConnectRes)

    // Mock sessionStorage
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    // Mock window.location
    const originalLocation = window.location
    delete (window as any).location
    window.location = { href: '' } as any

    renderWithProviders(<PaymentMethodStep />)

    fireEvent.click(screen.getByText('Stripe'))
    fireEvent.click(screen.getByText('Connect with Stripe'))

    await waitFor(() => {
      // Should set stripe_return_to to step key (review for non-service flow)
      expect(setItemSpy).toHaveBeenCalledWith('stripe_return_to', '/onboarding?step=review')
    })

    // Cleanup
    setItemSpy.mockRestore()
    ;(window as any).location = originalLocation
  })
})
