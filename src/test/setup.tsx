import '@testing-library/jest-dom/vitest'

import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { useOnboardingStore } from '../onboarding/store'
import { useRequestStore } from '../request/store'
import { useUpdatesStore } from '../updates/store'

// Clean up DOM and reset storage between tests
afterEach(() => {
  cleanup()
  // Reset global Zustand stores (they persist in-memory across tests)
  try {
    useOnboardingStore.getState().reset()
  } catch {
    // ignore
  }
  try {
    useRequestStore.getState().reset()
  } catch {
    // ignore
  }
  try {
    useUpdatesStore.getState().clearDraft()
  } catch {
    // ignore
  }
  try {
    localStorage.clear()
  } catch {
    // ignore
  }
  try {
    sessionStorage.clear()
  } catch {
    // ignore
  }
  vi.restoreAllMocks()
})

// Polyfills / browser APIs used across the app
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

// Some UI libs rely on these observers
class MockResizeObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}

class MockIntersectionObserver {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  takeRecords = vi.fn(() => [])
}

globalThis.ResizeObserver = MockResizeObserver
// @ts-expect-error - test env global
globalThis.IntersectionObserver = MockIntersectionObserver

// Misc browser APIs used in a few places
window.scrollTo = vi.fn()

if (!navigator.clipboard) {
  // @ts-expect-error - jsdom partial
  navigator.clipboard = {
    writeText: vi.fn().mockResolvedValue(undefined),
  }
}

// External navigation helpers
window.open = vi.fn()

// Capacitor mocks (web by default)
vi.mock('@capacitor/core', () => {
  return {
    Capacitor: {
      isNativePlatform: vi.fn(() => false),
    },
  }
})

vi.mock('@capacitor/app', () => {
  return {
    App: {
      addListener: vi.fn(),
      removeAllListeners: vi.fn(),
    },
  }
})

// UI virtualization is not needed for unit tests; keep it predictable.
vi.mock('react-virtuoso', () => {
  return {
    Virtuoso: ({ data, itemContent }: any) => (
      <div data-testid="virtuoso">
        {Array.isArray(data)
          ? data.map((item: any, index: number) => (
              <div key={item?.id ?? index}>{itemContent(index, item)}</div>
            ))
          : null}
      </div>
    ),
  }
})
