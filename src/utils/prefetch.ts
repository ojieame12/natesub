/**
 * Route prefetching for lazy-loaded components AND data
 *
 * Triggers:
 * 1. Dynamic imports on touchstart/mouseenter to preload JS chunks
 * 2. React Query prefetches to warm the data cache
 *
 * IMPORTANT: Only prefetch simple queries, not infinite queries.
 * Infinite queries (activity, subscriptions, requests) have a different
 * data structure and using prefetchQuery would cause cache mismatches.
 *
 * Result: Navigation feels instant - both code AND data are ready
 */

import { queryClient } from '../api/provider'
import { api } from '../api/client'
import { queryKeys } from '../api/queryKeys'

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

/**
 * Data prefetch functions for each route
 *
 * Only prefetch simple queries that:
 * - Are in the persistence whitelist (profile, metrics, settings, etc.)
 * - Use useQuery (not useInfiniteQuery)
 *
 * Infinite queries (activity, subscriptions, requests) are NOT prefetched
 * because prefetchQuery writes a different data shape than useInfiniteQuery expects.
 */
const routeDataPrefetch: Record<string, () => Promise<void>> = {
  '/dashboard': async () => {
    // Dashboard needs profile and metrics (both are simple queries)
    // Note: Activity is NOT prefetched because it uses useInfiniteQuery
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: queryKeys.profile,
        queryFn: () => api.profile.get(),
        staleTime: 5 * 60 * 1000,
      }),
      queryClient.prefetchQuery({
        queryKey: queryKeys.metrics,
        queryFn: () => api.activity.getMetrics(),
        staleTime: 60 * 1000,
      }),
    ])
  },

  '/activity': async () => {
    // Only prefetch metrics (simple query)
    // Activity list uses useInfiniteQuery - not prefetched
    await queryClient.prefetchQuery({
      queryKey: queryKeys.metrics,
      queryFn: () => api.activity.getMetrics(),
      staleTime: 60 * 1000,
    })
  },

  '/subscribers': async () => {
    // Subscriptions uses useInfiniteQuery - nothing to prefetch here
    // The JS chunk prefetch is still valuable
  },

  '/profile': async () => {
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: queryKeys.profile,
        queryFn: () => api.profile.get(),
        staleTime: 5 * 60 * 1000,
      }),
      queryClient.prefetchQuery({
        queryKey: queryKeys.metrics,
        queryFn: () => api.activity.getMetrics(),
        staleTime: 60 * 1000,
      }),
    ])
  },

  '/settings': async () => {
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: queryKeys.profile,
        queryFn: () => api.profile.get(),
        staleTime: 5 * 60 * 1000,
      }),
      queryClient.prefetchQuery({
        queryKey: queryKeys.settings,
        queryFn: () => api.profile.getSettings(),
        staleTime: 5 * 60 * 1000,
      }),
    ])
  },

  '/settings/payments': async () => {
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: queryKeys.stripe.status,
        queryFn: () => api.stripe.getStatus(),
        staleTime: 2 * 60 * 1000,
      }),
      queryClient.prefetchQuery({
        queryKey: queryKeys.paystack.status,
        queryFn: () => api.paystack.getStatus(),
        staleTime: 2 * 60 * 1000,
      }),
    ])
  },

  '/updates': async () => {
    // Updates list is a simple query, safe to prefetch
    await queryClient.prefetchQuery({
      queryKey: queryKeys.updates.list,
      queryFn: () => api.updates.list(),
      staleTime: 60 * 1000,
    })
  },

  '/requests': async () => {
    // Requests uses useInfiniteQuery - nothing to prefetch here
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
 * Prefetch a route's data (simple queries only)
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
 *
 * Only prefetches whitelisted, simple queries that persist to localStorage
 */
export function prefetchCoreData(): void {
  const doPrefetch = () => {
    // Profile - most commonly needed, persisted
    queryClient.prefetchQuery({
      queryKey: queryKeys.profile,
      queryFn: () => api.profile.get(),
      staleTime: 5 * 60 * 1000,
    }).catch(() => {})

    // Metrics - shown on dashboard and profile, persisted
    queryClient.prefetchQuery({
      queryKey: queryKeys.metrics,
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
