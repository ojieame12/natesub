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

    // Use actual MIME type from response, fallback to JPEG
    const responseMime = imagePart.inlineData.mimeType || 'image/jpeg'
    const extension = responseMime.includes('png') ? 'png' : 'jpg'

    // Upload to R2 with correct MIME type
    const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64')
    const filename = `banners/${input.userId}-${Date.now()}.${extension}`
    const bannerUrl = await uploadBuffer(imageBuffer, filename, responseMime)

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
 * Engineered for premium, professional output using Nano Banana Pro's advanced capabilities.
 */
function buildBannerPrompt(input: BannerGenerationInput): string {
  // Industry-specific styling hints
  const industryStyles: Record<string, string> = {
    fitness: 'energetic, dynamic lighting with warm orange/gold accents, gym or outdoor sports aesthetic',
    coaching: 'warm, inviting atmosphere with soft natural lighting, inspirational and approachable',
    consulting: 'corporate elegance, cool blue/grey tones, minimalist office or city skyline backdrop',
    design: 'creative studio aesthetic, artistic lighting, modern and stylish with subtle color gradients',
    tech: 'futuristic, clean lines, subtle tech elements like code patterns or circuit motifs, blue/purple tones',
    education: 'academic warmth, library or study environment feel, welcoming and knowledgeable',
    creative: 'artistic flair, bold yet sophisticated, creative studio or gallery aesthetic',
    business: 'executive presence, premium corporate feel, subtle luxury with clean lines',
    health: 'calming, wellness-focused, soft greens or blues, clean and trustworthy',
    finance: 'sophisticated luxury, premium materials feel, dark tones with gold accents',
    marketing: 'bold and confident, dynamic energy, modern and trend-forward aesthetic',
  }

  const serviceType = input.serviceType?.toLowerCase() || ''
  const styleHint = industryStyles[serviceType] || 'professional, modern, trustworthy aesthetic'

  const serviceContext = input.serviceType
    ? `INDUSTRY: ${input.serviceType}\nSTYLE DIRECTION: ${styleHint}`
    : 'STYLE DIRECTION: Premium professional service provider aesthetic'

  return `You are a professional graphic designer creating a premium banner for a high-end subscription service.

TASK: Transform this headshot into a stunning wide banner that looks like it belongs on a premium SaaS landing page or executive speaker profile.

REFERENCE IMAGE: The attached photo shows the person who needs to appear in the banner.

CRITICAL REQUIREMENTS:
1. PRESERVE IDENTITY: The person's face, features, and likeness must be EXACTLY preserved
2. WIDE FORMAT: 16:9 aspect ratio banner suitable for a page header
3. PREMIUM AESTHETIC: This should look like a $10,000 photoshoot result
4. PROFESSIONAL COMPOSITION: Person positioned in the left third or center, with intentional negative space

VISUAL STYLE:
- ${styleHint}
- Studio-quality lighting with depth and dimension
- Rich, cinematic color grading (not flat or washed out)
- Subtle depth of field for professional photography feel
- Clean, uncluttered composition with breathing room

BACKGROUND TREATMENT:
- Dark, sophisticated backdrop (deep charcoal #1C1C1E, rich navy #0A1628, or elegant black)
- Can include subtle gradient or atmospheric lighting effects
- Optional: very subtle, abstract environmental elements matching the industry
- NO distracting patterns, NO text, NO logos

PHOTOGRAPHY QUALITY:
- Looks like shot with a Sony A7R IV or Hasselblad
- Professional retouching (subtle skin smoothing, not plastic)
- Catch lights in eyes preserved
- Natural, flattering shadow placement

${serviceContext}
${input.displayName ? `PERSON: ${input.displayName}` : ''}

PROHIBITED:
❌ Text overlays or watermarks
❌ Cartoon or illustrated styles
❌ Artificial or uncanny valley appearance
❌ Over-filtered or Instagram-style processing
❌ Stock photo generic look
❌ Altering facial features, skin tone, or identity

OUTPUT: Generate ONE premium banner image. Think "Apple keynote speaker banner" or "Y Combinator founder profile".`
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
