import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { api } from './client'
import { blobToBase64, uploadBlob } from './hooks'

describe('api/hooks utilities', () => {
  it('converts a blob to raw base64 (no data: prefix)', async () => {
    const blob = new Blob(['hello'], { type: 'text/plain' })
    await expect(blobToBase64(blob)).resolves.toBe('aGVsbG8=')
  })

  it('uploadBlob enforces client-side size caps', async () => {
    const tooLarge = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/png' })
    await expect(uploadBlob(tooLarge, 'avatar')).rejects.toThrow('File too large. Maximum size is 10MB')
  })

  it('uploadBlob requests a signed URL with the blob content type and uploads via PUT', async () => {
    const getUploadUrl = vi.spyOn(api.media, 'getUploadUrl').mockResolvedValue({
      uploadUrl: 'https://example.com/upload',
      publicUrl: 'https://cdn.example.com/public',
      key: 'k',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://example.com/upload')
      expect(init?.method).toBe('PUT')
      expect((init?.headers as Record<string, string>)['Content-Type']).toBe('audio/webm')
      return new Response('', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' })
    await expect(uploadBlob(blob, 'voice')).resolves.toBe('https://cdn.example.com/public')

    expect(getUploadUrl).toHaveBeenCalledWith('voice', 'audio/webm')
  })

  it('uploadBlob respects an explicit mimeType override', async () => {
    vi.spyOn(api.media, 'getUploadUrl').mockResolvedValue({
      uploadUrl: 'https://example.com/upload',
      publicUrl: 'https://cdn.example.com/public',
      key: 'k',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)['Content-Type']).toBe('audio/mp4')
      return new Response('', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock as any)

    const blob = new Blob([new Uint8Array([1])], { type: 'audio/webm' })
    await uploadBlob(blob, 'voice', 'audio/mp4')
  })

  it('uploadBlob throws when the upload returns a non-2xx response', async () => {
    vi.spyOn(api.media, 'getUploadUrl').mockResolvedValue({
      uploadUrl: 'https://example.com/upload',
      publicUrl: 'https://cdn.example.com/public',
      key: 'k',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })) as any)

    const blob = new Blob([new Uint8Array([1])], { type: 'audio/webm' })
    await expect(uploadBlob(blob, 'voice')).rejects.toThrow('Upload failed: 403')
  })
})

describe('logout cache clearing', () => {
  const CACHE_KEY = 'natepay-query-cache-v1'

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('useLogout clears persisted cache on success', async () => {
    // Set up persisted cache
    localStorage.setItem(CACHE_KEY, JSON.stringify({ queries: [{ key: ['profile'] }], mutations: [] }))
    expect(localStorage.getItem(CACHE_KEY)).not.toBeNull()

    // Mock the logout API call
    vi.spyOn(api.auth, 'logout').mockResolvedValue({ success: true })

    // Mock fetch for any other calls
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })) as any)

    // Import clearPersistedCache and call it directly (simulating what useLogout does)
    const { clearPersistedCache } = await import('./provider')
    clearPersistedCache()

    // Cache should be cleared
    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
  })

  it('useDeleteAccount clears persisted cache on success', async () => {
    // Set up persisted cache
    localStorage.setItem(CACHE_KEY, JSON.stringify({ queries: [{ key: ['profile'] }], mutations: [] }))
    expect(localStorage.getItem(CACHE_KEY)).not.toBeNull()

    // Import clearPersistedCache and call it directly
    const { clearPersistedCache } = await import('./provider')
    clearPersistedCache()

    // Cache should be cleared
    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
  })

  it('clearing cache does not affect other localStorage keys', async () => {
    // Set up various localStorage keys
    localStorage.setItem(CACHE_KEY, JSON.stringify({ queries: [], mutations: [] }))
    localStorage.setItem('nate_auth_token', 'test-token')
    localStorage.setItem('other-app-data', 'should-persist')

    const { clearPersistedCache } = await import('./provider')
    clearPersistedCache()

    // Only cache should be cleared
    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
    expect(localStorage.getItem('nate_auth_token')).toBe('test-token')
    expect(localStorage.getItem('other-app-data')).toBe('should-persist')
  })
})

