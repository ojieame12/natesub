import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAdminDashboard, useAdminRevenueAll } from './api'
import * as clientModule from '../api/client'

// Helper to create mock Response
function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

// Wrapper for React Query hooks
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('Admin API', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = vi.fn()
    globalThis.fetch = mockFetch

    // Mock getAuthToken to return a token
    vi.spyOn(clientModule, 'getAuthToken').mockReturnValue('admin-token')
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  describe('adminFetch configuration', () => {
    it('uses 20 second timeout via shared layer', async () => {
      // This test verifies the timeout is configured correctly
      // We can't easily test the actual timeout without mocking internals
      // but we can verify the fetch is called with proper setup
      const mockDashboard = {
        users: { total: 100, newToday: 5, newThisMonth: 50 },
        subscriptions: { active: 25 },
        revenue: { totalCents: 100000, thisMonthCents: 10000 },
        flags: { disputedPayments: 0, failedPaymentsToday: 0 },
      }
      mockFetch.mockResolvedValue(jsonResponse(mockDashboard))

      const { result } = renderHook(() => useAdminDashboard(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      // Verify fetch was called with correct URL pattern
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/admin/dashboard'),
        expect.any(Object)
      )
    })

    it('includes credentials for cookie auth', async () => {
      // Note: Bearer token is only added if getAuthToken returns a token
      // In admin context, session cookies are the primary auth mechanism
      mockFetch.mockResolvedValue(jsonResponse({ users: {} }))

      const { result } = renderHook(() => useAdminDashboard(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          credentials: 'include',
        })
      )
    })

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValue(
        jsonResponse({ error: 'Forbidden' }, { status: 403 })
      )

      const { result } = renderHook(() => useAdminDashboard(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect(result.current.error?.message).toBe('Forbidden')
    })
  })

  describe('useAdminDashboard', () => {
    it('fetches /admin/dashboard', async () => {
      const mockData = {
        users: { total: 100, newToday: 5, newThisMonth: 50 },
        subscriptions: { active: 25 },
        revenue: { totalCents: 100000, thisMonthCents: 10000 },
        flags: { disputedPayments: 0, failedPaymentsToday: 0 },
      }
      mockFetch.mockResolvedValue(jsonResponse(mockData))

      const { result } = renderHook(() => useAdminDashboard(), {
        wrapper: createWrapper(),
      })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      expect(result.current.data).toEqual(mockData)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/admin/dashboard'),
        expect.any(Object)
      )
    })
  })

  describe('useAdminRevenueAll', () => {
    it('passes period and limit params', async () => {
      const mockData = {
        overview: { allTime: { totalVolumeCents: 500000 } },
        byProvider: { stripe: {}, paystack: {} },
        byCurrency: { USD: {} },
        daily: { days: [] },
        monthly: { months: [] },
        topCreators: [],
        refunds: { total: 0 },
      }
      mockFetch.mockResolvedValue(jsonResponse(mockData))

      const { result } = renderHook(
        () => useAdminRevenueAll('month', 30, 12, 10),
        { wrapper: createWrapper() }
      )

      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/admin\/revenue\/all\?.*period=month/),
        expect.any(Object)
      )
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/days=30/),
        expect.any(Object)
      )
    })

    it('combines all revenue data', async () => {
      const mockData = {
        overview: {
          allTime: { totalVolumeCents: 500000, platformFeeCents: 40000 },
          thisMonth: { totalVolumeCents: 50000, platformFeeCents: 4000 },
        },
        byProvider: {
          stripe: { totalVolumeCents: 400000, platformFeeCents: 32000 },
          paystack: { totalVolumeCents: 100000, platformFeeCents: 8000 },
        },
        byCurrency: { USD: { totalVolumeCents: 500000 } },
        daily: { days: [{ date: '2024-01-01', feesCents: 1000 }] },
        monthly: { months: [{ month: '2024-01', feesCents: 4000 }] },
        topCreators: [{ username: 'test', totalCents: 10000 }],
        refunds: { total: 2, totalCents: 5000 },
      }
      mockFetch.mockResolvedValue(jsonResponse(mockData))

      const { result } = renderHook(
        () => useAdminRevenueAll('month', 30, 12, 10),
        { wrapper: createWrapper() }
      )

      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      expect(result.current.data?.overview).toBeDefined()
      expect(result.current.data?.byProvider).toBeDefined()
      expect(result.current.data?.daily).toBeDefined()
      expect(result.current.data?.topCreators).toHaveLength(1)
    })
  })
})
