/**
 * Page Generator - AI Orchestrator
 *
 * Combines Gemini (voice/content) and Perplexity (market research)
 * to generate complete subscription page content.
 *
 * This is the main entry point for the "Service" onboarding branch.
 */

import {
  transcribeAndExtract,
  extractFromText,
  generatePageContent,
  type TranscriptionResult,
  type PageContent,
  type Deliverables,
} from './gemini.js'
import { getMarketContext, type MarketContext } from './perplexity.js'
import { env } from '../../config/env.js'

// ============================================
// TYPES
// ============================================

export interface GeneratePageInput {
  // Audio input (optional - either audio or text required)
  audio?: {
    data: string      // base64 encoded
    mimeType: string  // audio/mp3, audio/webm, etc.
  }

  // Text input (optional - either audio or text required)
  textDescription?: string

  // Required
  price: number
  userName: string

  // Optional enhancements
  includeMarketResearch?: boolean

  // Structured inputs (professional services) - AI articulates these, doesn't invent
  deliverables?: Deliverables
  background?: string   // e.g., "10 years in product management"
  credential?: string   // e.g., "Certified life coach", "Ex-Google PM"
}

export interface GeneratePageResult {
  // Core content
  bio: string
  perks: string[]
  impactItems: string[]
  suggestedTitle?: string

  // Metadata
  serviceType: 'personal' | 'professional'
  transcription?: string  // If audio was provided

  // Optional market research (if requested)
  marketContext?: MarketContext
}

// ============================================
// MAIN ORCHESTRATOR
// ============================================

/**
 * Generate complete subscription page content
 *
 * Flow:
 * 1. If audio provided, transcribe and extract info
 * 2. If text provided, extract info from text
 * 3. Optionally fetch market research (for professional pages)
 * 4. Generate page content (bio, perks, impact items)
 * 5. Return complete result
 */
export async function generateServicePage(
  input: GeneratePageInput
): Promise<GeneratePageResult> {
  // Validate input
  if (!input.audio && !input.textDescription) {
    throw new Error('Either audio or textDescription is required')
  }

  // Step 1: Extract information from input
  let extraction: TranscriptionResult

  if (input.audio) {
    extraction = await transcribeAndExtract(input.audio.data, input.audio.mimeType)
  } else {
    extraction = await extractFromText(input.textDescription!)
  }

  const { serviceType, transcription } = extraction

  // Step 2: Optionally get market research (professional pages only)
  let marketContext: MarketContext | undefined

  if (input.includeMarketResearch && serviceType === 'professional' && env.PERPLEXITY_API_KEY) {
    try {
      marketContext = await getMarketContext(transcription)
    } catch (error) {
      console.error('Market research failed (non-fatal):', error)
      // Continue without market research
    }
  }

  // Step 3: Generate page content
  const pageContent = await generatePageContent({
    description: transcription,
    price: input.price,
    name: input.userName,
    serviceType,
    // Pass through structured inputs (professional services)
    deliverables: input.deliverables,
    background: input.background,
    credential: input.credential,
  })

  // Step 4: Assemble result
  return {
    bio: pageContent.bio,
    perks: pageContent.perks,
    impactItems: pageContent.impactItems,
    suggestedTitle: pageContent.suggestedTitle,
    serviceType,
    transcription: input.audio ? transcription : undefined,
    marketContext,
  }
}

// ============================================
// QUICK GENERATION (No audio, minimal processing)
// ============================================

/**
 * Quick page generation from text only
 * Skips audio processing and market research
 */
export async function quickGenerate(input: {
  description: string
  price: number
  userName: string
  serviceType: 'personal' | 'professional'
}): Promise<PageContent> {
  return generatePageContent({
    description: input.description,
    price: input.price,
    name: input.userName,
    serviceType: input.serviceType,
  })
}

// ============================================
// RE-EXPORTS for convenience
// ============================================

export { getMarketContext } from './perplexity.js'
export type { MarketContext } from './perplexity.js'
export type { PageContent, TranscriptionResult } from './gemini.js'
