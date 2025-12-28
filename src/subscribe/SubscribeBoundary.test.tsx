import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../test/testUtils'
import SubscribeBoundary from './SubscribeBoundary'

// Mock fetch for IP detection
const mockFetch = vi.fn(() =>
  Promise.resolve({
    text: () => Promise.resolve('NG'),
    ok: true,
  } as Response)
)
vi.stubGlobal('fetch', mockFetch)

// Mock createCheckout mutation
const mockCreateCheckout = vi.fn()
const mockRecordPageView = vi.fn(() => Promise.resolve({ viewId: 'view-123' }))
const mockUpdatePageView = vi.fn(() => Promise.resolve())

vi.mock('../api/hooks', () => ({
  useCreateCheckout: vi.fn(() => ({
    mutateAsync: mockCreateCheckout,
    isPending: false,
  })),
  useRecordPageView: vi.fn(() => ({
    mutateAsync: mockRecordPageView,
  })),
  useUpdatePageView: vi.fn(() => ({
    mutateAsync: mockUpdatePageView,
  })),
  useFeeConfig: vi.fn(() => ({
    data: { platformFeeRate: 0.08, splitRate: 0.04, crossBorderBuffer: 0.015 },
    isLoading: false,
  })),
}))

// Mock api.checkout.verifySession and detectPayerCountry
vi.mock('../api/client', () => ({
  checkout: {
    verifySession: vi.fn(() => Promise.resolve({ verified: true })),
    verifyPaystack: vi.fn(() => Promise.resolve({ verified: true })),
  },
  detectPayerCountry: vi.fn(() => Promise.resolve('US')),
}))

import * as api from '../api/client'

// Sample profile data matching the Profile type
const mockProfile = {
  id: 'profile-123',
  username: 'testcreator',
  displayName: 'Test Creator',
  bio: 'Test bio',
  avatarUrl: 'https://example.com/avatar.jpg',
  voiceIntroUrl: null,
  country: 'United States',
  countryCode: 'US',
  currency: 'USD',
  purpose: 'tips',
  pricingModel: 'single' as const,
  singleAmount: 10, // $10.00 in display units
  tiers: null,
  perks: null,
  impactItems: null,
  paymentProvider: 'stripe',
  payoutStatus: 'active' as const,
  shareUrl: null,
  template: 'boundary' as const,
  paymentsReady: true,
  feeMode: 'split' as const,
}

// Note: Animations are skipped in test mode (import.meta.env.MODE === 'test')
// See SubscribeBoundary.tsx useEffect

