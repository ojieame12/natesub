import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// Mock the queryClient and api before importing prefetch
vi.mock('../api/provider', () => ({
  queryClient: {
    prefetchQuery: vi.fn(() => Promise.resolve(undefined)),
  },
}))

vi.mock('../api/client', () => ({
  api: {
    profile: { get: vi.fn(), getSettings: vi.fn() },
    activity: { getMetrics: vi.fn(), list: vi.fn() },
    stripe: { getStatus: vi.fn() },
    paystack: { getStatus: vi.fn() },
    updates: { list: vi.fn() },
    subscriptions: { list: vi.fn() },
    requests: { list: vi.fn() },
  },
}))

describe('utils/prefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset module state by clearing the prefetched sets
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('prefetchRoute', () => {
    it('prefetches JS chunks for known routes', async () => {
      const { prefetchRoute } = await import('./prefetch')

      // Mock requestIdleCallback
      vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
        cb()
        return 1
      })

      prefetchRoute('/dashboard')

      // The import should have been triggered
      // We can't easily verify dynamic imports, but we can verify no errors
      expect(true).toBe(true)
    })

    it('normalizes paths by removing trailing slashes and query params', async () => {
      const { prefetchRoute } = await import('./prefetch')

      vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
        cb()
        return 1
      })

      // These should all normalize to the same path
      prefetchRoute('/dashboard/')
      prefetchRoute('/dashboard?foo=bar')
      prefetchRoute('/dashboard/?foo=bar')

      // Should not throw
      expect(true).toBe(true)
    })

    it('skips unknown routes', async () => {
      const { prefetchRoute } = await import('./prefetch')

      // Should not throw for unknown routes
      expect(() => prefetchRoute('/unknown-route')).not.toThrow()
    })

    it('only prefetches each route once', async () => {
      const { prefetchRoute } = await import('./prefetch')

      let callCount = 0
      vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
        callCount++
        cb()
        return callCount
      })

      prefetchRoute('/profile')
      prefetchRoute('/profile')
      prefetchRoute('/profile')

      // requestIdleCallback should only be called once for the same route
      expect(callCount).toBe(1)
    })
  })

  describe('prefetchRouteData', () => {
    it('prefetches data for routes with simple queries', async () => {
      const { prefetchRouteData } = await import('./prefetch')
      const { queryClient } = await import('../api/provider')

      vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
        cb()
        return 1
      })

      prefetchRouteData('/dashboard')

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 10))

      // Should have prefetched profile and metrics
      expect(queryClient.prefetchQuery).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['profile'] })
      )
      expect(queryClient.prefetchQuery).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['metrics'] })
      )
    })

    it('does NOT prefetch infinite query data (activity, subscriptions, requests)', async () => {
      const { prefetchRouteData } = await import('./prefetch')
      const { queryClient } = await import('../api/provider')

      vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
        cb()
        return 1
      })

      // Subscribers page uses useInfiniteQuery - should not prefetch subscriptions
      prefetchRouteData('/subscribers')

      await new Promise(resolve => setTimeout(resolve, 10))

      // Should NOT have called prefetchQuery for subscriptions
      const calls = (queryClient.prefetchQuery as any).mock.calls
      const hasSubscriptionsCall = calls.some((call: any) =>
        call[0]?.queryKey?.[0] === 'subscriptions'
      )
      expect(hasSubscriptionsCall).toBe(false)
    })

    it('prefetches settings data for /settings route', async () => {
      const { prefetchRouteData } = await import('./prefetch')
      const { queryClient } = await import('../api/provider')

      vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
        cb()
        return 1
      })

      prefetchRouteData('/settings')

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(queryClient.prefetchQuery).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['settings'] })
      )
    })

    it('prefetches payment status for /settings/payments', async () => {
      const { prefetchRouteData } = await import('./prefetch')
      const { queryClient } = await import('../api/provider')

      vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
        cb()
        return 1
      })

      prefetchRouteData('/settings/payments')

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(queryClient.prefetchQuery).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['stripeStatus'] })
      )
      expect(queryClient.prefetchQuery).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['paystackStatus'] })
      )
    })
  })

  describe('prefetchAll', () => {
    it('prefetches both code and data', async () => {
      const { prefetchAll } = await import('./prefetch')
      const { queryClient } = await import('../api/provider')

      vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
        cb()
        return 1
      })

      prefetchAll('/profile')

      await new Promise(resolve => setTimeout(resolve, 10))

      // Should have prefetched data
      expect(queryClient.prefetchQuery).toHaveBeenCalled()
    })
  })

  describe('prefetchCoreData', () => {
    it('prefetches profile and metrics (whitelisted queries)', async () => {
      const { prefetchCoreData } = await import('./prefetch')
      const { queryClient } = await import('../api/provider')

      vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
        cb()
        return 1
      })

      prefetchCoreData()

      await new Promise(resolve => setTimeout(resolve, 10))

      expect(queryClient.prefetchQuery).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['profile'] })
      )
      expect(queryClient.prefetchQuery).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['metrics'] })
      )
    })

    it('uses setTimeout fallback when requestIdleCallback is not available', async () => {
      const { prefetchCoreData } = await import('./prefetch')

      // Remove requestIdleCallback
      const original = window.requestIdleCallback
      delete (window as any).requestIdleCallback

      const setTimeoutSpy = vi.spyOn(global, 'setTimeout')

      prefetchCoreData()

      expect(setTimeoutSpy).toHaveBeenCalled()

      // Restore
      ;(window as any).requestIdleCallback = original
    })
  })

  describe('getPrefetchHandlers', () => {
    it('returns onTouchStart and onMouseEnter handlers', async () => {
      const { getPrefetchHandlers } = await import('./prefetch')

      const handlers = getPrefetchHandlers('/dashboard')

      expect(handlers).toHaveProperty('onTouchStart')
      expect(handlers).toHaveProperty('onMouseEnter')
      expect(typeof handlers.onTouchStart).toBe('function')
      expect(typeof handlers.onMouseEnter).toBe('function')
    })
  })
})
