/**
 * AI Routes
 *
 * Endpoints for AI-powered page generation during onboarding.
 * Used by the "Service" branch of the onboarding flow.
 *
 * Security:
 * - All routes require authentication
 * - Rate limited to prevent abuse (20/day general, 10/day audio)
 * - Audio size limited to 5MB base64 (~3.7MB raw audio)
 * - Input validation on all endpoints
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { aiRateLimit } from '../middleware/rateLimit.js'
import {
  generateServicePage,
  quickGenerate,
  getMarketContext,
  suggestPrice,
} from '../services/ai/index.js'
import { env } from '../config/env.js'

const ai = new Hono()

// Constants
const MAX_AUDIO_BASE64_SIZE = 5 * 1024 * 1024  // 5MB base64 (~3.7MB raw audio, ~4 minutes at 128kbps)
const ALLOWED_AUDIO_MIMES = ['audio/webm', 'audio/mp4', 'audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac', 'audio/flac']

// ============================================
// HEALTH CHECK
// ============================================

ai.get('/status', (c) => {
  // Only expose aggregate availability, not individual provider status
  // This prevents revealing which specific AI services are configured
  const available = !!(env.GOOGLE_AI_API_KEY || env.PERPLEXITY_API_KEY)
  return c.json({ available })
})

// ============================================
// MAIN PAGE GENERATION
// ============================================

/**
 * POST /ai/generate
 *
 * Main endpoint for the "Service" onboarding branch.
 * Accepts either audio (voice) or text description.
 *
 * Rate limits:
 * - 20 requests/day for text-only
 * - 10 requests/day for audio (more expensive)
 *
 * Size limits:
 * - Audio: 5MB base64 (~4 minutes)
 * - Text: 2000 characters
 */
// Deliverable item schema - flexible array of deliverables
const deliverableItemSchema = z.object({
  type: z.string().max(50),
  label: z.string().min(1).max(200),
  quantity: z.number().int().min(1).max(100).optional(),
  detail: z.string().max(200).optional(),
})

const deliverablesSchema = z.array(deliverableItemSchema).max(10).optional()

