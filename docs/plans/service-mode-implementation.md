# Service Mode Implementation Plan

## Overview

Implement differentiated public page experience for **Service users** (Retainer mode) vs **Support users**:

| Mode | Trigger | Header | Perks | Badge |
|------|---------|--------|-------|-------|
| **Retainer** | `purpose: 'service'` | Full-width banner (generated) | 3 AI-generated perks | "Retainer" |
| **Support** | All other purposes | Small circular avatar | None | Purpose-based |

---

## Phase 1: Schema Migration

### 1.1 Add bannerUrl to Profile

**File: `backend/prisma/schema.prisma`**

```prisma
model Profile {
  // ... existing fields

  // Service Mode Assets
  bannerUrl     String?   // Generated banner image URL (R2)

  // perks already exists (line 206)
}
```

### 1.2 Migration Script

```bash
npx prisma migrate dev --name add_banner_url
```

### 1.3 Tests

**File: `backend/tests/unit/schema.test.ts`**

```typescript
describe('Profile schema', () => {
  it('allows null bannerUrl', async () => {
    const profile = await db.profile.create({
      data: { ...minimalProfile, bannerUrl: null }
    })
    expect(profile.bannerUrl).toBeNull()
  })

  it('stores bannerUrl', async () => {
    const profile = await db.profile.create({
      data: { ...minimalProfile, bannerUrl: 'https://r2.example.com/banners/123.jpg' }
    })
    expect(profile.bannerUrl).toBe('https://r2.example.com/banners/123.jpg')
  })
})
```

---

## Phase 2: AI Banner Generation Service

### 2.1 Gemini Imagen Integration

**File: `backend/src/services/ai/bannerGenerator.ts`**

```typescript
/**
 * Banner Generation Service
 *
 * Uses Gemini's Imagen 3 to generate professional banners from avatar.
 * The banner is a stylized, expanded version of the avatar suitable for
 * a page header (16:5 aspect ratio, ~1200x375px).
 */

import { GoogleGenAI } from '@google/genai'
import { env } from '../../config/env.js'
import { uploadToR2 } from '../storage.js'

// Banner dimensions (16:5 aspect ratio for mobile-first design)
const BANNER_WIDTH = 1200
const BANNER_HEIGHT = 375

interface BannerGenerationInput {
  avatarUrl: string
  userId: string
  serviceType?: string  // e.g., "fitness coach", "business consultant"
  displayName?: string
}

interface BannerGenerationResult {
  bannerUrl: string
  generationId: string
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
  const client = new GoogleGenAI({ apiKey: env.GOOGLE_AI_API_KEY })

  // Fetch avatar image as base64
  const avatarResponse = await fetch(input.avatarUrl)
  const avatarBuffer = await avatarResponse.arrayBuffer()
  const avatarBase64 = Buffer.from(avatarBuffer).toString('base64')
  const mimeType = avatarResponse.headers.get('content-type') || 'image/jpeg'

  // Craft the prompt for professional banner generation
  const prompt = buildBannerPrompt(input)

  const response = await client.models.generateContent({
    model: 'gemini-2.0-flash-exp',  // Use experimental for image generation
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
    generationConfig: {
      responseModalities: ['image', 'text'],
      responseMimeType: 'image/jpeg',
    },
  })

  // Extract generated image
  const imagePart = response.candidates?.[0]?.content?.parts?.find(
    (part: any) => part.inlineData?.mimeType?.startsWith('image/')
  )

  if (!imagePart?.inlineData?.data) {
    throw new Error('No image generated')
  }

  // Upload to R2
  const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64')
  const filename = `banners/${input.userId}-${Date.now()}.jpg`
  const bannerUrl = await uploadToR2(imageBuffer, filename, 'image/jpeg')

  return {
    bannerUrl,
    generationId: response.candidates?.[0]?.content?.parts?.[0]?.text || '',
  }
}

function buildBannerPrompt(input: BannerGenerationInput): string {
  const serviceContext = input.serviceType
    ? `This person is a ${input.serviceType}.`
    : 'This is a professional service provider.'

  return `Create a professional banner image for a subscription page.

