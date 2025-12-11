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
    model: 'gemini-2.5-flash',  // Using 2.5 Flash for speed, can upgrade to gemini-3-pro-preview
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
    model: 'gemini-2.5-flash',
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

    return `You are a professional copywriter helping someone create a subscription page for their service.

Their description: "${input.description}"
Their name: ${input.name}
Price: $${input.price}/month
${contextLines.join('\n')}

IMPORTANT: The user has specified exactly what they offer. Use these deliverables verbatim as the perks - do NOT invent additional perks.

ACTUAL DELIVERABLES (use these exactly):
${deliverableLines.map(d => `- ${d}`).join('\n')}

Generate content for their subscription page:
- Bio: 2-3 sentences, first person, professional but warm. ${bioGuidance}
- Perks: Use ONLY the deliverables listed above. Rephrase them to start with action verbs if needed, but don't change the substance.
- Impact Items: 2-3 outcomes subscribers will experience based on the service described
- Suggested Title: A professional title/tagline (e.g., "Product Strategy Coach")

Respond in this exact JSON format:
{
  "bio": "I help...",
  "perks": ["<deliverable 1>", "<deliverable 2>", ...],
  "impactItems": ["<outcome 1>", "<outcome 2>", "<outcome 3>"],
  "suggestedTitle": "Professional Title"
}

Only respond with valid JSON, no other text.`
  }

  // Fallback: No structured input, let AI generate (but still be specific)
  return `You are a professional copywriter helping someone create a subscription page for their service.

Their description: "${input.description}"
Their name: ${input.name}
Price: $${input.price}/month

Generate compelling, professional content for their subscription page.

Requirements:
- Bio: 2-3 sentences, first person, professional but warm tone
- Perks: 3-4 specific things subscribers get (start each with a verb). Be specific to what they described - avoid generic phrases like "exclusive content" or "community access" unless they mentioned it.
- Impact Items: 2-3 outcomes/benefits subscribers will experience
- Suggested Title: A professional title/tagline for them (e.g., "Product Strategy Coach")

Respond in this exact JSON format:
{
  "bio": "I help...",
  "perks": ["Weekly 1-on-1 strategy calls", "Direct messaging access", "Resource library"],
  "impactItems": ["Ship products faster", "Make confident decisions", "Build a clear roadmap"],
  "suggestedTitle": "Product Strategy Coach"
}

Make it specific to what they described. Avoid generic phrases.
Only respond with valid JSON, no other text.`
}

function buildPersonalPrompt(input: GeneratePageInput): string {
  return `You are helping someone create a simple personal subscription page.

Their description: "${input.description}"
Their name: ${input.name}
Price: $${input.price}/month

This is for personal use (family support, allowance, helping a friend, etc.), so keep it warm and simple.

Requirements:
- Bio: 1-2 sentences, casual and heartfelt
- Perks: 2-3 simple things (can be playful, e.g., "Eternal gratitude", "Updates on my journey")
- Impact Items: 1-2 simple statements about what this support means

Respond in this exact JSON format:
{
  "bio": "Your support means...",
  "perks": ["Monthly updates", "My eternal gratitude", "Knowing you're helping"],
  "impactItems": ["Help me focus on what matters", "Be part of my journey"]
}

Keep it personal and genuine.
Only respond with valid JSON, no other text.`
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
    model: 'gemini-2.5-flash',
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
