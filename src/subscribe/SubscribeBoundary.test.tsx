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
}))

// Mock api.checkout.verifySession
vi.mock('../api/client', () => ({
  checkout: {
    verifySession: vi.fn(() => Promise.resolve({ verified: true })),
    verifyPaystack: vi.fn(() => Promise.resolve({ verified: true })),
  },
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
    it('renders profile information correctly', async () => {
      vi.useFakeTimers()

      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      // Advance timers for mount animation
      await vi.advanceTimersByTimeAsync(100)

      expect(screen.getByText('TEST CREATOR')).toBeInTheDocument()
      expect(screen.getByText('TIPS')).toBeInTheDocument()
      expect(screen.getByText('$10.00/mo')).toBeInTheDocument()
    })

    it('shows SERVICE badge for service profiles', async () => {
      vi.useFakeTimers()

      renderWithProviders(
        <SubscribeBoundary profile={{ ...mockProfile, purpose: 'service' }} />,
        { route: '/testcreator', routePath: '/:username' }
      )

      await vi.advanceTimersByTimeAsync(100)

      expect(screen.getByText('SERVICE')).toBeInTheDocument()
    })

    it('shows secure payment fee with split model', async () => {
      vi.useFakeTimers()

      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      await vi.advanceTimersByTimeAsync(100)

      // Should show secure payment fee (subscriber's portion)
      expect(screen.getByText('Secure payment')).toBeInTheDocument()
    })
  })

  describe('Email validation', () => {
    it('disables slide to pay when email is too short', async () => {
      vi.useFakeTimers()

      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      await vi.advanceTimersByTimeAsync(100)

      const emailInput = screen.getByPlaceholderText('user@example.com')
      fireEvent.change(emailInput, { target: { value: 'ab' } })

      // Slide button should be disabled (cursor: not-allowed indicates disabled)
      const slideContainer = screen.getByText('SLIDE TO PAY').parentElement
      expect(slideContainer).toHaveStyle({ cursor: 'not-allowed' })
    })

    it('enables slide to pay when email is valid', async () => {
      vi.useFakeTimers()

      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      await vi.advanceTimersByTimeAsync(100)

      const emailInput = screen.getByPlaceholderText('user@example.com')
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } })

      // Slide button should be enabled (cursor: pointer indicates enabled)
      const slideContainer = screen.getByText('SLIDE TO PAY').parentElement
      expect(slideContainer).toHaveStyle({ cursor: 'pointer' })
    })
  })

  describe('Owner view', () => {
    it('shows edit page button for owner', async () => {
      vi.useFakeTimers()

      renderWithProviders(<SubscribeBoundary profile={mockProfile} isOwner />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      await vi.advanceTimersByTimeAsync(100)

      expect(screen.getByText('Edit Page')).toBeInTheDocument()
    })

    it('shows fee breakdown for owner', async () => {
      vi.useFakeTimers()

      renderWithProviders(<SubscribeBoundary profile={mockProfile} isOwner />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      await vi.advanceTimersByTimeAsync(100)

      // Owner should see subscription price and what they receive
      expect(screen.getByText('Subscription price')).toBeInTheDocument()
      expect(screen.getByText('You receive')).toBeInTheDocument()
      expect(screen.getByText('after 4% platform fee')).toBeInTheDocument()
    })

    it('does not record page view for owner', async () => {
      vi.useFakeTimers()

      renderWithProviders(<SubscribeBoundary profile={mockProfile} isOwner />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      await vi.advanceTimersByTimeAsync(200)

      // Page view should not be recorded for owner
      expect(mockRecordPageView).not.toHaveBeenCalled()
    })
  })

  describe('Page view analytics', () => {
    it('captures UTM parameters from URL', async () => {
      vi.useFakeTimers()

      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator?utm_source=twitter&utm_medium=social',
        routePath: '/:username',
      })

      // Component reads UTM params on mount
      await vi.advanceTimersByTimeAsync(200)

      // The component should have recorded a page view with UTM params
      // Note: The actual call happens in useEffect, we verify it was attempted
      expect(mockRecordPageView).toHaveBeenCalled()
    })
  })

  describe('Checkout flow', () => {
    it('shows slide to pay button with correct label', async () => {
      vi.useFakeTimers()

      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      await vi.advanceTimersByTimeAsync(100)

      expect(screen.getByText('SLIDE TO PAY')).toBeInTheDocument()
    })

    it('shows email input for subscriber', async () => {
      vi.useFakeTimers()

      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      await vi.advanceTimersByTimeAsync(100)

      expect(screen.getByPlaceholderText('user@example.com')).toBeInTheDocument()
    })

    it('passes cached payerCountry to createCheckout', async () => {
      sessionStorage.setItem('natepay_payer_country', 'NG')
      mockCreateCheckout.mockResolvedValueOnce({ url: 'https://checkout.example.com' })

      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      const emailInput = screen.getByPlaceholderText('user@example.com')
      fireEvent.change(emailInput, { target: { value: 'sub@example.com' } })

      const slideContainer = screen.getByText('SLIDE TO PAY').parentElement as HTMLElement
      if (!slideContainer) throw new Error('Missing slide container')

      vi.spyOn(slideContainer, 'getBoundingClientRect').mockReturnValue({
        width: 300,
        height: 48,
        top: 0,
        left: 0,
        right: 300,
        bottom: 48,
        x: 0,
        y: 0,
        toJSON: () => { },
      } as any)

      const thumb = slideContainer.querySelector('div[style*="cursor: grab"]') as HTMLElement | null
      if (!thumb) throw new Error('Missing slider thumb')

      fireEvent.touchStart(thumb, { touches: [{ clientX: 0 }] })
      fireEvent.touchMove(thumb, { touches: [{ clientX: 1000 }] })
      fireEvent.touchEnd(thumb)

      await waitFor(() => expect(mockCreateCheckout).toHaveBeenCalled())

      expect(mockCreateCheckout).toHaveBeenCalledWith(expect.objectContaining({
        creatorUsername: 'testcreator',
        payerCountry: 'NG',
      }))
      expect((window as any).location.href).toBe('https://checkout.example.com')
    })
  })

  describe('Session verification', () => {
    it('verifies Stripe session on success return', async () => {
      vi.useFakeTimers()

      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator?success=true&session_id=cs_test_123',
        routePath: '/:username',
      })

      await vi.advanceTimersByTimeAsync(200)

      expect(api.checkout.verifySession).toHaveBeenCalledWith('cs_test_123', 'testcreator')
    })

    it('verifies Paystack reference on success return', async () => {
      vi.useFakeTimers()

      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator?success=true&reference=pay_ref_123',
        routePath: '/:username',
      })

      await vi.advanceTimersByTimeAsync(200)

      expect(api.checkout.verifyPaystack).toHaveBeenCalledWith('pay_ref_123')
    })
  })

  describe('IP country detection', () => {
    it('uses cached country from sessionStorage when available', async () => {
      vi.useFakeTimers()

      // Pre-populate cache with country code
      const mockStorage: Record<string, string> = { natepay_payer_country: 'US' }
      vi.stubGlobal('sessionStorage', {
        getItem: (key: string) => mockStorage[key] || null,
        setItem: (key: string, value: string) => { mockStorage[key] = value },
        removeItem: (key: string) => { delete mockStorage[key] },
        clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]) },
      })

      mockFetch.mockClear()

      renderWithProviders(<SubscribeBoundary profile={mockProfile} />, {
        route: '/testcreator',
        routePath: '/:username',
      })

      await vi.advanceTimersByTimeAsync(200)

      // Should not fetch since value is cached
      expect(mockFetch).not.toHaveBeenCalledWith('https://ipapi.co/country/')
    })
  })

  describe('Payment readiness', () => {
    it('shows unavailable message when payments not ready', async () => {
      vi.useFakeTimers()

      renderWithProviders(
        <SubscribeBoundary profile={{ ...mockProfile, payoutStatus: 'pending', paymentsReady: false }} />,
        { route: '/testcreator', routePath: '/:username' }
      )

      await vi.advanceTimersByTimeAsync(100)

      // Should show unavailable state instead of slide button
      expect(screen.getByText('Payments Unavailable')).toBeInTheDocument()
    })

    it('shows payment form when payments are ready', async () => {
      vi.useFakeTimers()

      renderWithProviders(
        <SubscribeBoundary profile={mockProfile} />,
        { route: '/testcreator', routePath: '/:username' }
      )

      await vi.advanceTimersByTimeAsync(100)

      // Should show slide to pay button
      expect(screen.getByText('SLIDE TO PAY')).toBeInTheDocument()
    })
  })
})
