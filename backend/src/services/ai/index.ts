/**
 * AI Services - Main Export
 *
 * Available services:
 * - Gemini: Voice transcription + content generation
 * - Perplexity: Market research + pricing insights
 * - Page Generator: Orchestrates all AI services
 * - Banner Generator: AI-powered banner creation from avatars
 * - Perks Generator: Service perk generation (always 3 perks)
 */

// Main orchestrator (recommended entry point)
export {
  generateServicePage,
  quickGenerate,
  type GeneratePageInput,
  type GeneratePageResult,
} from './pageGenerator.js'

// Individual services (for advanced use)
export {
  transcribeAndExtract,
  extractFromText,
  generatePageContent,
  type TranscriptionResult,
  type PageContent,
  type Deliverables,
  type DeliverableItem,
} from './gemini.js'

export {
  getMarketContext,
  suggestPrice,
  type MarketContext,
} from './perplexity.js'

// Service Mode assets (banner + perks)
export {
  generateBanner,
  isBannerGenerationAvailable,
} from './bannerGenerator.js'

export {
  generatePerks,
  inferServiceType,
  validatePerks,
  isPerksGenerationAvailable,
  type Perk,
} from './perksGenerator.js'

// Combined AI availability check
export function isAIAvailable(): boolean {
  // Both perks and banner generation use the same API key
  return isPerksGenerationAvailable()
}
