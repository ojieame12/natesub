/**
 * UI Tests for ActivityDetail FX Pending behavior
 *
 * Tests:
 * - "Fetching exchange rate..." card appears when fxPending=true and fxData=null
 * - Card disappears when fxData is present
 * - Card disappears when fxPending=false
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ActivityDetail from './ActivityDetail'

// Mock the API hooks
const mockRefetch = vi.fn()
const mockUseActivityDetail = vi.fn()
const mockUseCurrentUser = vi.fn()

vi.mock('./api/hooks', () => ({
  useActivityDetail: (id: string) => mockUseActivityDetail(id),
  useCurrentUser: () => mockUseCurrentUser(),
}))

// Mock useSafeBack hook
vi.mock('./hooks', () => ({
  useSafeBack: () => vi.fn(),
}))

// Mock Toast
vi.mock('./components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components')>()
  return {
    ...actual,
    useToast: () => ({ show: vi.fn() }),
  }
})

// Helper to render with providers
function renderActivityDetail(activityId: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/activity/${activityId}`]}>
        <Routes>
          <Route path="/activity/:id" element={<ActivityDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

// Base mock data
const baseActivity = {
  id: 'act_123',
  type: 'payment_received',
  createdAt: new Date().toISOString(),
  payload: {
    amount: 1000,
    currency: 'USD',
    subscriberName: 'Test User',
    subscriberEmail: 'test@example.com',
  },
}

const baseFxData = {
  originalCurrency: 'USD',
  originalAmountCents: 1000,
  payoutCurrency: 'NGN',
  payoutAmountCents: 1550000,
  exchangeRate: 1550,
}

describe('ActivityDetail FX Pending UI', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock for current user
    mockUseCurrentUser.mockReturnValue({
      data: {
        id: 'user_123',
        profile: { currency: 'USD', purpose: 'creator' },
      },
    })
  })

  it('shows "Fetching exchange rate..." when fxPending=true and fxData=null', () => {
    mockUseActivityDetail.mockReturnValue({
      data: {
        activity: baseActivity,
        payoutInfo: null,
        fxData: null,
        fxPending: true,
      },
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    })

    renderActivityDetail('act_123')

    expect(screen.getByText('Fetching exchange rate...')).toBeInTheDocument()
    expect(screen.getByText('CONVERSION')).toBeInTheDocument()
  })

  it('does not show pending card when fxPending=false', () => {
    mockUseActivityDetail.mockReturnValue({
      data: {
        activity: baseActivity,
        payoutInfo: null,
        fxData: null,
        fxPending: false,
      },
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    })

    renderActivityDetail('act_123')

    expect(screen.queryByText('Fetching exchange rate...')).not.toBeInTheDocument()
  })

  it('does not show pending card when fxData is present (even if fxPending=true)', () => {
    mockUseActivityDetail.mockReturnValue({
      data: {
        activity: baseActivity,
        payoutInfo: null,
        fxData: baseFxData,
        fxPending: true, // Even if still true, fxData takes precedence
      },
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    })

    renderActivityDetail('act_123')

    expect(screen.queryByText('Fetching exchange rate...')).not.toBeInTheDocument()
    // Should show the actual FX conversion label instead
    expect(screen.getByText('CONVERSION')).toBeInTheDocument()
  })

  it('shows FX conversion data when fxData is present', () => {
    mockUseActivityDetail.mockReturnValue({
      data: {
        activity: baseActivity,
        payoutInfo: null,
        fxData: baseFxData,
        fxPending: false,
      },
      isLoading: false,
      isError: false,
      refetch: mockRefetch,
    })

    renderActivityDetail('act_123')

    // Should show CONVERSION card with FX data
    expect(screen.getByText('CONVERSION')).toBeInTheDocument()
    // Should show payout currency
    expect(screen.getByText(/NGN/)).toBeInTheDocument()
  })

  it('shows loading state when isLoading=true', () => {
    mockUseActivityDetail.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: mockRefetch,
    })

    renderActivityDetail('act_123')

    // Should not show the pending card during initial load
    expect(screen.queryByText('Fetching exchange rate...')).not.toBeInTheDocument()
  })

  it('shows error state when isError=true', () => {
    mockUseActivityDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mockRefetch,
    })

    renderActivityDetail('act_123')

    // Should show error state
    expect(screen.getByText(/try again/i)).toBeInTheDocument()
  })
})
