import { beforeEach, describe, expect, it, vi, afterAll } from 'vitest'
import { createHmac } from 'crypto'
import app from '../../src/app.js'
import { db } from '../../src/db/client.js'
import { dbStorage } from '../setup.js'
import { env } from '../../src/config/env.js'

// Mock storage service
vi.mock('../../src/services/storage.js', () => ({
  getSignedUploadUrl: vi.fn(),
}))

import { getSignedUploadUrl } from '../../src/services/storage.js'

const mockGetSignedUploadUrl = vi.mocked(getSignedUploadUrl)

// Hash function matching auth service
function hashToken(token: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex')
}

// Helper to create a test user with session
async function createTestUserWithSession() {
  const user = await db.user.create({
    data: { email: `media-test-${Date.now()}@test.com` },
  })

  const rawToken = `test-session-${Date.now()}`
  const hashedToken = hashToken(rawToken)

  const session = await db.session.create({
    data: {
      userId: user.id,
      token: hashedToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  })

  dbStorage.sessions.set(session.id, { ...session, user })

  return { user, session, rawToken }
}

// Helper to make authenticated request
function authRequest(path: string, options: RequestInit = {}, rawToken: string) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session=${rawToken}`,
        ...options.headers,
      },
    })
  )
}

// Helper to make public request
function publicRequest(path: string, options: RequestInit = {}) {
  return app.fetch(
    new Request(`http://localhost${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    })
  )
}

describe('media routes', () => {
  beforeEach(() => {
    Object.values(dbStorage).forEach(store => store.clear())
    vi.clearAllMocks()
  })

  afterAll(() => {
    Object.values(dbStorage).forEach(store => store.clear())
  })

  describe('POST /media/upload-url', () => {
    it('requires authentication', async () => {
      const res = await publicRequest('/media/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          type: 'avatar',
          mimeType: 'image/jpeg',
        }),
      })

      expect(res.status).toBe(401)
    })

    it('returns signed URL for avatar upload', async () => {
      const { rawToken, user } = await createTestUserWithSession()

      const mockResult = {
        uploadUrl: 'https://r2.example.com/signed-url?token=abc',
        publicUrl: 'https://cdn.example.com/avatars/user123/abc.jpeg',
        key: 'avatars/user123/abc.jpeg',
        expiresAt: new Date(Date.now() + 600 * 1000),
        maxBytes: 10 * 1024 * 1024,
      }
      mockGetSignedUploadUrl.mockResolvedValue(mockResult)

      const res = await authRequest('/media/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          type: 'avatar',
          mimeType: 'image/jpeg',
        }),
      }, rawToken)

      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.uploadUrl).toBe(mockResult.uploadUrl)
      expect(body.publicUrl).toBe(mockResult.publicUrl)
      expect(body.key).toBe(mockResult.key)
      expect(body.maxBytes).toBe(mockResult.maxBytes)

      expect(mockGetSignedUploadUrl).toHaveBeenCalledWith(
        user.id,
        'avatar',
        'image/jpeg',
        undefined
      )
    })

    it('returns signed URL for photo upload', async () => {
      const { rawToken, user } = await createTestUserWithSession()

      const mockResult = {
        uploadUrl: 'https://r2.example.com/signed-url?token=def',
        publicUrl: 'https://cdn.example.com/photos/user123/def.png',
        key: 'photos/user123/def.png',
        expiresAt: new Date(Date.now() + 600 * 1000),
        maxBytes: 15 * 1024 * 1024,
      }
      mockGetSignedUploadUrl.mockResolvedValue(mockResult)

      const res = await authRequest('/media/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          type: 'photo',
          mimeType: 'image/png',
        }),
      }, rawToken)

      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.uploadUrl).toBe(mockResult.uploadUrl)
      expect(mockGetSignedUploadUrl).toHaveBeenCalledWith(
        user.id,
        'photo',
        'image/png',
        undefined
      )
    })

    it('returns signed URL for voice upload', async () => {
      const { rawToken, user } = await createTestUserWithSession()

      const mockResult = {
        uploadUrl: 'https://r2.example.com/signed-url?token=ghi',
        publicUrl: 'https://cdn.example.com/voices/user123/ghi.webm',
        key: 'voices/user123/ghi.webm',
        expiresAt: new Date(Date.now() + 600 * 1000),
        maxBytes: 10 * 1024 * 1024,
      }
      mockGetSignedUploadUrl.mockResolvedValue(mockResult)

      const res = await authRequest('/media/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          type: 'voice',
          mimeType: 'audio/webm',
        }),
      }, rawToken)

      expect(res.status).toBe(200)
      const body = await res.json()

      expect(body.uploadUrl).toBe(mockResult.uploadUrl)
      expect(mockGetSignedUploadUrl).toHaveBeenCalledWith(
        user.id,
        'voice',
        'audio/webm',
        undefined
      )
    })

    it('passes optional fileName to storage service', async () => {
      const { rawToken, user } = await createTestUserWithSession()

      const mockResult = {
        uploadUrl: 'https://r2.example.com/signed-url?token=xyz',
        publicUrl: 'https://cdn.example.com/avatars/user123/xyz.jpeg',
        key: 'avatars/user123/xyz.jpeg',
        expiresAt: new Date(Date.now() + 600 * 1000),
        maxBytes: 10 * 1024 * 1024,
      }
      mockGetSignedUploadUrl.mockResolvedValue(mockResult)

      const res = await authRequest('/media/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          type: 'avatar',
          mimeType: 'image/jpeg',
          fileName: 'my-avatar.jpg',
        }),
      }, rawToken)

      expect(res.status).toBe(200)

      expect(mockGetSignedUploadUrl).toHaveBeenCalledWith(
        user.id,
        'avatar',
        'image/jpeg',
        'my-avatar.jpg'
      )
    })

    it('rejects invalid upload type', async () => {
      const { rawToken } = await createTestUserWithSession()

      const res = await authRequest('/media/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          type: 'invalid-type',
          mimeType: 'image/jpeg',
        }),
      }, rawToken)

      expect(res.status).toBe(400)
    })

    it('rejects missing mimeType', async () => {
      const { rawToken } = await createTestUserWithSession()

      const res = await authRequest('/media/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          type: 'avatar',
        }),
      }, rawToken)

      expect(res.status).toBe(400)
    })

    it('returns 400 when storage service throws error', async () => {
      const { rawToken } = await createTestUserWithSession()

      mockGetSignedUploadUrl.mockRejectedValue(
        new Error('Invalid file type. Allowed: image/jpeg, image/png, image/webp')
      )

      const res = await authRequest('/media/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          type: 'avatar',
          mimeType: 'application/pdf',
        }),
      }, rawToken)

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('Invalid file type')
    })

    it('handles storage service failure gracefully', async () => {
      const { rawToken } = await createTestUserWithSession()

      mockGetSignedUploadUrl.mockRejectedValue(new Error('R2 service unavailable'))

      const res = await authRequest('/media/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          type: 'avatar',
          mimeType: 'image/jpeg',
        }),
      }, rawToken)

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('R2 service unavailable')
    })

    it('handles non-Error exceptions', async () => {
      const { rawToken } = await createTestUserWithSession()

      mockGetSignedUploadUrl.mockRejectedValue('Unknown error')

      const res = await authRequest('/media/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          type: 'avatar',
          mimeType: 'image/jpeg',
        }),
      }, rawToken)

      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Upload failed')
    })
  })
})