INPUT: A portrait/headshot photo of a person.
OUTPUT: A wide banner (${BANNER_WIDTH}x${BANNER_HEIGHT}px, 16:5 aspect ratio).

REQUIREMENTS:
1. PRESERVE the person's face and likeness exactly from the input photo
2. Extend the image to banner dimensions (wide format)
3. Use a DARK, SOLID background (black, dark gray, or very dark navy)
4. Center the person in the frame
5. Professional, clean aesthetic - like a LinkedIn banner or speaker page
6. The person should be visible from roughly chest/shoulders up
7. NO text, watermarks, or overlays
8. NO busy patterns or distracting elements
9. Subtle professional lighting, slight vignette is OK

CONTEXT: ${serviceContext}

STYLE: Modern, minimal, professional. Think: executive headshot meets speaker page hero.
The mood should convey expertise and trust.

Generate ONLY the image, no text response.`
}

/**
 * Fallback: Simple banner with centered avatar on black background
 * Used if AI generation fails or is unavailable.
 */
export async function generateSimpleBanner(
  avatarUrl: string,
  userId: string
): Promise<string> {
  // Use Sharp or Canvas to create simple banner
  // 1. Create black canvas (1200x375)
  // 2. Resize avatar to fit height
  // 3. Center avatar on canvas
  // 4. Upload to R2

  // Implementation using Sharp:
  const sharp = (await import('sharp')).default

  // Fetch avatar
  const avatarResponse = await fetch(avatarUrl)
  const avatarBuffer = Buffer.from(await avatarResponse.arrayBuffer())

  // Resize avatar to fit banner height with padding
  const avatarHeight = BANNER_HEIGHT - 40 // 20px padding top/bottom
  const resizedAvatar = await sharp(avatarBuffer)
    .resize({ height: avatarHeight, fit: 'inside' })
    .toBuffer()

  // Get resized dimensions
  const metadata = await sharp(resizedAvatar).metadata()
  const avatarWidth = metadata.width || avatarHeight

  // Create banner with centered avatar
  const banner = await sharp({
    create: {
      width: BANNER_WIDTH,
      height: BANNER_HEIGHT,
      channels: 3,
      background: { r: 0, g: 0, b: 0 }, // Black background
    },
  })
    .composite([
      {
        input: resizedAvatar,
        left: Math.floor((BANNER_WIDTH - avatarWidth) / 2),
        top: Math.floor((BANNER_HEIGHT - avatarHeight) / 2),
      },
    ])
    .jpeg({ quality: 90 })
    .toBuffer()

  // Upload to R2
  const filename = `banners/${userId}-${Date.now()}.jpg`
  return uploadToR2(banner, filename, 'image/jpeg')
}
```

### 2.2 Tests for Banner Generation

**File: `backend/tests/unit/bannerGenerator.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateBanner, generateSimpleBanner } from '../../src/services/ai/bannerGenerator'

// Mock dependencies
vi.mock('@google/genai')
vi.mock('../../src/services/storage.js', () => ({
  uploadToR2: vi.fn().mockResolvedValue('https://r2.example.com/banners/test.jpg'),
}))

describe('Banner Generator', () => {
  describe('generateBanner', () => {
    it('generates banner from avatar using Gemini', async () => {
      // Mock Gemini response with image
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            candidates: [{
              content: {
                parts: [{
                  inlineData: {
                    mimeType: 'image/jpeg',
                    data: 'base64imagedata...',
                  },
                }],
              },
            }],
          }),
        },
      }

      vi.mocked(GoogleGenAI).mockImplementation(() => mockClient as any)

      const result = await generateBanner({
        avatarUrl: 'https://example.com/avatar.jpg',
        userId: 'user-123',
        serviceType: 'fitness coach',
      })

      expect(result.bannerUrl).toContain('banners/')
      expect(mockClient.models.generateContent).toHaveBeenCalled()
    })

    it('includes service type in prompt when provided', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            candidates: [{
              content: {
                parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'xxx' } }],
              },
            }],
          }),
        },
      }

      vi.mocked(GoogleGenAI).mockImplementation(() => mockClient as any)

      await generateBanner({
        avatarUrl: 'https://example.com/avatar.jpg',
        userId: 'user-123',
        serviceType: 'business consultant',
      })

      const callArgs = mockClient.models.generateContent.mock.calls[0][0]
      expect(callArgs.contents[0].parts[0].text).toContain('business consultant')
    })

    it('throws error when no image generated', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            candidates: [{ content: { parts: [{ text: 'No image' }] } }],
          }),
        },
      }

      vi.mocked(GoogleGenAI).mockImplementation(() => mockClient as any)

      await expect(generateBanner({
        avatarUrl: 'https://example.com/avatar.jpg',
        userId: 'user-123',
      })).rejects.toThrow('No image generated')
    })
  })

  describe('generateSimpleBanner', () => {
    it('creates banner with centered avatar on black background', async () => {
      // Mock fetch for avatar
      global.fetch = vi.fn().mockResolvedValue({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      })

      const result = await generateSimpleBanner(
        'https://example.com/avatar.jpg',
        'user-123'
      )

      expect(result).toContain('banners/')
    })
  })
})
```

