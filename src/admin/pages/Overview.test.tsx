import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import Overview from './Overview'

const mockDashboard = {
  users: { total: 100, newToday: 5, newThisMonth: 50 },
  subscriptions: { active: 25 },
  revenue: {
    totalCents: 10000,
    thisMonthCents: 1000,
    totalVolumeCents: 100000,
    thisMonthVolumeCents: 10000,
    paymentCount: 50,
    thisMonthPaymentCount: 5
  },
  flags: { disputedPayments: 0, failedPaymentsToday: 0 },
  freshness: {
    businessTimezone: 'UTC',
    lastPaymentAt: new Date().toISOString(),
    lastWebhookProcessedAt: null,
    lastWebhookProvider: null
  }
}

const mockActivity = {
  activities: [
    { id: '1', message: 'Test action', adminEmail: 'admin@test.com', createdAt: new Date().toISOString() }
  ],
  total: 1,
  page: 1,
  totalPages: 1
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

describe('Overview', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = vi.fn()
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  it('displays freshness from dashboard data', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/admin/dashboard')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockDashboard)
        })
      }
      if (url.includes('/admin/activity')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockActivity)
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(<Overview />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText(/Last payment:/)).toBeInTheDocument()
    })
  })

  it('shows skeletons while loading', () => {
    mockFetch.mockImplementation(() => new Promise(() => {})) // Never resolves

    const { container } = render(<Overview />, { wrapper: createWrapper() })

    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
  })

  it('displays KPI values from dashboard', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/admin/dashboard')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockDashboard)
        })
      }
      if (url.includes('/admin/activity')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockActivity)
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(<Overview />, { wrapper: createWrapper() })

    await waitFor(() => {
      // Users
      expect(screen.getByText('100')).toBeInTheDocument()
      // Active subscriptions
      expect(screen.getByText('25')).toBeInTheDocument()
    })
  })

  it('shows error state on API failure', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/admin/dashboard')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: 'Server error' })
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(<Overview />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText(/Failed to load dashboard data/)).toBeInTheDocument()
    })
  })

  it('only makes 2 API calls (dashboard + activity)', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('/admin/dashboard')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockDashboard)
        })
      }
      if (url.includes('/admin/activity')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockActivity)
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    })

    render(<Overview />, { wrapper: createWrapper() })

    await waitFor(() => {
      expect(screen.getByText('100')).toBeInTheDocument()
    })

    // Verify only 2 API calls were made
    const calls = mockFetch.mock.calls.map((call: unknown[]) => call[0] as string)
    const dashboardCalls = calls.filter((url: string) => url.includes('/admin/dashboard'))
    const activityCalls = calls.filter((url: string) => url.includes('/admin/activity'))
    const revenueCalls = calls.filter((url: string) => url.includes('/admin/revenue'))

    expect(dashboardCalls.length).toBe(1)
    expect(activityCalls.length).toBe(1)
    expect(revenueCalls.length).toBe(0) // Should NOT call revenue endpoint
  })
})
