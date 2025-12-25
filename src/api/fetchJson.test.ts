import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createFetchClient, _mergeAbortSignals, _normalizeError } from './fetchJson'

// Helper to create mock Response
function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('createFetchClient', () => {
  let mockFetch: ReturnType<typeof vi.fn>
  let originalFetch: typeof fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
    mockFetch = vi.fn()
    globalThis.fetch = mockFetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.clearAllMocks()
  })

  describe('basic functionality', () => {
    it('makes requests to baseUrl + path', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }))

      const client = createFetchClient({
        baseUrl: 'https://api.example.com',
        defaultTimeout: 5000,
        getAuthToken: () => null,
      })

      await client('/users/me')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users/me',
        expect.any(Object)
      )
    })

    it('returns parsed JSON data', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ id: 1, name: 'Test' }))

      const client = createFetchClient({
        baseUrl: 'https://api.example.com',
        defaultTimeout: 5000,
        getAuthToken: () => null,
      })

      const result = await client<{ id: number; name: string }>('/users/1')

      expect(result).toEqual({ id: 1, name: 'Test' })
    })

    it('includes credentials: include for cookies', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }))

      const client = createFetchClient({
        baseUrl: 'https://api.example.com',
        defaultTimeout: 5000,
        getAuthToken: () => null,
      })

      await client('/test')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ credentials: 'include' })
      )
    })
  })

  describe('timeout handling', () => {
    it('aborts after configured timeout', async () => {
      // Use a very short real timeout
      mockFetch.mockImplementation(
        (_url, options) =>
          new Promise((_, reject) => {
            // Simulate abort behavior when signal fires
            options?.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
            })
          })
      )

      const client = createFetchClient({
        baseUrl: 'https://api.example.com',
        defaultTimeout: 50, // 50ms timeout
        getAuthToken: () => null,
      })

      await expect(client('/slow')).rejects.toThrow('Request timed out')
    })

    it('uses custom timeout when provided', async () => {
      mockFetch.mockImplementation(
        (_url, options) =>
          new Promise((_, reject) => {
            options?.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
            })
          })
      )

      const client = createFetchClient({
        baseUrl: 'https://api.example.com',
        defaultTimeout: 5000,
        getAuthToken: () => null,
      })

      // Custom 50ms timeout should fire before default 5s
      await expect(client('/slow', { timeout: 50 })).rejects.toThrow('Request timed out')
    })

    it('cleans up timeout on success', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }))

      const client = createFetchClient({
        baseUrl: 'https://api.example.com',
        defaultTimeout: 5000,
        getAuthToken: () => null,
      })

      await client('/test')

      expect(clearTimeoutSpy).toHaveBeenCalled()
      clearTimeoutSpy.mockRestore()
    })

    it('cleans up timeout on error', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
      mockFetch.mockResolvedValue(jsonResponse({ error: 'Not found' }, { status: 404 }))

      const client = createFetchClient({
        baseUrl: 'https://api.example.com',
        defaultTimeout: 5000,
        getAuthToken: () => null,
      })

      await client('/test').catch(() => {})

      expect(clearTimeoutSpy).toHaveBeenCalled()
      clearTimeoutSpy.mockRestore()
    })
  })

  describe('auth injection', () => {
    it('adds Authorization header when token exists', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }))

      const client = createFetchClient({
        baseUrl: 'https://api.example.com',
        defaultTimeout: 5000,
        getAuthToken: () => 'test-token-123',
      })

      await client('/protected')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token-123',
          }),
        })
      )
    })

    it('omits Authorization header when no token', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }))

      const client = createFetchClient({
        baseUrl: 'https://api.example.com',
        defaultTimeout: 5000,
        getAuthToken: () => null,
      })

      await client('/public')

      const callHeaders = mockFetch.mock.calls[0][1].headers
      expect(callHeaders.Authorization).toBeUndefined()
    })
  })

  describe('Content-Type handling', () => {
    it('sets Content-Type for JSON body', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }))

      const client = createFetchClient({
        baseUrl: 'https://api.example.com',
        defaultTimeout: 5000,
        getAuthToken: () => null,
      })

      await client('/test', {
        method: 'POST',
        body: JSON.stringify({ data: 'test' }),
      })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      )
    })

    it('omits Content-Type for FormData', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }))

      const client = createFetchClient({
        baseUrl: 'https://api.example.com',
        defaultTimeout: 5000,
        getAuthToken: () => null,
      })

      const formData = new FormData()
      formData.append('file', new Blob(['test']))

      await client('/upload', {
        method: 'POST',
        body: formData,
      })

      const callHeaders = mockFetch.mock.calls[0][1].headers
      expect(callHeaders['Content-Type']).toBeUndefined()
    })

    it('omits Content-Type for GET requests', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }))

      const client = createFetchClient({
        baseUrl: 'https://api.example.com',
        defaultTimeout: 5000,
        getAuthToken: () => null,
      })

      await client('/test')

      const callHeaders = mockFetch.mock.calls[0][1].headers
      expect(callHeaders['Content-Type']).toBeUndefined()
    })
  })

  describe('error handling', () => {
    it('throws on non-ok response with error message', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: 'Not found' }, { status: 404 }))

      const client = createFetchClient({
        baseUrl: 'https://api.example.com',
        defaultTimeout: 5000,
        getAuthToken: () => null,
      })

      await expect(client('/missing')).rejects.toMatchObject({
        message: 'Not found',
        status: 404,
      })
    })

    it('extracts error from {message: string}', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ message: 'Validation failed' }, { status: 400 }))

      const client = createFetchClient({
        baseUrl: 'https://api.example.com',
        defaultTimeout: 5000,
        getAuthToken: () => null,
      })

      await expect(client('/test')).rejects.toMatchObject({
        message: 'Validation failed',
        status: 400,
      })
    })

    it('extracts error from Zod errors array', async () => {
      mockFetch.mockResolvedValue(
        jsonResponse(
          { errors: [{ message: 'Invalid email format' }] },
          { status: 400 }
        )
      )

      const client = createFetchClient({
        baseUrl: 'https://api.example.com',
        defaultTimeout: 5000,
        getAuthToken: () => null,
      })

      await expect(client('/test')).rejects.toMatchObject({
        message: 'Invalid email format',
        status: 400,
      })
    })

    it('handles invalid JSON response', async () => {
      mockFetch.mockResolvedValue(
        new Response('not json', { status: 500 })
      )

      const client = createFetchClient({
        baseUrl: 'https://api.example.com',
        defaultTimeout: 5000,
        getAuthToken: () => null,
      })

      await expect(client('/test')).rejects.toMatchObject({
        message: 'Invalid response',
        status: 500,
      })
    })

    it('handles network errors', async () => {
      mockFetch.mockRejectedValue(new TypeError('Failed to fetch'))

      const client = createFetchClient({
        baseUrl: 'https://api.example.com',
        defaultTimeout: 5000,
        getAuthToken: () => null,
      })

      await expect(client('/test')).rejects.toMatchObject({
        message: 'Network error. Please check your connection.',
        status: 0,
      })
    })
  })

  describe('401 handling', () => {
    it('calls onUnauthorized callback on 401', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: 'Unauthorized' }, { status: 401 }))

      const onUnauthorized = vi.fn()
      const client = createFetchClient({
        baseUrl: 'https://api.example.com',
        defaultTimeout: 5000,
        getAuthToken: () => 'token',
        onUnauthorized,
      })

      await client('/protected').catch(() => {})

      expect(onUnauthorized).toHaveBeenCalledWith('/protected')
    })

    it('does not call callback when not configured', async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: 'Unauthorized' }, { status: 401 }))

      const client = createFetchClient({
        baseUrl: 'https://api.example.com',
        defaultTimeout: 5000,
        getAuthToken: () => null,
      })

      // Should not throw about missing callback
      await expect(client('/test')).rejects.toMatchObject({ status: 401 })
    })
  })

  describe('signal merging', () => {
    it('aborts when external signal aborts', async () => {
      mockFetch.mockImplementation(
        (_url, options) =>
          new Promise((_, reject) => {
            options?.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }))
            })
          })
      )

      const client = createFetchClient({
        baseUrl: 'https://api.example.com',
        defaultTimeout: 60000, // Long timeout
        getAuthToken: () => null,
      })

      const controller = new AbortController()
      const promise = client('/test', { signal: controller.signal })

      // Abort externally - should trigger immediately
      setTimeout(() => controller.abort(), 10)

      await expect(promise).rejects.toThrow('Request timed out')
    })
  })
})