ai.post(
  '/generate',
  requireAuth,
  aiRateLimit,  // 20/day general limit
  zValidator('json', z.object({
    audio: z.object({
      data: z.string().max(MAX_AUDIO_BASE64_SIZE, 'Audio too large (max 5MB)'),
      mimeType: z.string().refine(
        (mime) => ALLOWED_AUDIO_MIMES.includes(mime),
        { message: `Audio format must be one of: ${ALLOWED_AUDIO_MIMES.join(', ')}` }
      ),
    }).optional(),
    textDescription: z.string().min(10, 'Description too short').max(2000).optional(),
    price: z.number().positive().max(10_000_000), // Max 10M for local currencies
    userName: z.string().min(1).max(100),
    includeMarketResearch: z.boolean().default(false),
    // Structured inputs for professional services
    deliverables: deliverablesSchema,
    background: z.string().max(200).optional(),
    credential: z.string().max(100).optional(),
  }).refine(
    (data) => data.audio || data.textDescription,
    { message: 'Either audio or textDescription is required' }
  )),
  async (c) => {
    const input = c.req.valid('json')
    const userId = c.get('userId')

    // Check if AI is configured
    if (!env.GOOGLE_AI_API_KEY) {
      return c.json({ error: 'AI generation is not configured' }, 503)
    }

    // Apply stricter rate limit for audio requests
    if (input.audio) {
      // Check audio-specific rate limit manually
      const { redis } = await import('../db/redis.js')
      const audioKey = `ai_audio_ratelimit:${userId}`
      const audioCount = await redis.incr(audioKey)
      if (audioCount === 1) {
        await redis.expire(audioKey, 86400) // 24 hours
      }
      if (audioCount > 10) {
        return c.json({ error: 'Voice processing limit reached. Please try again tomorrow.' }, 429)
      }
    }

    try {
      const result = await generateServicePage({
        audio: input.audio,
        textDescription: input.textDescription,
        price: input.price,
        userName: input.userName,
        includeMarketResearch: input.includeMarketResearch,
        // Structured inputs for professional services
        deliverables: input.deliverables,
        background: input.background,
        credential: input.credential,
      })

      // Log generation (without PII) for cost tracking
      console.log(`[ai] generate userId=${userId} hasAudio=${!!input.audio} hasText=${!!input.textDescription}`)

      return c.json({ success: true, ...result })
    } catch (error) {
      // Log error without sensitive data
      console.error(`[ai] generate error userId=${userId}:`, error instanceof Error ? error.message : 'Unknown')
      return c.json({
        error: 'Failed to generate page content',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500)
    }
  }
)

// ============================================
// QUICK GENERATION (Text only, no audio)
// ============================================

/**
 * POST /ai/quick
 *
 * Fast generation from text description.
 * No audio processing, no market research.
 */
ai.post(
  '/quick',
  requireAuth,
  aiRateLimit,
  zValidator('json', z.object({
    description: z.string().min(10).max(2000),
    price: z.number().positive().max(10_000_000), // Max 10M for local currencies
    userName: z.string().min(1).max(100),
    serviceType: z.enum(['personal', 'professional']),
  })),
  async (c) => {
    const input = c.req.valid('json')
    const userId = c.get('userId')

    if (!env.GOOGLE_AI_API_KEY) {
      return c.json({ error: 'AI generation is not configured' }, 503)
    }

    try {
      const result = await quickGenerate(input)
      console.log(`[ai] quick userId=${userId} type=${input.serviceType}`)
      return c.json({ success: true, ...result })
    } catch (error) {
      console.error(`[ai] quick error userId=${userId}:`, error instanceof Error ? error.message : 'Unknown')
      return c.json({
        error: 'Failed to generate content',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500)
    }
  }
)

// ============================================
// MARKET RESEARCH
// ============================================

/**
 * POST /ai/research
 *
 * Get market research for a service.
 * Returns competitor pricing, common perks, etc.
 */
ai.post(
  '/research',
  requireAuth,
  aiRateLimit,
  zValidator('json', z.object({
    serviceDescription: z.string().min(10).max(1000),
    industry: z.string().max(100).optional(),
  })),
  async (c) => {
    const { serviceDescription, industry } = c.req.valid('json')
    const userId = c.get('userId')

    if (!env.PERPLEXITY_API_KEY) {
      return c.json({ error: 'Market research is not configured' }, 503)
    }

    try {
      const result = await getMarketContext(serviceDescription, industry)
      console.log(`[ai] research userId=${userId}`)
      return c.json({ success: true, ...result })
    } catch (error) {
      console.error(`[ai] research error userId=${userId}:`, error instanceof Error ? error.message : 'Unknown')
      return c.json({
        error: 'Failed to get market research',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500)
    }
  }
)

// ============================================
// PRICE SUGGESTION
// ============================================

/**
 * POST /ai/suggest-price
 *
 * Quick price suggestion based on service description.
 */
ai.post(
  '/suggest-price',
  requireAuth,
  aiRateLimit,
  zValidator('json', z.object({
    serviceDescription: z.string().min(10).max(1000),
  })),
  async (c) => {
    const { serviceDescription } = c.req.valid('json')
    const userId = c.get('userId')

    if (!env.PERPLEXITY_API_KEY) {
      return c.json({ error: 'Price suggestion is not configured' }, 503)
    }

    try {
      const result = await suggestPrice(serviceDescription)
      console.log(`[ai] suggest-price userId=${userId}`)
      return c.json({ success: true, ...result })
    } catch (error) {
      console.error(`[ai] suggest-price error userId=${userId}:`, error instanceof Error ? error.message : 'Unknown')
      return c.json({
        error: 'Failed to suggest price',
        details: error instanceof Error ? error.message : 'Unknown error',
      }, 500)
    }
  }
)

export default ai