---

## Phase 3: AI Perks Generation Service

### 3.1 Perks Generator

**File: `backend/src/services/ai/perksGenerator.ts`**

```typescript
/**
 * Perks Generation Service
 *
 * Generates exactly 3 professional service perks based on:
 * - Service type/industry
 * - Price point (higher price = more premium perks)
 * - Creator's description
 */

import { GoogleGenAI } from '@google/genai'
import { env } from '../../config/env.js'

interface PerksInput {
  serviceDescription: string
  serviceType?: string      // e.g., "fitness coaching", "business consulting"
  industry?: string         // e.g., "health", "finance", "tech"
  pricePerMonth: number     // Used to calibrate perk value
  displayName?: string
}

interface Perk {
  id: string
  title: string
}

/**
 * Generate exactly 3 perks for a service-based subscription.
 *
 * Prompt engineering priorities:
 * 1. Exactly 3 perks - no more, no less
 * 2. Specific and tangible (not vague like "support")
 * 3. Action-oriented (start with verbs or nouns implying action)
 * 4. Calibrated to price point
 * 5. Industry-appropriate language
 */
export async function generatePerks(input: PerksInput): Promise<Perk[]> {
  const client = new GoogleGenAI({ apiKey: env.GOOGLE_AI_API_KEY })

  const prompt = buildPerksPrompt(input)

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ text: prompt }],
    generationConfig: {
      temperature: 0.7,  // Some creativity, but controlled
      maxOutputTokens: 500,
    },
  })

  const text = response.text?.trim() || ''

  try {
    const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim()
    const parsed = JSON.parse(jsonStr)

    // Validate exactly 3 perks
    if (!Array.isArray(parsed.perks) || parsed.perks.length !== 3) {
      throw new Error('Invalid perks count')
    }

    // Add IDs and return
    return parsed.perks.map((title: string, index: number) => ({
      id: `perk-${Date.now()}-${index}`,
      title,
    }))
  } catch (error) {
    console.error('Failed to parse perks response:', text)
    // Fallback to generic perks
    return getGenericPerks(input.serviceType)
  }
}

function buildPerksPrompt(input: PerksInput): string {
  // Determine tier based on price
  const tier = input.pricePerMonth >= 500 ? 'premium'
    : input.pricePerMonth >= 100 ? 'mid-tier'
    : 'entry-level'

  const industryContext = input.industry
    ? `Industry: ${input.industry}`
    : ''

  const serviceContext = input.serviceType
    ? `Service type: ${input.serviceType}`
    : ''

  return `You are a subscription page copywriter. Generate EXACTLY 3 perks for a ${tier} service subscription.

CONTEXT:
- Description: "${input.serviceDescription}"
${serviceContext}
${industryContext}
- Price: $${input.pricePerMonth}/month
- Creator: ${input.displayName || 'Service provider'}

