/**
 * Perplexity Sonar Pro Service
 *
 * Uses Perplexity's Sonar Pro for:
 * - Real-time market research
 * - Competitive pricing insights
 * - Industry-specific recommendations
 */

import { env } from '../../config/env.js'

// ============================================
// TYPES
// ============================================

export interface MarketContext {
  competitorPricing: {
    low: number
    mid: number
    high: number
  }
  commonPerks: string[]
  industryTerms: string[]
  targetAudienceInsights: string
  pricingRationale: string
}

interface PerplexityMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface PerplexityResponse {
  id: string
  model: string
  choices: {
    index: number
    finish_reason: string
    message: {
      role: string
      content: string
    }
  }[]
  citations?: string[]
}

// ============================================
// API CLIENT
// ============================================

async function callPerplexity(messages: PerplexityMessage[]): Promise<PerplexityResponse> {
  if (!env.PERPLEXITY_API_KEY) {
    throw new Error('PERPLEXITY_API_KEY is not configured')
  }

  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar-pro',
      messages,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    console.error('Perplexity API error:', error)
    throw new Error(`Perplexity API error: ${response.status}`)
  }

  return response.json()
}

// ============================================
// MARKET RESEARCH
// ============================================

/**
 * Get market context for a service type
 * Provides competitive pricing, common perks, and industry insights
 */
export async function getMarketContext(
  serviceDescription: string,
  industry?: string
): Promise<MarketContext> {
  const systemPrompt = `You are a market research analyst helping someone price their subscription service.
Provide factual, data-driven insights based on current market conditions.
Always respond in valid JSON format.`

  const userPrompt = `Research the market for this subscription service:

Service: "${serviceDescription}"
${industry ? `Industry: ${industry}` : ''}

Provide:
1. Competitor pricing ranges (USD/month) for similar services
2. Common perks/benefits offered by competitors
3. Industry-specific terms to use
4. Target audience insights
5. Brief pricing rationale

Respond in this exact JSON format:
{
  "competitorPricing": {
    "low": 29,
    "mid": 99,
    "high": 299
  },
  "commonPerks": ["perk 1", "perk 2", "perk 3"],
  "industryTerms": ["term 1", "term 2"],
  "targetAudienceInsights": "Who typically buys this and why",
  "pricingRationale": "Brief explanation of the pricing range"
}

Base your response on real market data. Only respond with valid JSON.`

  const response = await callPerplexity([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ])

  const text = response.choices[0]?.message?.content?.trim() || ''

  try {
    const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim()
    return JSON.parse(jsonStr) as MarketContext
  } catch {
    console.error('Failed to parse Perplexity response:', text)
    // Return sensible defaults if parsing fails
    return {
      competitorPricing: { low: 10, mid: 50, high: 200 },
      commonPerks: ['Priority support', 'Exclusive content', 'Direct access'],
      industryTerms: [],
      targetAudienceInsights: 'Unable to determine from description',
      pricingRationale: 'Standard subscription pricing range',
    }
  }
}

/**
 * Quick price suggestion based on service type
 * Faster/cheaper than full market research
 */
export async function suggestPrice(
  serviceDescription: string
): Promise<{ suggested: number; range: { min: number; max: number } }> {
  const response = await callPerplexity([
    {
      role: 'system',
      content: 'You are a pricing consultant. Respond only with JSON.',
    },
    {
      role: 'user',
      content: `Suggest a monthly subscription price (USD) for: "${serviceDescription}"

Respond with:
{
  "suggested": 49,
  "range": { "min": 29, "max": 99 }
}

Only valid JSON, no other text.`,
    },
  ])

  const text = response.choices[0]?.message?.content?.trim() || ''

  try {
    const jsonStr = text.replace(/```json\n?|\n?```/g, '').trim()
    return JSON.parse(jsonStr)
  } catch {
    return { suggested: 50, range: { min: 25, max: 100 } }
  }
}
