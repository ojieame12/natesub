/**
 * Perks Generation Service
 *
 * Generates exactly 3 professional service perks based on:
 * - Service type/industry
 * - Price point (higher price = more premium perks)
 * - Creator's description
 *
 * IMPORTANT: Always returns exactly 3 perks. No more, no less.
 */

import { GoogleGenAI } from '@google/genai'
import { env } from '../../config/env.js'

// Types
export interface Perk {
  id: string
  title: string
  enabled: boolean  // All generated perks are enabled by default
}

interface PerksInput {
  serviceDescription: string
  serviceType?: string      // e.g., "fitness coaching", "business consulting"
  industry?: string         // e.g., "health", "finance", "tech"
  pricePerMonth: number     // Used to calibrate perk value
  displayName?: string
}

// Industry categories for prompt context
type Industry = 'fitness' | 'coaching' | 'consulting' | 'design' | 'tech' |
  'education' | 'creative' | 'business' | 'health' | 'finance' | 'marketing' | 'other'

// AI request timeout (30 seconds)
const AI_TIMEOUT_MS = 30000

// Timeout helper to prevent AI calls from hanging indefinitely
function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${operation} timed out after ${ms}ms`)), ms)
    ),
  ])
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
  const client = getClient()

  try {
    const prompt = buildPerksPrompt(input)

    const response = await withTimeout(
      client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ text: prompt }],
      }),
      AI_TIMEOUT_MS,
      'Perks generation'
    )

    const text = response.text?.trim() || ''

    // Parse JSON response
    const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim()
    const parsed = JSON.parse(jsonStr)

    // Validate exactly 3 perks
    if (!Array.isArray(parsed.perks) || parsed.perks.length !== 3) {
      console.warn('[perks] AI returned wrong count, using fallback')
      return getGenericPerks(input.serviceType)
    }

    // Validate perk content
    const validPerks = parsed.perks.every(
      (p: string) => typeof p === 'string' && p.length >= 3 && p.length <= 60
    )
    if (!validPerks) {
      console.warn('[perks] Invalid perk format, using fallback')
      return getGenericPerks(input.serviceType)
    }

    // Add IDs and return (all generated perks are enabled by default)
    return parsed.perks.map((title: string, index: number) => ({
      id: `perk-${Date.now()}-${index}`,
      title: title.trim(),
      enabled: true,
    }))
  } catch (error) {
    console.error('[perks] Generation failed:', error)
    return getGenericPerks(input.serviceType)
  }
}

/**
 * Build the prompt for perks generation.
 * Heavily engineered to ensure exactly 3 high-quality perks.
 */
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

STRICT RULES - FOLLOW EXACTLY:
1. Generate EXACTLY 3 perks - not 2, not 4, not 5. COUNT: THREE.
2. Each perk: 2-6 words maximum
3. Start with action verbs OR tangible nouns
4. Be SPECIFIC to the service (no generic "24/7 support" or "access to resources")
5. Match the value to the price tier (${tier})
6. Use sentence case (capitalize first word only)

PRICE TIER GUIDANCE:
- Entry-level ($10-99): Basic access (e.g., "Weekly check-ins", "Resource library access", "Email support")
- Mid-tier ($100-499): Active engagement (e.g., "Bi-weekly strategy calls", "Custom action plans", "Priority responses")
- Premium ($500+): High-touch (e.g., "Daily coaching sessions", "On-call access 24/7", "Personalized programs")

EXCELLENT EXAMPLES by industry:
- Fitness: "Custom meal plans", "Weekly workout updates", "Direct messaging access"
- Business consulting: "Monthly strategy calls", "Pitch deck reviews", "Investor introductions"
- Design: "Unlimited revision rounds", "Priority project slots", "Brand asset library"
- Tech/Dev: "Code reviews weekly", "Architecture consultations", "Slack channel access"
- Coaching: "Weekly 1-on-1 calls", "Personalized roadmap", "Voice memo feedback"

BAD EXAMPLES (too vague - DO NOT USE):
- "Support" ❌
- "Help when you need it" ❌
- "Access to resources" ❌
- "Regular updates" ❌
- "Ongoing guidance" ❌

OUTPUT FORMAT - JSON ONLY:
{
  "perks": [
    "First perk here",
    "Second perk here",
    "Third perk here"
  ]
}

CRITICAL CHECKLIST BEFORE RESPONDING:
□ Exactly 3 perks? (not 2, not 4)
□ Each perk 2-6 words?
□ Specific to the service?
□ Appropriate for ${tier} tier?
□ Valid JSON format?

Respond with ONLY the JSON object. No other text.`
}