RULES:
1. Generate EXACTLY 3 perks - not 2, not 4, exactly 3
2. Each perk should be 2-5 words
3. Start with action verbs OR tangible nouns
4. Be SPECIFIC to the service (no generic "24/7 support")
5. Match the value to the price tier (${tier})
6. Use sentence case (capitalize first word only)

PRICE TIER GUIDANCE:
- Entry-level ($10-99): Basic access perks (e.g., "Weekly check-ins", "Resource library access")
- Mid-tier ($100-499): Active engagement perks (e.g., "Bi-weekly strategy calls", "Custom action plans")
- Premium ($500+): High-touch perks (e.g., "Daily coaching sessions", "On-call access 24/7", "Personalized programs")

GOOD EXAMPLES by industry:
- Fitness: "Custom meal plans", "Weekly workout updates", "Direct messaging access"
- Business: "Monthly strategy calls", "Pitch deck reviews", "Investor introductions"
- Design: "Unlimited revision rounds", "Priority project slots", "Brand asset library"
- Tech: "Code reviews weekly", "Architecture consultations", "Slack channel access"

BAD EXAMPLES (too vague):
- "Support" ❌
- "Help when you need it" ❌
- "Access to resources" ❌
- "Regular updates" ❌

Respond with ONLY this JSON:
{
  "perks": [
    "Perk one text",
    "Perk two text",
    "Perk three text"
  ]
}

CRITICAL: Exactly 3 perks. Count them. JSON only.`
}

/**
 * Fallback perks when AI generation fails
 */
function getGenericPerks(serviceType?: string): Perk[] {
  const now = Date.now()

  // Industry-specific fallbacks
  const fallbacks: Record<string, string[]> = {
    'fitness': ['Custom workout plans', 'Weekly check-ins', 'Direct message access'],
    'coaching': ['Monthly strategy calls', 'Personalized feedback', 'Resource library access'],
    'consulting': ['Bi-weekly consulting calls', 'Priority email support', 'Custom recommendations'],
    'design': ['Unlimited revisions', 'Priority project queue', 'Source file access'],
    'default': ['Monthly 1-on-1 sessions', 'Priority support access', 'Exclusive resources'],
  }

  const perks = fallbacks[serviceType?.toLowerCase() || ''] || fallbacks.default

  return perks.map((title, i) => ({
    id: `perk-${now}-${i}`,
    title,
  }))
}

/**
 * Infer service type from description
 */
export async function inferServiceType(description: string): Promise<string> {
  const client = new GoogleGenAI({ apiKey: env.GOOGLE_AI_API_KEY })

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{
      text: `Categorize this service description into ONE of these industries:
fitness, coaching, consulting, design, tech, education, creative, business, health, finance, marketing, other

Description: "${description}"

Respond with ONLY the category word, nothing else.`
    }],
  })

  return response.text?.trim().toLowerCase() || 'other'
}
```

### 3.2 Tests for Perks Generation

