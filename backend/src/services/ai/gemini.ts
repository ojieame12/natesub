/**
 * Gemini AI Service
 *
 * Uses Google's Gemini 3 Pro for:
 * - Voice transcription + structured extraction
 * - Page content generation (bio, perks, impact items)
 */

import { GoogleGenAI } from '@google/genai'
import { env } from '../../config/env.js'

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

// ============================================
// TYPES
// ============================================

export interface TranscriptionResult {
  transcription: string
  serviceType: 'personal' | 'professional'
  extractedInfo: {
    serviceName?: string
    targetAudience?: string
    keyOfferings?: string[]
    priceHint?: number
    relationship?: string  // For personal: family, friend, etc.
  }
}

export interface PageContent {
  bio: string
  perks: string[]
  impactItems: string[]
  suggestedTitle?: string
}

export interface DeliverableItem {
  type: string        // e.g., 'calls', 'async', 'resources', 'custom'
  label: string       // User-facing label, e.g., "1-on-1 strategy calls"
  quantity?: number   // e.g., 2 for "2 calls per month"
  detail?: string     // Additional context, e.g., "30-minute sessions"
}

export type Deliverables = DeliverableItem[]

export interface GeneratePageInput {
  description: string
  price: number
  name: string
  serviceType: 'personal' | 'professional'

  // Structured inputs (professional only) - AI articulates these, doesn't invent
  deliverables?: Deliverables
  background?: string   // e.g., "10 years in product management"
  credential?: string   // e.g., "Certified life coach", "Ex-Google PM"
}

// ============================================
// AUDIO TRANSCRIPTION + EXTRACTION
// ============================================

/**
 * Transcribe audio and extract structured information
 * Determines if this is a personal or professional use case
 */
export async function transcribeAndExtract(
  audioBase64: string,
  mimeType: string
): Promise<TranscriptionResult> {
  const client = getClient()

  const prompt = `You are helping someone set up a subscription payment page.
Listen to this audio where they describe what they want to use it for.

Your task:
1. Transcribe what they said
2. Determine if this is PERSONAL (family allowance, friend support, personal relationship) or PROFESSIONAL (business service, consulting, coaching, content creation)
3. Extract key information

Respond in this exact JSON format:
{
  "transcription": "exact transcription of what they said",
  "serviceType": "personal" or "professional",
  "extractedInfo": {
    "serviceName": "name of service if professional, null if personal",
    "targetAudience": "who this is for",
    "keyOfferings": ["what they offer or do", "another thing"],
    "priceHint": number or null if they mentioned a price,
    "relationship": "family/friend/partner if personal, null if professional"
  }
}

Only respond with valid JSON, no other text.`

  const response = await client.models.generateContent({
    model: 'gemini-3-flash-preview',  // Gemini 3 Flash - fastest with Pro-level intelligence
    contents: [
      { text: prompt },
      {
        inlineData: {
          mimeType,
          data: audioBase64,
        },
      },
    ],
  })

  const text = response.text?.trim() || ''

  // Parse JSON response
  try {
    // Handle potential markdown code blocks
    const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim()
    return JSON.parse(jsonStr) as TranscriptionResult
  } catch (error) {
    console.error('Failed to parse Gemini response:', text)
    throw new Error('Failed to parse AI response')
  }
}

// ============================================
// PAGE CONTENT GENERATION
// ============================================

/**
 * Generate page content (bio, perks, impact items) from description
 */
export async function generatePageContent(
  input: GeneratePageInput
): Promise<PageContent> {
  const client = getClient()

  const prompt = input.serviceType === 'professional'
    ? buildProfessionalPrompt(input)
    : buildPersonalPrompt(input)

  const response = await client.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [{ text: prompt }],
  })

  const text = response.text?.trim() || ''

  try {
    const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim()
    return JSON.parse(jsonStr) as PageContent
  } catch (error) {
    console.error('Failed to parse Gemini response:', text)
    throw new Error('Failed to parse AI response')
  }
}

function formatDeliverables(deliverables: Deliverables): string[] {
  return deliverables.map((item) => {
    // Build a descriptive string from the deliverable item
    let text = item.label

    // Add quantity if provided
    if (item.quantity && item.quantity > 1) {
      text = `${item.quantity}x ${text}`
    }

    // Add detail if provided
    if (item.detail) {
      text = `${text} (${item.detail})`
    }

    return text
  })
}

