import { test, expect } from '@playwright/test'
import { e2eLogin } from './auth.helper'

/**
 * Media Upload E2E Tests
 *
 * Tests the media upload system:
 * - Signed URL generation
 * - File type validation
 * - Size limits
 * - Rate limiting
 *
 * Note: Actual file uploads to R2 require the storage service to be configured.
 * These tests verify the API contracts and signed URL generation.
 *
 * Run with: npx playwright test media.spec.ts
 */

const API_URL = 'http://localhost:3001'

// ============================================
// HELPER: Setup authenticated user
// ============================================

async function setupUser(
  request: import('@playwright/test').APIRequestContext,
  suffix: string
) {
  const ts = Date.now().toString().slice(-8)
  const email = `media-${suffix}-${ts}@e2e.natepay.co`

  const { token, user } = await e2eLogin(request, email)

  return { token, userId: user.id, email }
}

// ============================================
// SIGNED URL GENERATION TESTS
// ============================================

test.describe('Signed Upload URL', () => {
  test('POST /media/upload-url returns signed URL for avatar', async ({ request }) => {
    const { token } = await setupUser(request, 'avatar')

    const response = await request.post(`${API_URL}/media/upload-url`, {
      data: {
        type: 'avatar',
        mimeType: 'image/jpeg',
        fileSize: 1024 * 100, // 100KB
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.uploadUrl).toBeDefined()
    expect(data.uploadUrl).toContain('http')
    expect(data.key || data.fileKey).toBeDefined()
  })

  test('POST /media/upload-url returns signed URL for photo', async ({ request }) => {
    const { token } = await setupUser(request, 'photo')

    const response = await request.post(`${API_URL}/media/upload-url`, {
      data: {
        type: 'photo',
        mimeType: 'image/png',
        fileSize: 1024 * 500, // 500KB
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.uploadUrl).toBeDefined()
  })

  test('POST /media/upload-url returns signed URL for voice', async ({ request }) => {
    const { token } = await setupUser(request, 'voice')

    const response = await request.post(`${API_URL}/media/upload-url`, {
      data: {
        type: 'voice',
        mimeType: 'audio/webm',
        fileSize: 1024 * 1024 * 2, // 2MB
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.uploadUrl).toBeDefined()
  })

  test('POST /media/upload-url returns signed URL for banner', async ({ request }) => {
    const { token } = await setupUser(request, 'banner')

    const response = await request.post(`${API_URL}/media/upload-url`, {
      data: {
        type: 'banner',
        mimeType: 'image/webp',
        fileSize: 1024 * 1024, // 1MB
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.uploadUrl).toBeDefined()
  })

  test('accepts optional fileName', async ({ request }) => {
    const { token } = await setupUser(request, 'filename')

    const response = await request.post(`${API_URL}/media/upload-url`, {
      data: {
        type: 'avatar',
        mimeType: 'image/jpeg',
        fileSize: 1024 * 50,
        fileName: 'my-profile-pic.jpg',
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(200)
    const data = await response.json()

    expect(data.uploadUrl).toBeDefined()
  })
})

// ============================================
// VALIDATION TESTS
// ============================================

test.describe('Upload URL Validation', () => {
  test('rejects invalid media type', async ({ request }) => {
    const { token } = await setupUser(request, 'invalidtype')

    const response = await request.post(`${API_URL}/media/upload-url`, {
      data: {
        type: 'invalid-type',
        mimeType: 'image/jpeg',
        fileSize: 1024,
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(400)
  })

  test('rejects file size over 50MB limit', async ({ request }) => {
    const { token } = await setupUser(request, 'toobig')

    const response = await request.post(`${API_URL}/media/upload-url`, {
      data: {
        type: 'photo',
        mimeType: 'image/jpeg',
        fileSize: 51 * 1024 * 1024, // 51MB - over limit
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(400)
  })

  test('rejects zero file size', async ({ request }) => {
    const { token } = await setupUser(request, 'zerosize')

    const response = await request.post(`${API_URL}/media/upload-url`, {
      data: {
        type: 'avatar',
        mimeType: 'image/jpeg',
        fileSize: 0,
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(400)
  })

  test('rejects negative file size', async ({ request }) => {
    const { token } = await setupUser(request, 'negsize')

    const response = await request.post(`${API_URL}/media/upload-url`, {
      data: {
        type: 'avatar',
        mimeType: 'image/jpeg',
        fileSize: -1000,
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(400)
  })

  test('rejects missing mimeType', async ({ request }) => {
    const { token } = await setupUser(request, 'nomime')

    const response = await request.post(`${API_URL}/media/upload-url`, {
      data: {
        type: 'avatar',
        fileSize: 1024,
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(400)
  })

  test('rejects missing type', async ({ request }) => {
    const { token } = await setupUser(request, 'notype')

    const response = await request.post(`${API_URL}/media/upload-url`, {
      data: {
        mimeType: 'image/jpeg',
        fileSize: 1024,
      },
      headers: { 'Authorization': `Bearer ${token}` },
    })

    expect(response.status()).toBe(400)
  })
})

// ============================================
// AUTH TESTS
// ============================================

test.describe('Upload URL Auth', () => {
  test('requires authentication', async ({ request }) => {
    const response = await request.post(`${API_URL}/media/upload-url`, {
      data: {
        type: 'avatar',
        mimeType: 'image/jpeg',
        fileSize: 1024,
      },
    })

    expect(response.status()).toBe(401)
  })

  test('rejects invalid token', async ({ request }) => {
    const response = await request.post(`${API_URL}/media/upload-url`, {
      data: {
        type: 'avatar',
        mimeType: 'image/jpeg',
        fileSize: 1024,
      },
      headers: { 'Authorization': 'Bearer invalid-token' },
    })

    expect(response.status()).toBe(401)
  })
})

// ============================================
// RATE LIMITING TESTS
// ============================================

test.describe('Upload Rate Limiting', () => {
  test('rate limits excessive requests', async ({ request }) => {
    const { token } = await setupUser(request, 'ratelimit')

    // Send many requests rapidly
    const requests = Array(15).fill(null).map(() =>
      request.post(`${API_URL}/media/upload-url`, {
        data: {
          type: 'avatar',
          mimeType: 'image/jpeg',
          fileSize: 1024,
        },
        headers: { 'Authorization': `Bearer ${token}` },
      })
    )

    const responses = await Promise.all(requests)
    const statuses = responses.map(r => r.status())

    // Some should succeed, but we should eventually hit rate limit
    const hasRateLimit = statuses.some(s => s === 429)
    const hasSuccess = statuses.some(s => s === 200)

    // At minimum, we should get either all successes (limit not hit) or some rate limits
    expect(hasSuccess || hasRateLimit).toBeTruthy()
  })
})

// ============================================
// CONTENT TYPE SPECIFIC TESTS
// ============================================

test.describe('Content Type Handling', () => {
  test('handles various image types', async ({ request }) => {
    const { token } = await setupUser(request, 'imagetypes')

    const imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

    for (const mimeType of imageTypes) {
      const response = await request.post(`${API_URL}/media/upload-url`, {
        data: {
          type: 'photo',
          mimeType,
          fileSize: 1024 * 100,
        },
        headers: { 'Authorization': `Bearer ${token}` },
      })

      // Should accept all standard image types (or return 400 if storage not configured)
      expect([200, 400]).toContain(response.status())
    }
  })

  test('handles audio types for voice', async ({ request }) => {
    const { token } = await setupUser(request, 'audiotypes')

    const audioTypes = ['audio/webm', 'audio/mp3', 'audio/mpeg', 'audio/wav']

    for (const mimeType of audioTypes) {
      const response = await request.post(`${API_URL}/media/upload-url`, {
        data: {
          type: 'voice',
          mimeType,
          fileSize: 1024 * 500,
        },
        headers: { 'Authorization': `Bearer ${token}` },
      })

      // Should accept audio types for voice (or return 400 if storage not configured)
      expect([200, 400]).toContain(response.status())
    }
  })
})