/**
 * Infer service type/industry from description.
 * Used to provide better context for perk generation.
 */
export async function inferServiceType(description: string): Promise<Industry> {
  const client = getClient()

  try {
    const response = await withTimeout(
      client.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{
          text: `Categorize this service description into ONE of these industries:
fitness, coaching, consulting, design, tech, education, creative, business, health, finance, marketing, other

Description: "${description}"

Rules:
- Respond with ONLY the category word
- All lowercase
- No punctuation or extra text

Category:`
        }],
      }),
      AI_TIMEOUT_MS,
      'Service type inference'
    )

    const result = response.text?.trim().toLowerCase() || 'other'

    // Validate it's a known industry
    const validIndustries: Industry[] = [
      'fitness', 'coaching', 'consulting', 'design', 'tech',
      'education', 'creative', 'business', 'health', 'finance', 'marketing', 'other'
    ]

    return validIndustries.includes(result as Industry)
      ? result as Industry
      : 'other'
  } catch (error) {
    console.error('[perks] Industry inference failed:', error)
    return 'other'
  }
}

/**
 * Fallback perks when AI generation fails.
 * Returns industry-specific generic perks that still sound professional.
 */
function getGenericPerks(serviceType?: string): Perk[] {
  const now = Date.now()

  // Industry-specific fallbacks - all have exactly 3 perks
  const fallbacks: Record<string, string[]> = {
    fitness: ['Custom workout plans', 'Weekly check-ins', 'Direct message access'],
    coaching: ['Monthly strategy calls', 'Personalized feedback', 'Resource library access'],
    consulting: ['Bi-weekly consulting calls', 'Priority email support', 'Custom recommendations'],
    design: ['Unlimited revisions', 'Priority project queue', 'Source file access'],
    tech: ['Weekly code reviews', 'Architecture guidance', 'Slack channel access'],
    education: ['Weekly live sessions', 'Course materials access', 'Q&A support'],
    creative: ['Monthly content reviews', 'Creative direction', 'Asset library access'],
    business: ['Monthly advisory calls', 'Strategic planning', 'Network introductions'],
    health: ['Personalized protocols', 'Weekly check-ins', 'Direct messaging'],
    finance: ['Monthly portfolio review', 'Strategy sessions', 'Market insights'],
    marketing: ['Campaign reviews', 'Strategy sessions', 'Analytics reports'],
    default: ['Monthly 1-on-1 sessions', 'Priority support access', 'Exclusive resources'],
  }

  const key = serviceType?.toLowerCase() || ''
  const perks = fallbacks[key] || fallbacks.default

  return perks.map((title, i) => ({
    id: `perk-${now}-${i}`,
    title,
    enabled: true,
  }))
}

/**
 * Validate a perks array matches requirements.
 * Used for manual perk updates.
 */
export function validatePerks(perks: unknown): perks is Perk[] {
  if (!Array.isArray(perks)) return false
  if (perks.length !== 3) return false

  return perks.every(perk =>
    typeof perk === 'object' &&
    perk !== null &&
    typeof perk.id === 'string' &&
    typeof perk.title === 'string' &&
    perk.title.length >= 1 &&
    perk.title.length <= 100 &&
    typeof perk.enabled === 'boolean'
  )
}

/**
 * Check if perks generation is available.
 * Used to determine if we should show perks-related UI.
 */
export function isPerksGenerationAvailable(): boolean {
  return !!env.GOOGLE_AI_API_KEY
}