describe('_mergeAbortSignals', () => {
  it('aborts when first signal aborts', () => {
    const a = new AbortController()
    const b = new AbortController()

    const merged = _mergeAbortSignals(a.signal, b.signal)

    expect(merged.aborted).toBe(false)
    a.abort()
    expect(merged.aborted).toBe(true)
  })

  it('aborts when second signal aborts', () => {
    const a = new AbortController()
    const b = new AbortController()

    const merged = _mergeAbortSignals(a.signal, b.signal)

    expect(merged.aborted).toBe(false)
    b.abort()
    expect(merged.aborted).toBe(true)
  })

  it('already aborted if input is aborted', () => {
    const a = new AbortController()
    const b = new AbortController()
    a.abort()

    const merged = _mergeAbortSignals(a.signal, b.signal)

    expect(merged.aborted).toBe(true)
  })
})

describe('_normalizeError', () => {
  it('extracts error from {error: string}', () => {
    const err = _normalizeError({ error: 'Test error' }, 400)
    expect(err.message).toBe('Test error')
    expect(err.status).toBe(400)
  })

  it('extracts error from {message: string}', () => {
    const err = _normalizeError({ message: 'Test message' }, 500)
    expect(err.message).toBe('Test message')
  })

  it('extracts error from Zod errors array', () => {
    const err = _normalizeError({ errors: [{ message: 'Field required' }] }, 400)
    expect(err.message).toBe('Field required')
  })

  it('uses default message when no error found', () => {
    const err = _normalizeError({}, 500)
    expect(err.message).toBe('Request failed')
  })

  it('includes original data on error', () => {
    const data = { error: 'Test', extra: 'info' }
    const err = _normalizeError(data, 400)
    expect(err.data).toEqual(data)
  })
})
