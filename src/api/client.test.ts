import { describe, expect, it, vi } from 'vitest'
import { Capacitor } from '@capacitor/core'
import {
  AUTH_ERROR_EVENT,
  api,
  clearAuthSession,
  clearAuthToken,
  getAuthToken,
  hasAuthSession,
  setAuthSession,
  setAuthToken,
} from './client'

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('api/client', () => {
  it('stores and clears auth token + session flag', () => {
    expect(getAuthToken()).toBe(null)
    expect(hasAuthSession()).toBe(false)

    setAuthToken('token-123')
    expect(getAuthToken()).toBe('token-123')
    expect(hasAuthSession()).toBe(true)

    clearAuthToken()
    expect(getAuthToken()).toBe(null)
    expect(hasAuthSession()).toBe(false)
  })

  it('stores and clears cookie-session flag (no token)', () => {
    expect(hasAuthSession()).toBe(false)
    setAuthSession()
    expect(hasAuthSession()).toBe(true)
    expect(getAuthToken()).toBe(null)
    clearAuthSession()
    expect(hasAuthSession()).toBe(false)
  })

  it('auth.verify prefers cookie-based auth on web when /auth/me succeeds', async () => {
    // Seed a stale token to ensure verify clears it first.
    setAuthToken('stale')

    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      if (url.toString().endsWith('/auth/verify')) {
        // Verify request should not include Authorization (token cleared)
        const authHeader = (options?.headers as any)?.Authorization
        expect(authHeader).toBeUndefined()
        expect(options?.credentials).toBe('include')
        return jsonResponse({
          success: true,
          token: 'new-token',
          hasProfile: false,
          hasActivePayment: false,
          onboardingStep: null,
          onboardingBranch: null,
          onboardingData: null,
          redirectTo: '/onboarding',
        })
      }

      if (url.toString().endsWith('/auth/me')) {
        // Cookie-auth probe
        expect(options?.credentials).toBe('include')
        return jsonResponse({ ok: true }, { status: 200 })
      }

      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const result = await api.auth.verify('123456', 'test@example.com')
    expect(result.success).toBe(true)
    expect(getAuthToken()).toBe(null)
    expect(hasAuthSession()).toBe(true)
  })

  it('auth.verify falls back to bearer token on web when cookie auth fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.toString().endsWith('/auth/verify')) {
        return jsonResponse({
          success: true,
          token: 'new-token',
          hasProfile: false,
          hasActivePayment: false,
          onboardingStep: null,
          onboardingBranch: null,
          onboardingData: null,
          redirectTo: '/onboarding',
        })
      }
      if (url.toString().endsWith('/auth/me')) {
        return jsonResponse({ ok: false }, { status: 401 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const result = await api.auth.verify('123456', 'test@example.com')
    expect(result.success).toBe(true)
    expect(getAuthToken()).toBe('new-token')
    expect(hasAuthSession()).toBe(true)
  })

  it('auth.verify stores bearer token on native platforms', async () => {
    ;(Capacitor.isNativePlatform as any).mockReturnValue(true)

    const fetchMock = vi.fn(async (url: string) => {
      if (url.toString().endsWith('/auth/verify')) {
        return jsonResponse({
          success: true,
          token: 'native-token',
          hasProfile: false,
          hasActivePayment: false,
          onboardingStep: null,
          onboardingBranch: null,
          onboardingData: null,
          redirectTo: '/onboarding',
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock as any)

    await api.auth.verify('123456', 'test@example.com')
    expect(getAuthToken()).toBe('native-token')
    expect(hasAuthSession()).toBe(true)

    ;(Capacitor.isNativePlatform as any).mockReturnValue(false)
  })

  it('clears auth and dispatches auth error event on protected 401s', async () => {
    setAuthToken('token-123')

    const onAuthError = vi.fn()
    window.addEventListener(AUTH_ERROR_EVENT, onAuthError)

    const fetchMock = vi.fn(async (url: string) => {
      if (url.toString().endsWith('/profile')) {
        return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock as any)

    await expect(api.profile.get()).rejects.toMatchObject({ status: 401 })
    expect(getAuthToken()).toBe(null)
    expect(hasAuthSession()).toBe(false)
    expect(onAuthError).toHaveBeenCalledTimes(1)

    window.removeEventListener(AUTH_ERROR_EVENT, onAuthError)
  })

  it('does not clear auth on public endpoint 401s', async () => {
    setAuthToken('token-123')

    const onAuthError = vi.fn()
    window.addEventListener(AUTH_ERROR_EVENT, onAuthError)

    const fetchMock = vi.fn(async (url: string) => {
      if (url.toString().includes('/users/alice')) {
        return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock as any)

    await expect(api.users.getByUsername('alice')).rejects.toMatchObject({ status: 401 })
    expect(getAuthToken()).toBe('token-123')
    expect(hasAuthSession()).toBe(true)
    expect(onAuthError).not.toHaveBeenCalled()

    window.removeEventListener(AUTH_ERROR_EVENT, onAuthError)
  })

  it('includes Authorization header when token exists', async () => {
    setAuthToken('token-abc')

    const fetchMock = vi.fn(async (_url: string, options?: RequestInit) => {
      const headers = options?.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer token-abc')
      return jsonResponse({ profile: null })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    await api.profile.get()
  })
})