**File: `backend/tests/unit/perksGenerator.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generatePerks, inferServiceType } from '../../src/services/ai/perksGenerator'

vi.mock('@google/genai')

describe('Perks Generator', () => {
  describe('generatePerks', () => {
    it('generates exactly 3 perks', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: JSON.stringify({
              perks: ['Custom meal plans', 'Weekly check-ins', 'Direct messaging'],
            }),
          }),
        },
      }

      vi.mocked(GoogleGenAI).mockImplementation(() => mockClient as any)

      const perks = await generatePerks({
        serviceDescription: 'Personal fitness coaching',
        pricePerMonth: 200,
      })

      expect(perks).toHaveLength(3)
      expect(perks[0]).toHaveProperty('id')
      expect(perks[0]).toHaveProperty('title')
    })

    it('uses premium perks for high price tier', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: JSON.stringify({
              perks: ['Daily coaching sessions', 'On-call access 24/7', 'Custom programs'],
            }),
          }),
        },
      }

      vi.mocked(GoogleGenAI).mockImplementation(() => mockClient as any)

      await generatePerks({
        serviceDescription: 'Executive coaching',
        pricePerMonth: 1000,
      })

      const prompt = mockClient.models.generateContent.mock.calls[0][0].contents[0].text
      expect(prompt).toContain('premium')
    })

    it('falls back to generic perks on parse error', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: 'invalid json',
          }),
        },
      }

      vi.mocked(GoogleGenAI).mockImplementation(() => mockClient as any)

      const perks = await generatePerks({
        serviceDescription: 'Fitness coaching',
        serviceType: 'fitness',
        pricePerMonth: 100,
      })

      expect(perks).toHaveLength(3)
      expect(perks[0].title).toBe('Custom workout plans')
    })

    it('falls back when AI returns wrong perk count', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: JSON.stringify({
              perks: ['Only one perk'],  // Wrong count
            }),
          }),
        },
      }

      vi.mocked(GoogleGenAI).mockImplementation(() => mockClient as any)

      const perks = await generatePerks({
        serviceDescription: 'Generic service',
        pricePerMonth: 50,
      })

      expect(perks).toHaveLength(3)  // Falls back to default
    })
  })

  describe('inferServiceType', () => {
    it('categorizes fitness description', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: 'fitness',
          }),
        },
      }

      vi.mocked(GoogleGenAI).mockImplementation(() => mockClient as any)

      const type = await inferServiceType('I help people lose weight and build muscle')
      expect(type).toBe('fitness')
    })

    it('returns lowercase category', async () => {
      const mockClient = {
        models: {
          generateContent: vi.fn().mockResolvedValue({
            text: 'CONSULTING',
          }),
        },
      }

      vi.mocked(GoogleGenAI).mockImplementation(() => mockClient as any)

      const type = await inferServiceType('Business strategy advice')
      expect(type).toBe('consulting')
    })
  })
})
```

---

## Phase 4: Backend API Updates

### 4.1 Update Profile Routes

**File: `backend/src/routes/profile.ts`** (additions)

```typescript
import { generateBanner, generateSimpleBanner } from '../services/ai/bannerGenerator.js'
import { generatePerks, inferServiceType } from '../services/ai/perksGenerator.js'

// ============================================
// SERVICE MODE ASSETS
// ============================================

// Generate banner from avatar
profile.post('/generate-banner', requireAuth, async (c) => {
  const userId = c.get('userId')

  const userProfile = await db.profile.findUnique({
    where: { userId },
    select: { avatarUrl: true, purpose: true, displayName: true },
  })

  if (!userProfile?.avatarUrl) {
    return c.json({ error: 'Avatar required to generate banner' }, 400)
  }

  try {
    // Try AI generation first
    const result = await generateBanner({
      avatarUrl: userProfile.avatarUrl,
      userId,
      displayName: userProfile.displayName || undefined,
    })

    // Save to profile
    await db.profile.update({
      where: { userId },
      data: { bannerUrl: result.bannerUrl },
    })

    return c.json({ bannerUrl: result.bannerUrl })
  } catch (error) {
    console.error('[banner] AI generation failed, using fallback:', error)

    // Fallback to simple banner
    const bannerUrl = await generateSimpleBanner(userProfile.avatarUrl, userId)

    await db.profile.update({
      where: { userId },
      data: { bannerUrl },
    })

    return c.json({ bannerUrl, fallback: true })
  }
})

// Generate perks for service mode
profile.post('/generate-perks', requireAuth, async (c) => {
  const userId = c.get('userId')

  const body = await c.req.json()
  const { description, pricePerMonth } = body

  if (!description || typeof pricePerMonth !== 'number') {
    return c.json({ error: 'description and pricePerMonth required' }, 400)
  }

  const userProfile = await db.profile.findUnique({
    where: { userId },
    select: { displayName: true },
  })

  try {
    // Infer service type from description
    const serviceType = await inferServiceType(description)

    // Generate perks
    const perks = await generatePerks({
      serviceDescription: description,
      serviceType,
      pricePerMonth,
      displayName: userProfile?.displayName || undefined,
    })

    // Save to profile
    await db.profile.update({
      where: { userId },
      data: { perks },
    })

    return c.json({ perks, serviceType })
  } catch (error) {
    console.error('[perks] Generation failed:', error)
    return c.json({ error: 'Failed to generate perks' }, 500)
  }
})

// Update perks manually
profile.patch('/perks', requireAuth, zValidator('json', z.object({
  perks: z.array(z.object({
    id: z.string(),
    title: z.string().min(1).max(100),
  })).length(3),  // Always exactly 3
})), async (c) => {
  const userId = c.get('userId')
  const { perks } = c.req.valid('json')

  await db.profile.update({
    where: { userId },
    data: { perks },
  })

  return c.json({ success: true, perks })
})
```

