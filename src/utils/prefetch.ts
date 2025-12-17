/**
 * Route prefetching for lazy-loaded components
 *
 * Triggers dynamic imports on touchstart/mouseenter to preload
 * the JS chunk before the user actually navigates.
 */

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

// Track which routes have been prefetched to avoid duplicate requests
const prefetchedRoutes = new Set<string>()

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
 * Get event handlers for prefetching on interaction
 * Attach these to navigation elements
 */
export function getPrefetchHandlers(path: string) {
  return {
    onTouchStart: () => prefetchRoute(path),
    onMouseEnter: () => prefetchRoute(path),
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
