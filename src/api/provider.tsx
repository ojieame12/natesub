import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import type { ReactNode } from 'react'

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

// Persist cache to localStorage - survives page refresh and app restart
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'natepay-query-cache',
  // Throttle writes to localStorage (don't write on every cache update)
  throttleTime: 1000,
  // Serialize/deserialize with error handling
  serialize: (data) => JSON.stringify(data),
  deserialize: (data) => JSON.parse(data),
})

interface ApiProviderProps {
  children: ReactNode
}

export function ApiProvider({ children }: ApiProviderProps) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        // Max age of persisted cache: 24 hours
        // After this, cache is considered stale and will be refetched
        maxAge: 24 * 60 * 60 * 1000,
        // Don't persist error states - only successful queries
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => {
            // Only persist successful queries
            return query.state.status === 'success'
          },
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  )
}

export { queryClient }