### 4.2 Update GET /users/:username

**File: `backend/src/routes/users.ts`** (update select)

```typescript
// Add to the select in GET /users/:username:
select: {
  // ... existing fields
  bannerUrl: true,
  perks: true,
  purpose: true,
}

// Add to response transformation:
const response = {
  // ... existing fields
  bannerUrl: profile.purpose === 'service' ? profile.bannerUrl : null,
  perks: profile.purpose === 'service' ? profile.perks : null,
  displayMode: profile.purpose === 'service' ? 'retainer' : 'support',
}
```

### 4.3 API Integration Tests

**File: `backend/tests/integration/serviceMode.test.ts`**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestUser, cleanupTestUser, getAuthHeaders } from '../helpers/auth'

describe('Service Mode API', () => {
  let testUser: any
  let headers: Record<string, string>

  beforeAll(async () => {
    testUser = await createTestUser({ purpose: 'service' })
    headers = await getAuthHeaders(testUser.id)
  })

  afterAll(async () => {
    await cleanupTestUser(testUser.id)
  })

  describe('POST /profile/generate-banner', () => {
    it('returns 400 without avatar', async () => {
      const res = await fetch('/api/profile/generate-banner', {
        method: 'POST',
        headers,
      })
      expect(res.status).toBe(400)
    })

    it('generates banner from avatar', async () => {
      // First set avatar
      await db.profile.update({
        where: { userId: testUser.id },
        data: { avatarUrl: 'https://example.com/avatar.jpg' },
      })

      const res = await fetch('/api/profile/generate-banner', {
        method: 'POST',
        headers,
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.bannerUrl).toContain('banners/')
    })
  })

  describe('POST /profile/generate-perks', () => {
    it('generates exactly 3 perks', async () => {
      const res = await fetch('/api/profile/generate-perks', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          description: 'Personal fitness coaching and nutrition planning',
          pricePerMonth: 200,
        }),
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.perks).toHaveLength(3)
      expect(data.serviceType).toBeDefined()
    })

    it('returns 400 without required fields', async () => {
      const res = await fetch('/api/profile/generate-perks', {
        method: 'POST',
        headers,
        body: JSON.stringify({ description: 'test' }),
      })
      expect(res.status).toBe(400)
    })
  })

  describe('PATCH /profile/perks', () => {
    it('requires exactly 3 perks', async () => {
      const res = await fetch('/api/profile/perks', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          perks: [{ id: '1', title: 'Perk 1' }],  // Only 1 perk
        }),
      })
      expect(res.status).toBe(400)
    })

    it('updates perks successfully', async () => {
      const perks = [
        { id: '1', title: 'Custom meal plans' },
        { id: '2', title: 'Weekly check-ins' },
        { id: '3', title: 'Direct messaging' },
      ]

      const res = await fetch('/api/profile/perks', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ perks }),
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.perks).toEqual(perks)
    })
  })

  describe('GET /users/:username (service mode)', () => {
    it('returns bannerUrl and perks for service users', async () => {
      // Setup profile with banner and perks
      await db.profile.update({
        where: { userId: testUser.id },
        data: {
          purpose: 'service',
          bannerUrl: 'https://example.com/banner.jpg',
          perks: [
            { id: '1', title: 'Perk 1' },
            { id: '2', title: 'Perk 2' },
            { id: '3', title: 'Perk 3' },
          ],
        },
      })

      const res = await fetch(`/api/users/${testUser.username}`)
      const data = await res.json()

      expect(data.displayMode).toBe('retainer')
      expect(data.bannerUrl).toBe('https://example.com/banner.jpg')
      expect(data.perks).toHaveLength(3)
    })

    it('returns null bannerUrl/perks for non-service users', async () => {
      await db.profile.update({
        where: { userId: testUser.id },
        data: { purpose: 'support' },
      })

      const res = await fetch(`/api/users/${testUser.username}`)
      const data = await res.json()

      expect(data.displayMode).toBe('support')
      expect(data.bannerUrl).toBeNull()
      expect(data.perks).toBeNull()
    })
  })
})
```

---

## Phase 5: Onboarding Flow Updates

### 5.1 New Perks Step Component

**File: `src/onboarding/ServicePerksStep.tsx`**

```tsx
/**
 * ServicePerksStep
 *
 * Shown only for purpose: 'service' users.
 * Displays AI-generated perks with ability to edit.
 * Always shows exactly 3 perks.
 */

