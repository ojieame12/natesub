import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'

// Mock redis before importing app
vi.mock('../../src/db/redis.js', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    ping: vi.fn().mockResolvedValue('PONG'),
  },
}))

// Mock db
vi.mock('../../src/db/client.js', () => ({
  db: {
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
  },
}))

describe('GET /geo', () => {
  let app: Hono
  let mockRedisGet: ReturnType<typeof vi.fn>
  let mockRedisSet: ReturnType<typeof vi.fn>
  let originalFetch: typeof global.fetch

  beforeEach(async () => {
    vi.clearAllMocks()
    originalFetch = global.fetch

    // Get mocked redis
    const { redis } = await import('../../src/db/redis.js')
    mockRedisGet = redis.get as ReturnType<typeof vi.fn>
    mockRedisSet = redis.set as ReturnType<typeof vi.fn>

    // Import app fresh
    const appModule = await import('../../src/app.js')
    app = appModule.default
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns CDN header when CF-IPCountry is available', async () => {
    const res = await app.request('/geo', {
      headers: {
        'CF-IPCountry': 'NG',
      },
    })

    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.country).toBe('NG')
    expect(json.source).toBe('cdn')
    // Should not write to cache for CDN lookups
    expect(mockRedisSet).not.toHaveBeenCalled()
  })

  it('returns CDN header when x-vercel-ip-country is available', async () => {
    const res = await app.request('/geo', {
      headers: {
        'x-vercel-ip-country': 'US',
      },
    })

    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.country).toBe('US')
    expect(json.source).toBe('cdn')
  })

  it('returns cached geo when available', async () => {
    mockRedisGet.mockResolvedValueOnce('GB')

    const res = await app.request('/geo', {
      headers: {
        'x-forwarded-for': '1.2.3.4',
      },
    })

    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.country).toBe('GB')
    expect(json.source).toBe('cache')
    expect(mockRedisGet).toHaveBeenCalledWith('geo:1.2.3.4')
  })

  it('does not cache when IP is unknown', async () => {
    // No IP headers at all
    const res = await app.request('/geo')

    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.country).toBe(null)
    expect(json.source).toBe('unknown')
    expect(json.fallback).toBe('US')
    // Should not write to cache
    expect(mockRedisSet).not.toHaveBeenCalled()
  })

  it('does not cache when ipapi fails', async () => {
    mockRedisGet.mockResolvedValueOnce(null) // No cache

    // Mock fetch to fail
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'))

    const res = await app.request('/geo', {
      headers: {
        'x-forwarded-for': '1.2.3.4',
      },
    })

    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.country).toBe(null)
    expect(json.source).toBe('lookup_failed')
    expect(json.fallback).toBe('US')
    // Should NOT cache failures
    expect(mockRedisSet).not.toHaveBeenCalled()
  })

  it('does not cache when ipapi returns invalid response', async () => {
    mockRedisGet.mockResolvedValueOnce(null)

    // Mock fetch to return invalid country
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('INVALID'),
    })

    const res = await app.request('/geo', {
      headers: {
        'x-forwarded-for': '1.2.3.4',
      },
    })

    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.country).toBe(null)
    expect(json.source).toBe('lookup_failed')
    // Should NOT cache invalid responses
    expect(mockRedisSet).not.toHaveBeenCalled()
  })

  it('caches successful ipapi lookups for 24h', async () => {
    mockRedisGet.mockResolvedValueOnce(null)
    mockRedisSet.mockResolvedValueOnce('OK')

    // Mock successful ipapi response
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('NG'),
    })

    const res = await app.request('/geo', {
      headers: {
        'x-forwarded-for': '1.2.3.4',
      },
    })

    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.country).toBe('NG')
    expect(json.source).toBe('ipapi')
    // Should cache for 24 hours (86400 seconds)
    expect(mockRedisSet).toHaveBeenCalledWith('geo:1.2.3.4', 'NG', 'EX', 86400)
  })

  it('returns country: null with fallback for failed lookups', async () => {
    mockRedisGet.mockResolvedValueOnce(null)

    // Mock non-ok response
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 429,
    })

    const res = await app.request('/geo', {
      headers: {
        'x-forwarded-for': '1.2.3.4',
      },
    })

    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.country).toBe(null)
    expect(json.fallback).toBe('US')
    // Frontend can decide how to handle country: null
  })

  it('extracts first IP from x-forwarded-for chain', async () => {
    mockRedisGet.mockResolvedValueOnce('CA')

    const res = await app.request('/geo', {
      headers: {
        'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12',
      },
    })

    const json = await res.json()
    expect(json.country).toBe('CA')
    expect(mockRedisGet).toHaveBeenCalledWith('geo:1.2.3.4')
  })

  it('uses x-real-ip as fallback when x-forwarded-for is missing', async () => {
    mockRedisGet.mockResolvedValueOnce('DE')

    const res = await app.request('/geo', {
      headers: {
        'x-real-ip': '10.20.30.40',
      },
    })

    const json = await res.json()
    expect(json.country).toBe('DE')
    expect(mockRedisGet).toHaveBeenCalledWith('geo:10.20.30.40')
  })

  it('continues when Redis cache read fails', async () => {
    mockRedisGet.mockRejectedValueOnce(new Error('Redis error'))
    mockRedisSet.mockResolvedValueOnce('OK')

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve('FR'),
    })

    const res = await app.request('/geo', {
      headers: {
        'x-forwarded-for': '1.2.3.4',
      },
    })

    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.country).toBe('FR')
    expect(json.source).toBe('ipapi')
  })
})