describe('SubscribeBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock sessionStorage
    const mockStorage: Record<string, string> = {}
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, value: string) => { mockStorage[key] = value },
      removeItem: (key: string) => { delete mockStorage[key] },
      clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]) },
    })
    // Reset window.location
    delete (window as any).location
    ;(window as any).location = { href: '', origin: 'https://natepay.com' }
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  describe('Rendering', () => {
    it('renders profile information correctly in Support mode', async () => {
      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      // Wait for render
      await waitFor(() => {
        expect(screen.getByText('Test Creator')).toBeInTheDocument()
      })

      // Support badge for non-service users
      expect(screen.getByText('Support')).toBeInTheDocument()
      // Price display (appears multiple times - header and pricing card)
      expect(screen.getAllByText(/\$10\.00/).length).toBeGreaterThan(0)
    })

    it('shows Retainer badge for service profiles', async () => {
      renderWithProviders(
        <SubscribeBoundary profile={{ ...mockProfile, purpose: 'service' }} />,
        { route: '/testcreator', routePath: '/:username' }
      )

      await waitFor(() => {
        expect(screen.getByText('Retainer')).toBeInTheDocument()
      })
    })

    it('shows secure payment fee with split model', async () => {
      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      await waitFor(() => {
        // Should show secure payment fee (subscriber's portion)
        expect(screen.getByText('Secure payment Fee')).toBeInTheDocument()
      })
    })

    it('renders perks list for service mode', async () => {
      const serviceProfile = {
        ...mockProfile,
        purpose: 'service',
        perks: [
          { id: '1', title: 'Daily Coaching sessions', enabled: true },
          { id: '2', title: 'Custom Dieting Plans', enabled: true },
        ],
      }

      renderWithProviders(<SubscribeBoundary profile={serviceProfile} />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      await waitFor(() => {
        expect(screen.getByText('Daily Coaching sessions')).toBeInTheDocument()
        expect(screen.getByText('Custom Dieting Plans')).toBeInTheDocument()
      })
    })
  })

  describe('Email validation', () => {
    it('disables slide to pay when email is invalid', async () => {
      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      await waitFor(() => {
        expect(screen.getByText('Slide to Pay')).toBeInTheDocument()
      })

      // The container should have opacity: 0.6 when disabled (no email)
      const slideContainer = screen.getByText('Slide to Pay').closest('div[style*="border-radius"]')
      expect(slideContainer).toHaveStyle({ opacity: '0.6' })
    })

    it('enables slide to pay when email is valid', async () => {
      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      // Email input uses floating label (not placeholder) when focused
      const emailInput = screen.getByRole('textbox')
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } })

      // Slide button should be enabled (opacity: 1)
      const slideContainer = screen.getByText('Slide to Pay').closest('div[style*="border-radius"]')
      expect(slideContainer).toHaveStyle({ opacity: '1' })
    })
  })

  describe('Owner view', () => {
    it('shows edit button for owner', async () => {
      renderWithProviders(<SubscribeBoundary profile={mockProfile} isOwner />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      await waitFor(() => {
        expect(screen.getByText('Edit')).toBeInTheDocument()
      })
    })

    it('shows Share button for owner', async () => {
      renderWithProviders(<SubscribeBoundary profile={mockProfile} isOwner />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      await waitFor(() => {
        expect(screen.getByText('Share')).toBeInTheDocument()
      })
    })

    it('does not record page view for owner', async () => {
      renderWithProviders(<SubscribeBoundary profile={mockProfile} isOwner />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100))

      // Page view should not be recorded for owner
      expect(mockRecordPageView).not.toHaveBeenCalled()
    })
  })

  describe('Page view analytics', () => {
    it('captures UTM parameters from URL', async () => {
      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator?utm_source=twitter&utm_medium=social',
        routePath: '/:username',
      })

      // Wait for the page view to be recorded
      await waitFor(() => {
        expect(mockRecordPageView).toHaveBeenCalled()
      })

      expect(mockRecordPageView).toHaveBeenCalledWith(
        expect.objectContaining({
          utmSource: 'twitter',
          utmMedium: 'social',
        })
      )
    })
  })

  describe('Checkout flow', () => {
    it('shows slide to pay button with correct label', async () => {
      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      await waitFor(() => {
        expect(screen.getByText('Slide to Pay')).toBeInTheDocument()
      })
    })

    it('shows email input for subscriber', async () => {
      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      // Placeholder text when empty (animations skipped in test mode)
      expect(screen.getByPlaceholderText('Customer Email')).toBeInTheDocument()
    })

    it('passes payerCountry from geo detection to createCheckout', async () => {
      mockCreateCheckout.mockResolvedValueOnce({ url: 'https://checkout.example.com' })

      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      const emailInput = screen.getByPlaceholderText('Customer Email')
      fireEvent.change(emailInput, { target: { value: 'sub@example.com' } })

      // Find the slider container
      const slideText = screen.getByText('Slide to Pay')
      const slideContainer = slideText.closest('div[style*="border-radius"]') as HTMLElement
      if (!slideContainer) throw new Error('Missing slide container')

      vi.spyOn(slideContainer, 'getBoundingClientRect').mockReturnValue({
        width: 300,
        height: 56,
        top: 0,
        left: 0,
        right: 300,
        bottom: 56,
        x: 0,
        y: 0,
        toJSON: () => { },
      } as any)

      // Find the handle (circular element)
      const handle = slideContainer.querySelector('div[style*="border-radius: 50%"]') as HTMLElement
      if (!handle) throw new Error('Missing slider handle')

      fireEvent.touchStart(handle, { touches: [{ clientX: 0 }] })
      fireEvent.touchMove(handle, { touches: [{ clientX: 1000 }] })
      fireEvent.touchEnd(handle)

      await waitFor(() => expect(mockCreateCheckout).toHaveBeenCalled())

      expect(mockCreateCheckout).toHaveBeenCalledWith(expect.objectContaining({
        creatorUsername: 'testcreator',
        payerCountry: 'US', // From detectPayerCountry mock
      }))
      expect((window as any).location.href).toBe('https://checkout.example.com')
    })
  })

  describe('Session verification', () => {
    it('verifies Stripe session on success return', async () => {
      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator?success=true&session_id=cs_test_123',
        routePath: '/:username',
      })

      await waitFor(() => {
        expect(api.checkout.verifySession).toHaveBeenCalledWith('cs_test_123', 'testcreator')
      })
    })

    it('verifies Paystack reference on success return', async () => {
      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator?success=true&reference=pay_ref_123',
        routePath: '/:username',
      })

      await waitFor(() => {
        expect(api.checkout.verifyPaystack).toHaveBeenCalledWith('pay_ref_123', 'testcreator')
      })
    })
  })

  describe('Geo detection', () => {
    it('calls detectPayerCountry for geo-based provider selection', async () => {
      // Import the mocked function to verify it was called
      const { detectPayerCountry } = await import('../api/client')

      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      await waitFor(() => {
        // Should call server-side geo detection
        expect(detectPayerCountry).toHaveBeenCalled()
      })
    })
  })

  describe('Payment readiness', () => {
    it('shows unavailable message when payments not ready', async () => {
      renderWithProviders(
        <SubscribeBoundary profile={{ ...mockProfile, payoutStatus: 'pending', paymentsReady: false }} />,
        { route: '/testcreator', routePath: '/:username' }
      )

      await waitFor(() => {
        // Should show unavailable state instead of slide button
        expect(screen.getByText('Payments Unavailable')).toBeInTheDocument()
      })
    })

    it('shows payment form when payments are ready', async () => {
      renderWithProviders(
        <SubscribeBoundary profile={mockProfile} />,
        { route: '/testcreator', routePath: '/:username' }
      )

      await waitFor(() => {
        // Should show slide to pay button
        expect(screen.getByText('Slide to Pay')).toBeInTheDocument()
      })
    })
  })

  describe('Service vs Support mode', () => {
    it('shows banner for service mode', async () => {
      renderWithProviders(
        <SubscribeBoundary profile={{ ...mockProfile, purpose: 'service' }} />,
        { route: '/testcreator', routePath: '/:username' }
      )

      await waitFor(() => {
        // Service mode shows banner (180px height container)
        const banner = document.querySelector('div[style*="height: 180px"]')
        expect(banner).toBeInTheDocument()
      })
    })

    it('shows small avatar for support mode', async () => {
      renderWithProviders(
        <SubscribeBoundary profile={mockProfile} />,
        { route: '/testcreator', routePath: '/:username' }
      )

      await waitFor(() => {
        // Support mode shows small avatar (64px)
        const avatar = document.querySelector('div[style*="width: 64px"]')
        expect(avatar).toBeInTheDocument()
      })
    })
  })
})