import { useState, useEffect } from 'react'
import { Check, Edit2, Sparkles, Loader2 } from 'lucide-react'
import { api } from '../api/client'

interface Perk {
  id: string
  title: string
}

interface ServicePerksStepProps {
  description: string
  price: number
  onComplete: (perks: Perk[]) => void
  onBack: () => void
}

export function ServicePerksStep({
  description,
  price,
  onComplete,
  onBack
}: ServicePerksStepProps) {
  const [perks, setPerks] = useState<Perk[]>([])
  const [isGenerating, setIsGenerating] = useState(true)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')

  useEffect(() => {
    generatePerks()
  }, [])

  const generatePerks = async () => {
    setIsGenerating(true)
    try {
      const result = await api.profile.generatePerks({
        description,
        pricePerMonth: price,
      })
      setPerks(result.perks)
    } catch (error) {
      // Fallback perks
      setPerks([
        { id: '1', title: 'Monthly 1-on-1 sessions' },
        { id: '2', title: 'Priority support access' },
        { id: '3', title: 'Exclusive resources' },
      ])
    } finally {
      setIsGenerating(false)
    }
  }

  const handleEdit = (index: number) => {
    setEditingIndex(index)
    setEditValue(perks[index].title)
  }

  const handleSaveEdit = () => {
    if (editingIndex !== null && editValue.trim()) {
      const newPerks = [...perks]
      newPerks[editingIndex] = {
        ...newPerks[editingIndex],
        title: editValue.trim(),
      }
      setPerks(newPerks)
    }
    setEditingIndex(null)
    setEditValue('')
  }

  return (
    <div className="service-perks-step">
      <h2>What's included?</h2>
      <p className="step-description">
        We generated 3 perks for your retainer. Edit them to match your offering.
      </p>

      {isGenerating ? (
        <div className="generating-state">
          <Loader2 className="spin" size={24} />
          <span>Generating perks...</span>
        </div>
      ) : (
        <div className="perks-list">
          {perks.map((perk, index) => (
            <div key={perk.id} className="perk-item">
              <div className="perk-icon">
                <Check size={16} />
              </div>

              {editingIndex === index ? (
                <input
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={handleSaveEdit}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveEdit()}
                  autoFocus
                  maxLength={50}
                  className="perk-input"
                />
              ) : (
                <>
                  <span className="perk-title">{perk.title}</span>
                  <button
                    className="perk-edit"
                    onClick={() => handleEdit(index)}
                  >
                    <Edit2 size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        className="regenerate-btn"
        onClick={generatePerks}
        disabled={isGenerating}
      >
        <Sparkles size={16} />
        Regenerate
      </button>

      <div className="step-actions">
        <button className="back-btn" onClick={onBack}>
          Back
        </button>
        <button
          className="continue-btn"
          onClick={() => onComplete(perks)}
          disabled={isGenerating || perks.length !== 3}
        >
          Continue
        </button>
      </div>
    </div>
  )
}
```

### 5.2 Onboarding Flow Integration

**File: `src/onboarding/index.tsx`** (update)

```tsx
// Add after avatar step for service users:

// In the flow logic:
if (purpose === 'service' && !bannerUrl) {
  // Generate banner after avatar upload
  await api.profile.generateBanner()
}

// Show perks step for service users
if (purpose === 'service') {
  steps.push({
    id: 'perks',
    component: ServicePerksStep,
    props: {
      description: serviceDescription,
      price: selectedPrice,
      onComplete: (perks) => {
        setPerks(perks)
        nextStep()
      },
    },
  })
}
```

---

## Phase 6: Migration for Existing Users

### 6.1 Backfill Script

**File: `backend/scripts/backfill-service-assets.ts`**

```typescript
/**
 * Backfill banners and perks for existing service users
 *
 * Run with: npx tsx scripts/backfill-service-assets.ts
 */

import { db } from '../src/db/client'
import { generateSimpleBanner } from '../src/services/ai/bannerGenerator'
import { generatePerks, inferServiceType } from '../src/services/ai/perksGenerator'

async function backfill() {
  console.log('Finding service users without assets...')

  const serviceUsers = await db.profile.findMany({
    where: {
      purpose: 'service',
      OR: [
        { bannerUrl: null },
        { perks: { equals: null } },
      ],
    },
    select: {
      userId: true,
      avatarUrl: true,
      displayName: true,
      bio: true,
      singleAmount: true,
      bannerUrl: true,
      perks: true,
    },
  })

  console.log(`Found ${serviceUsers.length} users to backfill`)

  for (const user of serviceUsers) {
    console.log(`Processing user ${user.userId}...`)

    const updates: any = {}

    // Generate banner if missing and has avatar
    if (!user.bannerUrl && user.avatarUrl) {
      try {
        const bannerUrl = await generateSimpleBanner(user.avatarUrl, user.userId)
        updates.bannerUrl = bannerUrl
        console.log(`  Generated banner: ${bannerUrl}`)
      } catch (error) {
        console.error(`  Banner generation failed:`, error)
      }
    }

    // Generate perks if missing
    if (!user.perks && user.bio) {
      try {
        const serviceType = await inferServiceType(user.bio)
        const perks = await generatePerks({
          serviceDescription: user.bio,
          serviceType,
          pricePerMonth: (user.singleAmount || 5000) / 100,
          displayName: user.displayName || undefined,
        })
        updates.perks = perks
        console.log(`  Generated perks:`, perks.map(p => p.title))
      } catch (error) {
        console.error(`  Perks generation failed:`, error)
      }
    }

    if (Object.keys(updates).length > 0) {
      await db.profile.update({
        where: { userId: user.userId },
        data: updates,
      })
      console.log(`  Updated profile`)
    }

    // Rate limit to avoid API throttling
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  console.log('Backfill complete!')
}

backfill().catch(console.error)
```

---

## Summary: Files to Create/Modify

### New Files
| File | Purpose |
|------|---------|
| `backend/src/services/ai/bannerGenerator.ts` | Banner generation service |
| `backend/src/services/ai/perksGenerator.ts` | Perks generation service |
| `backend/tests/unit/bannerGenerator.test.ts` | Banner gen tests |
| `backend/tests/unit/perksGenerator.test.ts` | Perks gen tests |
| `backend/tests/integration/serviceMode.test.ts` | API integration tests |
| `src/onboarding/ServicePerksStep.tsx` | Onboarding perks UI |
| `backend/scripts/backfill-service-assets.ts` | Migration script |

### Modified Files
| File | Changes |
|------|---------|
| `backend/prisma/schema.prisma` | Add `bannerUrl` field |
| `backend/src/routes/profile.ts` | Add banner/perks endpoints |
| `backend/src/routes/users.ts` | Return banner/perks for service users |
| `backend/src/services/ai/index.ts` | Export new generators |
| `src/onboarding/index.tsx` | Integrate perks step |

---

## Execution Order

1. **Schema migration** - Add bannerUrl field
2. **AI services** - Banner + perks generators with tests
3. **API routes** - Profile endpoints for generation
4. **Onboarding** - Perks step integration
5. **Backfill** - Migrate existing users
6. **Frontend integration** - SubscribeBoundary updates (separate)

---

## Test Commands

```bash
# Unit tests
npm test -- bannerGenerator
npm test -- perksGenerator

# Integration tests
npm test -- serviceMode

# All tests
npm test
```
