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
        model: 'gemini-3-flash-preview',
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

    // Validate perk content (character length and word count)
    const validPerks = parsed.perks.every((p: string) => {
      if (typeof p !== 'string') return false
      if (p.length < 3 || p.length > 50) return false
      // Enforce 6 words max
      const wordCount = p.trim().split(/\s+/).length
      if (wordCount > 6) return false
      return true
    })
    if (!validPerks) {
      console.warn('[perks] Invalid perk format (too long or wrong count), using fallback')
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
 * Heavily engineered to ensure exactly 3 high-quality, industry-specific perks.
 */
function buildPerksPrompt(input: PerksInput): string {
  // Determine tier based on price
  const tier = input.pricePerMonth >= 500 ? 'premium'
    : input.pricePerMonth >= 100 ? 'mid-tier'
    : 'entry-level'

  // Industry-specific perk templates
  const industryTemplates: Record<string, { examples: string[]; deliverables: string[] }> = {
    fitness: {
      examples: ['Custom workout programs', 'Weekly form check videos', 'Nutrition plan updates', 'Direct trainer messaging', 'Progress tracking calls'],
      deliverables: ['workout plans', 'meal plans', 'form corrections', 'check-ins', 'body composition reviews'],
    },
    coaching: {
      examples: ['Weekly 1-on-1 sessions', 'Voice memo feedback', 'Goal-setting workshops', 'Accountability check-ins', 'Resource library access'],
      deliverables: ['coaching calls', 'action plans', 'feedback sessions', 'mindset exercises', 'journal prompts'],
    },
    consulting: {
      examples: ['Monthly strategy sessions', 'Pitch deck reviews', 'Investor introductions', 'Market analysis reports', 'Board meeting prep'],
      deliverables: ['strategy sessions', 'document reviews', 'network introductions', 'analysis reports', 'implementation guides'],
    },
    design: {
      examples: ['Unlimited design revisions', 'Priority project queue', 'Brand guideline updates', 'Source file access', 'Weekly design reviews'],
      deliverables: ['design iterations', 'brand assets', 'mockups', 'style guides', 'creative direction'],
    },
    tech: {
      examples: ['Weekly code reviews', 'Architecture consultations', 'Pair programming sessions', 'Tech stack guidance', 'Slack/Discord access'],
      deliverables: ['code reviews', 'technical mentorship', 'debugging sessions', 'architecture plans', 'best practices guides'],
    },
    education: {
      examples: ['Live weekly classes', 'Homework feedback', 'Office hours access', 'Course materials library', 'Certificate of completion'],
      deliverables: ['lessons', 'assignments', 'feedback', 'study materials', 'practice exercises'],
    },
    creative: {
      examples: ['Monthly content reviews', 'Creative direction calls', 'Asset library access', 'Collaboration sessions', 'Portfolio feedback'],
      deliverables: ['creative feedback', 'content reviews', 'creative assets', 'brainstorm sessions', 'style guidance'],
    },
    business: {
      examples: ['Monthly advisory calls', 'Strategic planning sessions', 'Network introductions', 'Financial review meetings', 'Growth strategy docs'],
      deliverables: ['advisory sessions', 'strategy documents', 'introductions', 'business reviews', 'action plans'],
    },
    health: {
      examples: ['Personalized protocols', 'Weekly wellness check-ins', 'Lab result reviews', 'Supplement guidance', 'Direct practitioner access'],
      deliverables: ['health protocols', 'check-ins', 'result interpretations', 'lifestyle recommendations', 'progress tracking'],
    },
    finance: {
      examples: ['Monthly portfolio reviews', 'Investment strategy calls', 'Tax planning sessions', 'Market insight reports', 'Financial planning docs'],
      deliverables: ['portfolio reviews', 'investment advice', 'financial plans', 'market analysis', 'tax strategies'],
    },
    marketing: {
      examples: ['Campaign strategy sessions', 'Content calendar reviews', 'Analytics deep-dives', 'Ad creative feedback', 'Growth tactic reports'],
      deliverables: ['campaign reviews', 'content strategies', 'performance reports', 'creative feedback', 'optimization tips'],
    },
  }

  const industry = input.industry?.toLowerCase() || input.serviceType?.toLowerCase() || ''
  const template = industryTemplates[industry]

  const industryGuidance = template
    ? `\nINDUSTRY-SPECIFIC GUIDANCE (${industry.toUpperCase()}):
- Common deliverables in this field: ${template.deliverables.join(', ')}
- Example perks that work well: "${template.examples.slice(0, 3).join('", "')}"`
    : ''

  // Build context strings
  const serviceTypeStr = input.serviceType ? `- Service type: ${input.serviceType}\n` : ''
  const industryStr = input.industry ? `- Industry: ${input.industry}\n` : ''

  return `You are an expert subscription page copywriter who understands what makes subscribers convert. Generate EXACTLY 3 perks that feel valuable and specific.

SERVICE CONTEXT:
- Description: "${input.serviceDescription}"
${serviceTypeStr}${industryStr}- Price point: $${input.pricePerMonth}/month (${tier} tier)
- Provider: ${input.displayName || 'Expert'}
${industryGuidance}

YOUR TASK: Create 3 perks that answer "What do I actually GET for my money?"

PERK REQUIREMENTS:
✓ EXACTLY 3 perks (not 2, not 4)
✓ Each perk: 2-6 words MAX (short and punchy)
✓ Must describe a TANGIBLE deliverable or access
✓ Must be SPECIFIC to this service (not generic)
✓ Match the value expectation of ${tier} tier ($${input.pricePerMonth}/mo)

TIER EXPECTATIONS:
${tier === 'premium' ? '- PREMIUM ($500+): High-touch, exclusive access, personalized everything, VIP treatment' :
  tier === 'mid-tier' ? '- MID-TIER ($100-499): Active engagement, regular 1-on-1 time, customized deliverables' :
  '- ENTRY ($10-99): Access-based, community/group format, structured content or check-ins'}

FORMULA FOR GREAT PERKS (keep it SHORT):
[Frequency] + [Deliverable] = 2-6 words total
Good: "Weekly coaching calls", "Custom meal plans", "Direct WhatsApp access"
Bad: "Access to weekly one-on-one personalized coaching sessions" (too long!)

❌ BANNED PHRASES (too vague):
- "Support", "Help", "Guidance", "Resources", "Updates", "Access to content"
- "Ongoing", "Regular", "Continuous", "Dedicated"
- Any perk without a SPECIFIC deliverable

OUTPUT (JSON only):
{
  "perks": [
    "First specific perk here",
    "Second specific perk here",
    "Third specific perk here"
  ]
}

FINAL CHECK:
□ Would a skeptical buyer say "ok, I know exactly what I'm getting"?
□ Is each perk distinctly different from the others?
□ Does the value feel right for $${input.pricePerMonth}/month?

Respond with ONLY valid JSON.`
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
        model: 'gemini-3-flash-preview',
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
