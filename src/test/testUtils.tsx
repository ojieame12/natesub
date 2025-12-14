import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions } from '@testing-library/react'
import type { ReactElement, PropsWithChildren } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../components'

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        gcTime: Infinity,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

interface ProvidersOptions {
  route?: string
  queryClient?: QueryClient
}

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', queryClient = createTestQueryClient(), ...options }: ProvidersOptions & Omit<RenderOptions, 'wrapper'> = {}
) {
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    )
  }

  return {
    queryClient,
    ...render(ui, { wrapper: Wrapper, ...options }),
  }
}

