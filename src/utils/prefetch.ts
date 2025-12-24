/**
 * Route prefetching for lazy-loaded components AND data
 *
 * Triggers:
 * 1. Dynamic imports on touchstart/mouseenter to preload JS chunks
 * 2. React Query prefetches to warm the data cache
 *
 * Result: Navigation feels instant - both code AND data are ready
 */

import { queryClient } from '../api/provider'
import { api } from '../api/client'

// Map route paths to their import functions
// These must match the lazy() imports in App.tsx
const routeImports: Record<string, () => Promise<unknown>> = {
  '/dashboard': () => import('../Dashboard'),
  '/activity': () => import('../Activity'),
  '/subscribers': () => import('../Subscribers'),
  '/profile': () => import('../Profile'),
  '/settings': () => import('../Settings'),
  '/settings/payments': () => import('../PaymentSettings'),
  '/settings/billing': () => import('../Billing'),
  '/settings/help': () => import('../HelpSupport'),
  '/edit-page': () => import('../EditPage'),
  '/templates': () => import('../Templates'),
  '/updates': () => import('../updates/UpdatesHistory'),
  '/updates/new': () => import('../updates/NewUpdate'),
  '/payroll': () => import('../payroll/PayrollHistory'),
  '/requests': () => import('../SentRequests'),
  '/new-request': () => import('../request/SelectRecipient'),
}

// Map route paths to their data prefetch functions
// Each returns a promise that prefetches relevant data for that route
const routeDataPrefetch: Record<string, () => Promise<void>> = {
  '/dashboard': async () => {
    // Dashboard needs profile, recent activity, and metrics
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: ['profile'],
        queryFn: () => api.profile.get(),
        staleTime: 5 * 60 * 1000, // 5 min - profile rarely changes
      }),
      queryClient.prefetchQuery({
        queryKey: ['activity'],
        queryFn: () => api.activity.list(undefined, 5),
        staleTime: 30 * 1000, // 30s - activity changes often
      }),
      queryClient.prefetchQuery({
        queryKey: ['metrics'],
        queryFn: () => api.activity.getMetrics(),
        staleTime: 60 * 1000, // 1 min
      }),
    ])
  },

  '/activity': async () => {
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: ['activity'],
        queryFn: () => api.activity.list(undefined, 20),
        staleTime: 30 * 1000,
      }),
      queryClient.prefetchQuery({
        queryKey: ['metrics'],
        queryFn: () => api.activity.getMetrics(),
        staleTime: 60 * 1000,
      }),
    ])
  },

  '/subscribers': async () => {
    await queryClient.prefetchQuery({
      queryKey: ['subscriptions', 'all'],
      queryFn: () => api.subscriptions.list({ status: 'all' }),
      staleTime: 60 * 1000,
    })
  },

  '/profile': async () => {
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: ['profile'],
        queryFn: () => api.profile.get(),
        staleTime: 5 * 60 * 1000,
      }),
      queryClient.prefetchQuery({
        queryKey: ['metrics'],
        queryFn: () => api.activity.getMetrics(),
        staleTime: 60 * 1000,
      }),
    ])
  },

  '/settings': async () => {
    await queryClient.prefetchQuery({
      queryKey: ['profile'],
      queryFn: () => api.profile.get(),
      staleTime: 5 * 60 * 1000,
    })
  },

  '/settings/payments': async () => {
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: ['stripeStatus'],
        queryFn: () => api.stripe.getStatus(),
        staleTime: 2 * 60 * 1000,
      }),
      queryClient.prefetchQuery({
        queryKey: ['paystackStatus'],
        queryFn: () => api.paystack.getStatus(),
        staleTime: 2 * 60 * 1000,
      }),
    ])
  },

  '/updates': async () => {
    await queryClient.prefetchQuery({
      queryKey: ['updates'],
      queryFn: () => api.updates.list(),
      staleTime: 60 * 1000,
    })
  },

  '/requests': async () => {
    await queryClient.prefetchQuery({
      queryKey: ['requests', 'all'],
      queryFn: () => api.requests.list({ status: 'all' }),
      staleTime: 60 * 1000,
    })
  },
}

