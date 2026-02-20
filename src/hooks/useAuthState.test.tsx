import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { api, hasAuthSession, setAuthSession, setAuthToken } from '../api/client'
import { createTestQueryClient } from '../test/testUtils'
import { useAuthState } from './useAuthState'

describe('hooks/useAuthState', () => {
  it('returns unauthenticated when no token/session is present', () => {
    const meSpy = vi.spyOn(api.auth, 'me')
    const queryClient = createTestQueryClient()

    const { result } = renderHook(() => useAuthState(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })

    expect(result.current.status).toBe('unauthenticated')
    expect(result.current.isReady).toBe(true)
    expect(result.current.user).toBe(null)
    expect(meSpy).not.toHaveBeenCalled()
  })

  it('returns authenticated and derived flags when session is valid', async () => {
    setAuthToken('token')

    vi.spyOn(api.auth, 'me').mockResolvedValue({
      id: 'u1',
      email: 'test@example.com',
      profile: { id: 'p1' },
      createdAt: '2025-01-01T00:00:00.000Z',
      onboarding: {
        hasProfile: true,
        hasActivePayment: false,
        step: 5,
        branch: 'service',
        data: { name: 'Alice' },
        redirectTo: '/settings/payments',
      },
    } as any)

    const queryClient = createTestQueryClient()

    const { result } = renderHook(() => useAuthState(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })

    await waitFor(() => expect(result.current.status).toBe('authenticated'))
    expect(result.current.needsPaymentSetup).toBe(true)
    expect(result.current.needsLaunch).toBe(false)
    expect(result.current.needsOnboarding).toBe(false)
    expect(result.current.isFullySetUp).toBe(false)
    expect(result.current.onboarding?.branch).toBe('service')
  })

  it('marks private creators as needing launch even with active payments', async () => {
    setAuthToken('token')

    vi.spyOn(api.auth, 'me').mockResolvedValue({
      id: 'u2',
      email: 'creator@example.com',
      profile: { id: 'p2', isPublic: false },
      createdAt: '2025-01-01T00:00:00.000Z',
      onboarding: {
        hasProfile: true,
        hasActivePayment: true,
        step: null,
        branch: null,
        data: null,
        redirectTo: '/edit-page?launch=1',
      },
    } as any)

    const queryClient = createTestQueryClient()

    const { result } = renderHook(() => useAuthState(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })

    await waitFor(() => expect(result.current.status).toBe('authenticated'))
    expect(result.current.needsLaunch).toBe(true)
    expect(result.current.isFullySetUp).toBe(false)
    expect(result.current.needsPaymentSetup).toBe(false)
  })

  it('clears cookie-session flag and becomes unauthenticated on 401', async () => {
    setAuthSession()
    expect(hasAuthSession()).toBe(true)

    vi.spyOn(api.auth, 'me').mockRejectedValue({ status: 401, error: 'Unauthorized' })

    const queryClient = createTestQueryClient()
    const { result, rerender } = renderHook(() => useAuthState(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })

    // Session flag is cleared inside the query retry handler on 401.
    await waitFor(() => expect(hasAuthSession()).toBe(false), { timeout: 3000 })

    // Force a re-render to re-read localStorage and compute shouldCheckAuth again.
    rerender()

    await waitFor(() => expect(result.current.status).toBe('unauthenticated'))
    expect(hasAuthSession()).toBe(false)
  })

  it('surfaces an error state after retries for server/network errors', async () => {
    vi.useFakeTimers()
    setAuthToken('token')

    vi.spyOn(api.auth, 'me').mockRejectedValue({ status: 500, error: 'Server error' })

    const queryClient = createTestQueryClient()
    const { result } = renderHook(() => useAuthState(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    })

    // Drive react-query retry delays (1s, then 2s) to exhaustion (plus a buffer).
    await vi.advanceTimersByTimeAsync(5000)

    // Allow state updates to flush after retries complete.
    await Promise.resolve()
    await Promise.resolve()

    // Switch back to real timers for waitFor polling.
    vi.useRealTimers()

    await waitFor(() => expect(result.current.status).toBe('error'), { timeout: 3000 })
    expect(result.current.isReady).toBe(true)
  })
})