function buildProfessionalPrompt(input: GeneratePageInput): string {
  // If structured deliverables provided, use them (don't invent)
  const hasStructuredInput = input.deliverables && input.deliverables.length > 0

  if (hasStructuredInput) {
    const deliverableLines = formatDeliverables(input.deliverables!)

    // Build context lines
    const contextLines: string[] = []
    if (input.background) {
      contextLines.push(`Their background: ${input.background}`)
    }
    if (input.credential) {
      contextLines.push(`Their credential/title: ${input.credential}`)
    }

    // Bio guidance based on what's provided
    let bioGuidance = 'Focus on who they help and how.'
    if (input.background && input.credential) {
      bioGuidance = `Mention their credential "${input.credential}" and weave in their background.`
    } else if (input.credential) {
      bioGuidance = `Lead with their credential "${input.credential}".`
    } else if (input.background) {
      bioGuidance = `Mention their background: "${input.background}".`
    }

    return `You're a premium copywriter. Write EXTREMELY short copy.

STRICT RULES:
- Bio: MAXIMUM 10 WORDS. Count them. Not 11, not 15. TEN OR LESS.
- No filler words: passionate, helping, transform, compelling, ensure, resonate, specialize, dedicated
- No "Hi, I'm [name]" intros
- First person, punchy, direct

Context:
- Description: "${input.description}"
- Name: ${input.name}
- Price: $${input.price}/month
${contextLines.join('\n')}

DELIVERABLES (use these exactly as perks):
${deliverableLines.map(d => `- ${d}`).join('\n')}

GOOD BIOS (under 10 words):
- "I turn confused founders into confident product leaders."
- "Product strategy for early-stage founders."
- "I make your content actually convert."

BAD BIOS (too long, too generic):
- "Hi, I'm passionate about helping people transform their ideas..." ❌
- "I specialize in ensuring your content resonates powerfully..." ❌

Generate:
- Bio: ${bioGuidance}
- Perks: Use the deliverables above verbatim. Start with verbs.
- Impact Items: 2-3 punchy outcomes (max 5 words each)
- Suggested Title: Short professional title (2-4 words)

{
  "bio": "<10 words max, punchy, no fluff>",
  "perks": ["<deliverable 1>", "<deliverable 2>"],
  "impactItems": ["4 word outcome", "4 word outcome"],
  "suggestedTitle": "Short Title"
}

CRITICAL: Count your bio words. If over 10, rewrite shorter. JSON only.`
  }

  // Fallback: No structured input, let AI generate (but still be specific)
  return `You're a premium copywriter. Write EXTREMELY short copy.

STRICT RULES:
- Bio: MAXIMUM 10 WORDS. Not 11. Not 15. TEN WORDS OR LESS.
- No filler words (passionate, helping, transform, compelling, ensure, resonate)
- No "Hi, I'm [name]" intros
- First person, punchy, direct

Context:
- Service: "${input.description}"
- Name: ${input.name}

GOOD BIOS (under 10 words):
- "I turn blog drafts into traffic magnets."
- "Product strategy for early-stage founders."
- "I make your content actually convert."

BAD BIOS (too long, too generic):
- "Hi, I'm passionate about helping people transform their ideas..." ❌
- "I specialize in ensuring your content resonates powerfully..." ❌

Generate JSON:
{
  "bio": "<10 words max, punchy, no fluff>",
  "perks": ["<verb> + specific deliverable", "<verb> + specific deliverable"],
  "impactItems": ["4 word outcome", "4 word outcome"],
  "suggestedTitle": "2-3 word title"
}

CRITICAL: Count your bio words. If over 10, rewrite shorter.`
}

function buildPersonalPrompt(input: GeneratePageInput): string {
  return `You're writing a personal subscription page. Warm, genuine, VERY short.

STRICT RULES:
- Bio: MAXIMUM 10 WORDS. Count them. TEN OR LESS.
- No filler words: passionate, helping, transform, dedicated, journey
- Heartfelt but not sappy
- First person, genuine, direct

Context:
- Description: "${input.description}"
- Name: ${input.name}
- Price: $${input.price}/month

GOOD BIOS (under 10 words):
- "Your support lets me focus on what matters."
- "Help me keep creating for you."
- "Making my dream possible, one month at a time."

BAD BIOS (too long):
- "I'm so grateful for your support on this incredible journey..." ❌

Generate:
- Bio: Under 10 words, heartfelt
- Perks: 2-3 playful/genuine items
- Impact Items: 1-2 short statements (max 4 words)

{
  "bio": "<10 words max, heartfelt>",
  "perks": ["Monthly updates", "My eternal gratitude"],
  "impactItems": ["Keep me creating"]
}

CRITICAL: Count your bio words. If over 10, rewrite shorter. JSON only.`
}

// ============================================
// UTILITY: TEXT-ONLY EXTRACTION
// ============================================

/**
 * Extract structured info from text description (no audio)
 */
export async function extractFromText(
  description: string
): Promise<TranscriptionResult> {
  const client = getClient()

  const prompt = `Analyze this description for a subscription payment page:

"${description}"

Determine if this is PERSONAL (family allowance, friend support, personal relationship) or PROFESSIONAL (business service, consulting, coaching, content creation).

Respond in this exact JSON format:
{
  "transcription": "${description}",
  "serviceType": "personal" or "professional",
  "extractedInfo": {
    "serviceName": "name of service if professional, null if personal",
    "targetAudience": "who this is for",
    "keyOfferings": ["what they offer or do"],
    "priceHint": null,
    "relationship": "family/friend/partner if personal, null if professional"
  }
}

Only respond with valid JSON, no other text.`

  const response = await client.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [{ text: prompt }],
  })

  const text = response.text?.trim() || ''

  try {
    const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim()
    return JSON.parse(jsonStr) as TranscriptionResult
  } catch (error) {
    console.error('Failed to parse Gemini response:', text)
    throw new Error('Failed to parse AI response')
  }
}