// Track which routes have been prefetched to avoid duplicate requests
const prefetchedRoutes = new Set<string>()
const prefetchedData = new Set<string>()

/**
 * Prefetch a route's JS chunk
 * Safe to call multiple times - will only fetch once
 */
export function prefetchRoute(path: string): void {
  // Normalize path (remove trailing slash, query params)
  const normalizedPath = path.split('?')[0].replace(/\/$/, '') || '/'

  // Skip if already prefetched
  if (prefetchedRoutes.has(normalizedPath)) return

  // Find matching import function
  const importFn = routeImports[normalizedPath]
  if (!importFn) return

  // Mark as prefetched immediately to prevent duplicate calls
  prefetchedRoutes.add(normalizedPath)

  // Use requestIdleCallback for non-blocking prefetch
  // Falls back to setTimeout for browsers without support
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      importFn().catch(() => {
        // Remove from set on failure so it can be retried
        prefetchedRoutes.delete(normalizedPath)
      })
    })
  } else {
    setTimeout(() => {
      importFn().catch(() => {
        prefetchedRoutes.delete(normalizedPath)
      })
    }, 1)
  }
}

/**
 * Prefetch a route's data
 * Safe to call multiple times - will only fetch once per session
 */
export function prefetchRouteData(path: string): void {
  // Normalize path
  const normalizedPath = path.split('?')[0].replace(/\/$/, '') || '/'

  // Skip if already prefetched this session
  if (prefetchedData.has(normalizedPath)) return

  // Find matching data prefetch function
  const prefetchFn = routeDataPrefetch[normalizedPath]
  if (!prefetchFn) return

  // Mark as prefetched immediately
  prefetchedData.add(normalizedPath)

  // Use requestIdleCallback to avoid blocking interaction
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => {
      prefetchFn().catch(() => {
        // Remove on failure so it can be retried
        prefetchedData.delete(normalizedPath)
      })
    })
  } else {
    setTimeout(() => {
      prefetchFn().catch(() => {
        prefetchedData.delete(normalizedPath)
      })
    }, 1)
  }
}

/**
 * Prefetch both code AND data for a route
 * Call this on hover/touch for instant navigation
 */
export function prefetchAll(path: string): void {
  prefetchRoute(path)
  prefetchRouteData(path)
}

/**
 * Get event handlers for prefetching on interaction
 * Attach these to navigation elements
 */
export function getPrefetchHandlers(path: string) {
  return {
    onTouchStart: () => prefetchAll(path),
    onMouseEnter: () => prefetchAll(path),
  }
}

/**
 * Prefetch multiple routes at once (e.g., on app load)
 * Uses idle time to avoid blocking main thread
 */
export function prefetchRoutes(paths: string[]): void {
  paths.forEach((path, index) => {
    // Stagger prefetches to avoid overwhelming the network
    setTimeout(() => prefetchRoute(path), index * 100)
  })
}

/**
 * Prefetch core app data after auth is confirmed
 * Call this once after login/app start
 */
export function prefetchCoreData(): void {
  const doPrefetch = () => {
    // Profile - most commonly needed
    queryClient.prefetchQuery({
      queryKey: ['profile'],
      queryFn: () => api.profile.get(),
      staleTime: 5 * 60 * 1000,
    }).catch(() => {})

    // Metrics - shown on dashboard and profile
    queryClient.prefetchQuery({
      queryKey: ['metrics'],
      queryFn: () => api.activity.getMetrics(),
      staleTime: 60 * 1000,
    }).catch(() => {})
  }

  // Prefetch in idle time
  if ('requestIdleCallback' in window) {
    requestIdleCallback(doPrefetch)
  } else {
    setTimeout(doPrefetch, 100)
  }
}
