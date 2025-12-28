/**
 * Banner Generation Service
 *
 * Uses Nano Banana Pro (Gemini 3 Pro Image) to create professional banners from avatars.
 * The banner is a stylized, expanded version of the avatar suitable for
 * a page header with premium aesthetic.
 *
 * Model: gemini-3-pro-image-preview (Nano Banana Pro)
 * - Supports aspect ratio: 16:9 (closest to header format)
 * - Resolution: 2K for high quality
 * - Advanced reasoning ("Thinking") for complex instructions
 */

import { GoogleGenAI } from '@google/genai'
import { env } from '../../config/env.js'
import { uploadBuffer } from '../storage.js'

// Banner configuration for Nano Banana Pro
const BANNER_ASPECT_RATIO = '16:9' as const  // Supported: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
const BANNER_RESOLUTION = '2K' as const      // Supported: 1K, 2K, 4K (uppercase K required)

// AI request timeout (90 seconds - Nano Banana Pro uses "Thinking" mode)
const AI_TIMEOUT_MS = 90000

// Timeout helper to prevent AI calls from hanging indefinitely
function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms)
    ),
  ])
}

interface BannerGenerationInput {
  avatarUrl: string
  userId: string
  serviceType?: string  // e.g., "fitness coach", "business consultant"
  displayName?: string
}

interface BannerGenerationResult {
  bannerUrl: string
  wasGenerated: boolean  // true if AI generated, false if fallback
}

// Initialize client (lazy - only when needed)
let aiClient: GoogleGenAI | null = null

function getClient(): GoogleGenAI {
  if (!env.GOOGLE_AI_API_KEY) {
    throw new Error('GOOGLE_AI_API_KEY is not configured')
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: env.GOOGLE_AI_API_KEY })
  }
  return aiClient
}

/**
 * Generate a professional banner from an avatar image.
 *
 * The prompt engineering focuses on:
 * 1. Maintaining the person's likeness from the avatar
 * 2. Creating a professional, clean aesthetic
 * 3. Using a dark/neutral background
 * 4. Proper framing for a wide banner format
 */
export async function generateBanner(
  input: BannerGenerationInput
): Promise<BannerGenerationResult> {
  const client = getClient()

  try {
    // Fetch avatar image as base64
    const avatarResponse = await fetch(input.avatarUrl)
    if (!avatarResponse.ok) {
      throw new Error(`Failed to fetch avatar: ${avatarResponse.status}`)
    }

    const avatarBuffer = await avatarResponse.arrayBuffer()
    const avatarBase64 = Buffer.from(avatarBuffer).toString('base64')
    const mimeType = avatarResponse.headers.get('content-type') || 'image/jpeg'

    // Craft the prompt for professional banner generation
    const prompt = buildBannerPrompt(input)

    const response = await withTimeout(
      client.models.generateContent({
        model: 'gemini-3-pro-image-preview',  // Nano Banana Pro
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType,
                  data: avatarBase64,
                },
              },
            ],
          },
        ],
        config: {
          // Nano Banana Pro image configuration
          responseModalities: ['IMAGE', 'TEXT'],
          imageConfig: {
            aspectRatio: BANNER_ASPECT_RATIO,
            imageSize: BANNER_RESOLUTION,
          },
        },
      }),
      AI_TIMEOUT_MS,
      'Banner generation'
    )

    // Extract generated image from response
    const candidate = response.candidates?.[0]
    if (!candidate?.content?.parts) {
      throw new Error('No content in response')
    }

    const imagePart = candidate.content.parts.find(
      (part: any) => part.inlineData?.mimeType?.startsWith('image/')
    )

    if (!imagePart?.inlineData?.data) {
      // AI didn't generate an image - use text editing fallback
      console.log('[banner] No image in response, using fallback')
      return generateFallbackBanner(input)
    }

    // Upload to R2
    const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64')
    const filename = `banners/${input.userId}-${Date.now()}.jpg`
    const bannerUrl = await uploadBuffer(imageBuffer, filename, 'image/jpeg')

    return {
      bannerUrl,
      wasGenerated: true,
    }
  } catch (error) {
    console.error('[banner] AI generation failed:', error)
    return generateFallbackBanner(input)
  }
}

/**
 * Build the prompt for banner generation.
 * Engineered for professional, clean output.
 */
function buildBannerPrompt(input: BannerGenerationInput): string {
  const serviceContext = input.serviceType
    ? `This person is a ${input.serviceType}.`
    : 'This is a professional service provider.'

  return `Create a professional banner image for a subscription page header.

INPUT: A portrait/headshot photo of a person.
OUTPUT: A wide banner image (${BANNER_WIDTH}x${BANNER_HEIGHT} pixels, 16:5 aspect ratio).

CRITICAL REQUIREMENTS:
1. PRESERVE the person's face and likeness EXACTLY from the input photo - do not alter their appearance
2. Extend the image horizontally to banner dimensions (wide format)
3. Use a SOLID DARK background - black, charcoal (#1a1a1a), or very dark navy (#0a0a1a)
4. Center the person in the frame
5. The person should be visible from roughly chest/shoulders up
6. Professional, clean aesthetic - like a LinkedIn banner or speaker page hero

MUST NOT INCLUDE:
- NO text, watermarks, or overlays
- NO busy patterns or distracting elements
- NO filters that alter skin tone or facial features
- NO cartoonish or illustrated styles - keep it photorealistic

STYLE GUIDANCE:
- Modern, minimal, professional
- Think: executive headshot meets speaker page hero
- Subtle professional lighting
- Slight vignette effect is acceptable
- The mood should convey expertise and trust

CONTEXT: ${serviceContext}

Generate the banner image only.`
}

/**
 * Fallback banner generation when AI fails.
 * Creates a simple banner by placing the avatar on a dark background.
 *
 * Note: This is a basic fallback. For production, consider:
 * - Using Sharp or Canvas for proper image composition
 * - Generating on the frontend with Canvas API
 */
async function generateFallbackBanner(
  input: BannerGenerationInput
): Promise<BannerGenerationResult> {
  // For the fallback, we'll create a simple dark banner with the avatar centered
  // This requires an image processing library like Sharp
  // For now, we'll return the avatar URL as a "banner" and let the frontend handle display

  // TODO: Implement proper fallback with Sharp when installed:
  // 1. Create black canvas (1200x375)
  // 2. Resize avatar to fit height
  // 3. Center avatar on canvas
  // 4. Upload to R2

  console.log('[banner] Using avatar as fallback banner for user:', input.userId)

  // Return avatar URL as fallback - frontend will display appropriately
  return {
    bannerUrl: input.avatarUrl,
    wasGenerated: false,
  }
}

/**
 * Check if banner generation is available.
 * Used to determine if we should show banner-related UI.
 */
export function isBannerGenerationAvailable(): boolean {
  return !!env.GOOGLE_AI_API_KEY
}
