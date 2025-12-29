import { QueryClient, QueryClientProvider, useIsRestoring } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import type { ReactNode } from 'react'

// Re-export useIsRestoring for components to suppress skeletons during hydration
export { useIsRestoring }

// Cache version - increment when schema changes to invalidate old persisted data
const CACHE_VERSION = 1
const CACHE_KEY = `natepay-query-cache-v${CACHE_VERSION}`

// Keys that are safe to persist (small, non-sensitive, user-specific)
// currentUser is critical to avoid auth skeleton flash on reload
const PERSIST_WHITELIST = new Set([
  'currentUser',
  'profile',
  'metrics',
  'settings',
  'stripeStatus',
  'paystackStatus',
])

/**
 * Check if a query key should be persisted
 * Only persist whitelisted keys to avoid:
 * - Bloating localStorage with large lists
 * - Persisting sensitive admin/support data
 * - Storing infinite query data (which has different structure)
 */
function shouldPersistQuery(queryKey: readonly unknown[]): boolean {
  const rootKey = queryKey[0]
  return typeof rootKey === 'string' && PERSIST_WHITELIST.has(rootKey)
}

// Create a client with optimized caching for native-app feel
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry failed requests once
      retry: 1,
      // Consider data stale after 2 minutes (increased from 30s)
      // This means cached data shows instantly, background refresh happens after 2min
      staleTime: 2 * 60 * 1000,
      // Keep unused data in cache for 30 minutes (increased from 5min)
      // Longer retention = more cache hits on navigation
      gcTime: 30 * 60 * 1000,
      // Disable focus refetch globally to prevent flicker - enable per-query if needed
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Retry mutations once
      retry: 1,
    },
  },
})

/**
 * Safe localStorage wrapper that handles:
 * - Private browsing mode (localStorage throws)
 * - Quota exceeded errors
 * - Missing localStorage (SSR, some browsers)
 */
function createSafeStorage(): Storage | undefined {
  try {
    // Test if localStorage is available and working
    const testKey = '__storage_test__'
    window.localStorage.setItem(testKey, testKey)
    window.localStorage.removeItem(testKey)
    return window.localStorage
  } catch {
    // localStorage not available - cache will be in-memory only
    console.warn('[Cache] localStorage not available, using in-memory cache only')
    return undefined
  }
}

const safeStorage = createSafeStorage()

// Only create persister if localStorage is available
const persister = safeStorage
  ? createSyncStoragePersister({
      storage: safeStorage,
      key: CACHE_KEY,
      // Throttle writes to localStorage (don't write on every cache update)
      throttleTime: 1000,
      // Serialize with error handling
      serialize: (data) => {
        try {
          return JSON.stringify(data)
        } catch (e) {
          console.warn('[Cache] Failed to serialize cache:', e)
          return '{}'
        }
      },
      deserialize: (data) => {
        try {
          return JSON.parse(data)
        } catch (e) {
          console.warn('[Cache] Failed to deserialize cache:', e)
          return { mutations: [], queries: [] }
        }
      },
    })
  : undefined

interface ApiProviderProps {
  children: ReactNode
}

export function ApiProvider({ children }: ApiProviderProps) {
  // If no persister (localStorage unavailable), use regular QueryClientProvider
  if (!persister) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        // Max age of persisted cache: 24 hours
        maxAge: 24 * 60 * 60 * 1000,
        // Only persist whitelisted, successful queries
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => {
            // Must be successful
            if (query.state.status !== 'success') return false
            // Must be in whitelist
            return shouldPersistQuery(query.queryKey)
          },
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}

/**
 * Clear persisted cache from localStorage
 * Call this on logout to prevent cross-user data leakage
 */
export function clearPersistedCache(): void {
  try {
    // Clear current version
    window.localStorage.removeItem(CACHE_KEY)
    // Also clear any old versions (migration cleanup)
    window.localStorage.removeItem('natepay-query-cache')
  } catch {
    // Ignore errors - localStorage might not be available
  }
}

export { queryClient, CACHE_KEY }
