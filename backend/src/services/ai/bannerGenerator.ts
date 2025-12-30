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
 *
 * Supports two style variants:
 * - 'standard': Clean, professional headshot (first generation)
 * - 'artistic': Dramatic, stylized portrait (regeneration)
 */

import { GoogleGenAI } from '@google/genai'
import { env } from '../../config/env.js'
import { uploadBuffer } from '../storage.js'

/**
 * Validate avatar URL to prevent SSRF attacks.
 * Only allows URLs from our R2 storage domain.
 */
function validateAvatarUrl(url: string): void {
  // Must be from our R2 public domain
  if (!url.startsWith(env.R2_PUBLIC_URL)) {
    throw new Error('Avatar URL must be from trusted storage domain')
  }

  // Defense-in-depth: parse and validate
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid avatar URL format')
  }

  // Block non-HTTPS (except in test)
  if (parsed.protocol !== 'https:' && process.env.NODE_ENV !== 'test') {
    throw new Error('Avatar URL must use HTTPS')
  }

  // Block any URL with credentials
  if (parsed.username || parsed.password) {
    throw new Error('Avatar URL cannot contain credentials')
  }
}

// Banner configuration for Nano Banana Pro
const BANNER_ASPECT_RATIO = '16:9' as const  // Supported: 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
const BANNER_RESOLUTION = '2K' as const      // Supported: 1K, 2K, 4K (uppercase K required)

// Model: Nano Banana Pro for high-quality banner generation
const IMAGE_MODEL = 'gemini-3-pro-image-preview' as const

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

// Style variant for banner generation
export type BannerVariant = 'standard' | 'artistic'

interface BannerGenerationInput {
  avatarUrl: string
  userId: string
  serviceType?: string  // e.g., "fitness coach", "business consultant"
  displayName?: string
  serviceDescription?: string  // Description of the service for context
  variant?: BannerVariant     // Style variant (default: 'standard')
}

interface BannerGenerationResult {
  bannerUrl: string
  wasGenerated: boolean  // true if AI generated, false if fallback
  variant: BannerVariant // Which variant was used
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
 *
 * @param input.variant - 'standard' for clean professional, 'artistic' for dramatic/stylized
 */
export async function generateBanner(
  input: BannerGenerationInput
): Promise<BannerGenerationResult> {
  const client = getClient()
  const variant = input.variant || 'standard'

  try {
    // Validate URL before fetching (SSRF protection)
    validateAvatarUrl(input.avatarUrl)

    // Fetch avatar image as base64 with timeout
    const AVATAR_FETCH_TIMEOUT = 10000 // 10 seconds
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), AVATAR_FETCH_TIMEOUT)

    let avatarResponse: Response
    try {
      avatarResponse = await fetch(input.avatarUrl, { signal: controller.signal })
      clearTimeout(timeoutId)
    } catch (err: any) {
      clearTimeout(timeoutId)
      if (err.name === 'AbortError') {
        throw new Error('Avatar fetch timed out')
      }
      throw err
    }

    if (!avatarResponse.ok) {
      throw new Error(`Failed to fetch avatar: ${avatarResponse.status}`)
    }

    const avatarBuffer = await avatarResponse.arrayBuffer()
    const avatarBase64 = Buffer.from(avatarBuffer).toString('base64')
    const mimeType = avatarResponse.headers.get('content-type') || 'image/jpeg'

    // Craft the prompt based on variant
    const prompt = variant === 'artistic'
      ? buildArtisticBannerPrompt(input)
      : buildStandardBannerPrompt(input)

    // Build contents as flat array (text + image) per API docs
    const contents = [
      { text: prompt },
      {
        inlineData: {
          mimeType,
          data: avatarBase64,
        },
      },
    ]

    console.log('[banner] Calling Nano Banana Pro with variant:', variant)

    const response = await withTimeout(
      client.models.generateContent({
        model: IMAGE_MODEL,
        contents,
        config: {
          // Nano Banana Pro image configuration
          responseModalities: ['TEXT', 'IMAGE'],
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
      return generateFallbackBanner(input, variant)
    }

    // Use actual MIME type from response, fallback to JPEG
    const responseMime = imagePart.inlineData.mimeType || 'image/jpeg'
    const extension = responseMime.includes('png') ? 'png' : 'jpg'

    // Upload to R2 with correct MIME type
    const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64')
    const filename = `banners/${input.userId}-${variant}-${Date.now()}.${extension}`
    const bannerUrl = await uploadBuffer(imageBuffer, filename, responseMime)

    return {
      bannerUrl,
      wasGenerated: true,
      variant,
    }
  } catch (error) {
    console.error('[banner] AI generation failed:', error)
    return generateFallbackBanner(input, variant)
  }
}

/**
 * Standard variant: Clean, professional style.
 * Used for first-time generation.
 */
function buildStandardBannerPrompt(input: BannerGenerationInput): string {
  const serviceContext = input.serviceDescription
    ? `Service context: ${input.serviceDescription.slice(0, 150)}`
    : ''

  return `Create a professional wide banner (16:9 aspect ratio) from this portrait photo.

COMPOSITION:
- Center the person horizontally in the frame
- Show head and upper body (shoulders visible)
- Face should be the clear focal point, positioned in upper-center area
- Leave space on left and right sides of the person

STYLE:
- Dark or black background (solid or subtle gradient)
- Professional, polished corporate look
- Preserve exact facial features and skin tone
- Expression: warm, confident smile - approachable and professional
- Good studio lighting that flatters the face
- Add professional attire if not visible (blazer, business wear)
- Clean, high-end aesthetic suitable for a business profile header

${serviceContext}

Do NOT add text, logos, or watermarks.`
}

/**
 * Artistic variant: Creative, stylized portrait.
 * Used for regeneration to give user variety.
 */
function buildArtisticBannerPrompt(input: BannerGenerationInput): string {
  const serviceContext = input.serviceDescription
    ? `Service context: ${input.serviceDescription.slice(0, 150)}`
    : ''

  return `Create a creative, artistic wide banner (16:9 aspect ratio) from this portrait photo.

COMPOSITION:
- Center the person horizontally in the frame
- Show head and upper body (shoulders visible)
- Face should be the clear focal point
- Cinematic framing with room to breathe on sides

STYLE:
- Be creative with lighting, colors, and atmosphere
- Dramatic or editorial photography style
- Preserve exact facial features and skin tone
- Expression: confident, charismatic - can be bold smile or strong presence
- Professional lighting that creates depth and dimension
- Can use creative backgrounds (gradients, bokeh, abstract)
- High-end fashion or editorial magazine aesthetic

${serviceContext}

Do NOT add text, logos, or watermarks.`
}

/**
 * Fallback banner generation when AI fails.
 * Returns the avatar URL as a fallback.
 */
async function generateFallbackBanner(
  input: BannerGenerationInput,
  variant: BannerVariant
): Promise<BannerGenerationResult> {
  console.log('[banner] Using avatar as fallback banner for user:', input.userId)

  // Return avatar URL as fallback - frontend will display appropriately
  return {
    bannerUrl: input.avatarUrl,
    wasGenerated: false,
    variant,
  }
}

/**
 * Check if banner generation is available.
 * Used to determine if we should show banner-related UI.
 */
export function isBannerGenerationAvailable(): boolean {
  return !!env.GOOGLE_AI_API_KEY
}
