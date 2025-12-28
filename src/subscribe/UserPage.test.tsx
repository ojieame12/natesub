import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, cleanup } from '@testing-library/react'
import { renderWithProviders } from '../test/testUtils'
import UserPage from './UserPage'

// Mock fetch for IP detection (ipapi.co/country/)
const mockFetch = vi.fn(() =>
  Promise.resolve({
    text: () => Promise.resolve('US'),
    ok: true,
  } as Response)
)
vi.stubGlobal('fetch', mockFetch)

// Mock api.checkout.verifySession
vi.mock('../api/client', () => ({
  checkout: {
    verifySession: vi.fn(() => Promise.resolve({ verified: true })),
  },
}))

// Mock the template components to avoid their complex async effects
vi.mock('./SubscribeBoundary', () => ({
  default: ({ profile }: { profile: { displayName: string } }) => (
    <div data-testid="subscribe-boundary">
      <span>{profile.displayName}</span>
    </div>
  ),
}))

vi.mock('./AlreadySubscribed', () => ({
  default: ({ profile }: { profile: { displayName: string } }) => (
    <div data-testid="already-subscribed">
      <span>You're subscribed!</span>
      <span>{profile.displayName}</span>
    </div>
  ),
}))

// Mock hooks used by UserPage
vi.mock('../api/hooks', () => ({
  usePublicProfile: vi.fn(),
  useCreateCheckout: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useRecordPageView: vi.fn(() => ({
    mutateAsync: vi.fn(),
  })),
  useUpdatePageView: vi.fn(() => ({
    mutateAsync: vi.fn(),
  })),
  useUpdateSettings: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}))

import { usePublicProfile } from '../api/hooks'

const mockUsePublicProfile = vi.mocked(usePublicProfile)

// Sample profile data
const mockProfile = {
  id: 'profile-123',
  username: 'testuser',
  displayName: 'Test User',
  description: 'Test description',
  avatarUrl: null,
  country: 'United States',
  countryCode: 'US',
  currency: 'USD',
  pricingModel: 'single' as const,
  singleAmount: 1000,
  template: 'boundary' as const,
  purpose: 'tips' as const,
}

describe('UserPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock sessionStorage for IP caching
    const mockStorage: Record<string, string> = {}
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, value: string) => { mockStorage[key] = value },
      removeItem: (key: string) => { delete mockStorage[key] },
      clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]) },
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  describe('Loading state', () => {
    it('shows minimal loading state', () => {
      mockUsePublicProfile.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
        refetch: vi.fn(),
      } as any)

      renderWithProviders(<UserPage />, {
        route: '/testuser',
        routePath: '/:username',
      })

      // Loading state is just a gradient background div with min-height
      const container = document.querySelector('[style*="100dvh"]')
      expect(container).toBeTruthy()
    })
  })

  describe('Error states', () => {
    it('shows 403 private profile error', () => {
      mockUsePublicProfile.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: { status: 403 },
        refetch: vi.fn(),
      } as any)

      renderWithProviders(<UserPage />, {
        route: '/testuser',
        routePath: '/:username',
      })

      expect(screen.getByText('Private Profile')).toBeInTheDocument()
      expect(screen.getByText(/@testuser has made their page private/i)).toBeInTheDocument()
    })

    it('shows 429 rate limit error with retry button', () => {
      const refetch = vi.fn()
      mockUsePublicProfile.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: { status: 429 },
        refetch,
      } as any)

      renderWithProviders(<UserPage />, {
        route: '/testuser',
        routePath: '/:username',
      })

      expect(screen.getByText('Too Many Requests')).toBeInTheDocument()
      expect(screen.getByText(/Please wait a moment/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    })

    it('shows 500+ server error with retry button', () => {
      mockUsePublicProfile.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: { status: 500 },
        refetch: vi.fn(),
      } as any)

      renderWithProviders(<UserPage />, {
        route: '/testuser',
        routePath: '/:username',
      })

      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    })

    it('shows 404 not found for unknown errors', () => {
      mockUsePublicProfile.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: { status: 404 },
        refetch: vi.fn(),
      } as any)

      renderWithProviders(<UserPage />, {
        route: '/unknownuser',
        routePath: '/:username',
      })

      expect(screen.getByText('Page not found')).toBeInTheDocument()
      expect(screen.getByText(/doesn't exist/i)).toBeInTheDocument()
    })
  })

  describe('Reserved usernames', () => {
    it('redirects to onboarding for reserved username', () => {
      mockUsePublicProfile.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as any)

      renderWithProviders(<UserPage />, {
        route: '/settings',
        routePath: '/:username',
      })

      // Reserved username redirects to /onboarding
      // In tests, Navigate component renders null but routes change
      // We check the route doesn't render the error pages
      expect(screen.queryByText('Page not found')).not.toBeInTheDocument()
    })
  })

  describe('Successful profile load', () => {
    it('renders profile template for public visitor', () => {
      mockUsePublicProfile.mockReturnValue({
        data: {
          profile: mockProfile,
          isOwner: false,
          viewerSubscription: null,
        },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as any)

      renderWithProviders(<UserPage />, {
        route: '/testuser',
        routePath: '/:username',
      })

      // Profile loaded successfully - SubscribeBoundary should render
      expect(screen.getByTestId('subscribe-boundary')).toBeInTheDocument()
      expect(screen.getByText('Test User')).toBeInTheDocument()
    })

    it('shows owner view when user visits their own page', () => {
      mockUsePublicProfile.mockReturnValue({
        data: {
          profile: mockProfile,
          isOwner: true,
          viewerSubscription: null,
        },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as any)

      renderWithProviders(<UserPage />, {
        route: '/testuser',
        routePath: '/:username',
      })

      // Owner view renders (still shows template, owner flag handled by template)
      expect(screen.getByTestId('subscribe-boundary')).toBeInTheDocument()
      expect(screen.getByText('Test User')).toBeInTheDocument()
    })

    it('shows already subscribed view for active subscribers', () => {
      mockUsePublicProfile.mockReturnValue({
        data: {
          profile: mockProfile,
          isOwner: false,
          viewerSubscription: {
            isActive: true,
            since: new Date().toISOString(),
            amount: 1000,
            currency: 'USD',
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          },
        },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as any)

      renderWithProviders(<UserPage />, {
        route: '/testuser',
        routePath: '/:username',
      })

      // AlreadySubscribed component should render
      expect(screen.getByTestId('already-subscribed')).toBeInTheDocument()
      expect(screen.getByText("You're subscribed!")).toBeInTheDocument()
    })

  })

  describe('Query params', () => {
    it('handles success query param', () => {
      mockUsePublicProfile.mockReturnValue({
        data: {
          profile: mockProfile,
          isOwner: false,
          viewerSubscription: null,
        },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as any)

      renderWithProviders(<UserPage />, {
        route: '/testuser?success=true',
        routePath: '/:username',
      })

      // Boundary template handles its own success state
      expect(screen.getByTestId('subscribe-boundary')).toBeInTheDocument()
      expect(screen.getByText('Test User')).toBeInTheDocument()
    })

    it('handles canceled query param', () => {
      mockUsePublicProfile.mockReturnValue({
        data: {
          profile: mockProfile,
          isOwner: false,
          viewerSubscription: null,
        },
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as any)

      renderWithProviders(<UserPage />, {
        route: '/testuser?canceled=true',
        routePath: '/:username',
      })

      // Profile should still render
      expect(screen.getByTestId('subscribe-boundary')).toBeInTheDocument()
      expect(screen.getByText('Test User')).toBeInTheDocument()
    })
  })
})
