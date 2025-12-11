/**
 * AI Services - Main Export
 *
 * Available services:
 * - Gemini: Voice transcription + content generation
 * - Perplexity: Market research + pricing insights
 * - Page Generator: Orchestrates all AI services
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
