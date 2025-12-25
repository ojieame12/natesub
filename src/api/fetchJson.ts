/**
 * Unified Fetch Client
 *
 * Shared fetch wrapper used by both user-facing API (client.ts) and admin API (admin/api.ts).
 * Provides configurable timeout, auth injection, error normalization, and signal merging.
 */

export interface FetchOptions extends Omit<RequestInit, 'signal'> {
  timeout?: number
  signal?: AbortSignal
}

export interface FetchConfig {
  baseUrl: string
  defaultTimeout: number
  getAuthToken: () => string | null
  onUnauthorized?: (path: string) => void
}

export type FetchClient = <T>(path: string, options?: FetchOptions) => Promise<T>

/**
 * Creates a configured fetch client instance.
 *
 * @example
 * const client = createFetchClient({
 *   baseUrl: 'https://api.example.com',
 *   defaultTimeout: 8000,
 *   getAuthToken: () => localStorage.getItem('token'),
 *   onUnauthorized: () => { window.location.href = '/login' }
 * })
 *
 * const data = await client<User>('/users/me')
 */
export function createFetchClient(config: FetchConfig): FetchClient {
  return async function fetchJson<T>(
    path: string,
    options: FetchOptions = {}
  ): Promise<T> {
    const { timeout = config.defaultTimeout, signal: externalSignal, ...fetchOptions } = options
    const url = `${config.baseUrl}${path}`

    // Timeout + external signal merging
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    const signal = externalSignal
      ? mergeAbortSignals(externalSignal, controller.signal)
      : controller.signal

    try {
      // Headers setup
      const headers: Record<string, string> = {
        'Accept': 'application/json',
        ...(fetchOptions.headers as Record<string, string>),
      }

      // Content-Type only when needed (avoid CORS preflight on GETs)
      const hasBody = fetchOptions.body !== undefined
      const isFormData = fetchOptions.body instanceof FormData
      if (hasBody && !isFormData && !('Content-Type' in headers)) {
        headers['Content-Type'] = 'application/json'
      }

      // Auth injection
      const token = config.getAuthToken()
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }

      const response = await fetch(url, {
        ...fetchOptions,
        credentials: 'include',
        headers,
        signal,
      })

      const data = await response.json().catch(() => ({ error: 'Invalid response' }))

      if (!response.ok) {
        const error = normalizeError(data, response.status)
        if (response.status === 401 && config.onUnauthorized) {
          config.onUnauthorized(path)
        }
        throw error
      }

      return data as T
    } catch (err: any) {
      // Already normalized error from !response.ok path
      if (err?.status !== undefined) {
        throw err
      }
      // Timeout / abort
      if (err?.name === 'AbortError') {
        throw Object.assign(new Error('Request timed out'), { status: 0, error: 'Request timed out' })
      }
      // Network error
      throw Object.assign(new Error('Network error. Please check your connection.'), { status: 0, error: 'Network error' })
    } finally {
      clearTimeout(timeoutId)
    }
  }
}

/**
 * Merges two AbortSignals - aborts when either fires.
 * Used to combine React Query's signal with timeout signal.
 */
function mergeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController()
  const abort = () => controller.abort()

  // If either is already aborted, abort immediately
  if (a.aborted || b.aborted) {
    controller.abort()
    return controller.signal
  }

  a.addEventListener('abort', abort)
  b.addEventListener('abort', abort)

  return controller.signal
}

/**
 * Normalizes various error response shapes into a consistent format.
 * Supports: { error: string }, { message: string }, { errors: [{ message }] } (Zod)
 */
function normalizeError(data: any, status: number): Error & { status: number; error: string; data?: any } {
  const message =
    data?.error ||
    data?.message ||
    data?.errors?.[0]?.message ||
    'Request failed'

  return Object.assign(new Error(message), {
    status,
    error: message,
    data,
  })
}

// Export helpers for testing
export { mergeAbortSignals as _mergeAbortSignals, normalizeError as _normalizeError }
