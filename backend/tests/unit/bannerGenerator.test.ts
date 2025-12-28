import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock storage module
vi.mock('../../src/services/storage.js', () => ({
  uploadBuffer: vi.fn().mockResolvedValue('https://r2.example.com/banners/test.jpg'),
}))

vi.mock('../../src/config/env.js', () => ({
  env: {
    GOOGLE_AI_API_KEY: 'test-api-key',
    R2_PUBLIC_URL: 'https://r2.example.com',
  },
}))

// Create a mock generateContent function we can control
const mockGenerateContent = vi.fn()

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}))

import { generateBanner, isBannerGenerationAvailable } from '../../src/services/ai/bannerGenerator'
import { uploadBuffer } from '../../src/services/storage.js'

describe('Banner Generator', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Mock global fetch for avatar fetching
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      headers: {
        get: (name: string) => name === 'content-type' ? 'image/jpeg' : null,
      },
    } as any)

    // Default mock response - successful image generation
    mockGenerateContent.mockResolvedValue({
      candidates: [{
        content: {
          parts: [{
            inlineData: {
              mimeType: 'image/jpeg',
              data: 'base64imagedata',
            },
          }],
        },
      }],
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('generateBanner', () => {
    it('generates banner from avatar using Gemini', async () => {
      const result = await generateBanner({
        avatarUrl: 'https://example.com/avatar.jpg',
        userId: 'user-123',
        serviceType: 'fitness coach',
      })

      expect(result.bannerUrl).toContain('banners/')
      expect(result.wasGenerated).toBe(true)
      expect(mockGenerateContent).toHaveBeenCalled()
      expect(uploadBuffer).toHaveBeenCalled()
    })

    it('includes service type in prompt when provided', async () => {
      await generateBanner({
        avatarUrl: 'https://example.com/avatar.jpg',
        userId: 'user-123',
        serviceType: 'business consultant',
      })

      // Check the prompt includes service type
      const callArgs = mockGenerateContent.mock.calls[0][0]
      const promptText = callArgs.contents[0].parts[0].text
      expect(promptText).toContain('business consultant')
    })

    it('uses fallback when no image in response', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        candidates: [{
          content: {
            parts: [{ text: 'No image generated' }],
          },
        }],
      })

      const result = await generateBanner({
        avatarUrl: 'https://example.com/avatar.jpg',
        userId: 'user-123',
      })

      expect(result.wasGenerated).toBe(false)
      expect(result.bannerUrl).toBe('https://example.com/avatar.jpg')
    })

    it('uses fallback when Gemini throws error', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('API Error'))

      const result = await generateBanner({
        avatarUrl: 'https://example.com/avatar.jpg',
        userId: 'user-123',
      })

      expect(result.wasGenerated).toBe(false)
      expect(result.bannerUrl).toBe('https://example.com/avatar.jpg')
    })

    it('uses fallback when avatar fetch fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      } as any)

      const result = await generateBanner({
        avatarUrl: 'https://example.com/avatar.jpg',
        userId: 'user-123',
      })

      expect(result.wasGenerated).toBe(false)
    })

    it('uses correct model for image generation', async () => {
      await generateBanner({
        avatarUrl: 'https://example.com/avatar.jpg',
        userId: 'user-123',
      })

      const callArgs = mockGenerateContent.mock.calls[0][0]
      expect(callArgs.model).toBe('gemini-2.0-flash-exp')
    })
  })

  describe('isBannerGenerationAvailable', () => {
    it('returns true when API key is configured', () => {
      expect(isBannerGenerationAvailable()).toBe(true)
    })
  })
})
