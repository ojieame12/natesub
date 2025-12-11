import { z } from 'zod'

// Re-create the schema from ai.ts for testing
const deliverableItemSchema = z.object({
  type: z.string().max(50),
  label: z.string().min(1).max(200),
  quantity: z.number().int().min(1).max(100).optional(),
  detail: z.string().max(200).optional(),
})

const deliverablesSchema = z.array(deliverableItemSchema).max(10).optional()

const aiGenerateInputSchema = z.object({
  audio: z.object({
    data: z.string().max(5 * 1024 * 1024),
    mimeType: z.string(),
  }).optional(),
  textDescription: z.string().min(10).max(2000).optional(),
  price: z.number().positive().max(100000),
  userName: z.string().min(1).max(100),
  includeMarketResearch: z.boolean().default(false),
  deliverables: deliverablesSchema,
  background: z.string().max(200).optional(),
  credential: z.string().max(100).optional(),
}).refine(
  (data) => data.audio || data.textDescription,
  { message: 'Either audio or textDescription is required' }
)

describe('AI Generate Input Validation', () => {
  describe('deliverables', () => {
    it('accepts valid deliverables array', () => {
      const input = {
        textDescription: 'I help product managers ship faster',
        price: 100,
        userName: 'Sarah',
        deliverables: [
          { type: 'calls', label: '1-on-1 strategy calls', quantity: 2 },
          { type: 'async', label: 'Slack access', detail: 'async support' },
        ],
      }

      const result = aiGenerateInputSchema.safeParse(input)
      expect(result.success).toBe(true)
    })

    it('accepts empty deliverables array', () => {
      const input = {
        textDescription: 'I help product managers ship faster',
        price: 100,
        userName: 'Sarah',
        deliverables: [],
      }

      const result = aiGenerateInputSchema.safeParse(input)
      expect(result.success).toBe(true)
    })

    it('accepts undefined deliverables', () => {
      const input = {
        textDescription: 'I help product managers ship faster',
        price: 100,
        userName: 'Sarah',
      }

      const result = aiGenerateInputSchema.safeParse(input)
      expect(result.success).toBe(true)
    })

    it('rejects deliverables with quantity < 1', () => {
      const input = {
        textDescription: 'I help product managers ship faster',
        price: 100,
        userName: 'Sarah',
        deliverables: [
          { type: 'calls', label: 'Calls', quantity: 0 },
        ],
      }

      const result = aiGenerateInputSchema.safeParse(input)
      expect(result.success).toBe(false)
    })

    it('rejects deliverables with quantity > 100', () => {
      const input = {
        textDescription: 'I help product managers ship faster',
        price: 100,
        userName: 'Sarah',
        deliverables: [
          { type: 'calls', label: 'Calls', quantity: 101 },
        ],
      }

      const result = aiGenerateInputSchema.safeParse(input)
      expect(result.success).toBe(false)
    })

    it('rejects deliverables with empty label', () => {
      const input = {
        textDescription: 'I help product managers ship faster',
        price: 100,
        userName: 'Sarah',
        deliverables: [
          { type: 'calls', label: '' },
        ],
      }

      const result = aiGenerateInputSchema.safeParse(input)
      expect(result.success).toBe(false)
    })

    it('rejects more than 10 deliverables', () => {
      const input = {
        textDescription: 'I help product managers ship faster',
        price: 100,
        userName: 'Sarah',
        deliverables: Array(11).fill({ type: 'custom', label: 'Item' }),
      }

      const result = aiGenerateInputSchema.safeParse(input)
      expect(result.success).toBe(false)
    })
  })

  describe('credential', () => {
    it('accepts valid credential', () => {
      const input = {
        textDescription: 'I help product managers ship faster',
        price: 100,
        userName: 'Sarah',
        credential: '10 years product leadership at Google',
      }

      const result = aiGenerateInputSchema.safeParse(input)
      expect(result.success).toBe(true)
    })

    it('accepts undefined credential', () => {
      const input = {
        textDescription: 'I help product managers ship faster',
        price: 100,
        userName: 'Sarah',
      }

      const result = aiGenerateInputSchema.safeParse(input)
      expect(result.success).toBe(true)
    })

    it('rejects credential > 100 chars', () => {
      const input = {
        textDescription: 'I help product managers ship faster',
        price: 100,
        userName: 'Sarah',
        credential: 'a'.repeat(101),
      }

      const result = aiGenerateInputSchema.safeParse(input)
      expect(result.success).toBe(false)
    })
  })

  describe('required fields', () => {
    it('requires either audio or textDescription', () => {
      const input = {
        price: 100,
        userName: 'Sarah',
      }

      const result = aiGenerateInputSchema.safeParse(input)
      expect(result.success).toBe(false)
    })

    it('accepts audio without textDescription', () => {
      const input = {
        audio: { data: 'base64data', mimeType: 'audio/webm' },
        price: 100,
        userName: 'Sarah',
      }

      const result = aiGenerateInputSchema.safeParse(input)
      expect(result.success).toBe(true)
    })

    it('accepts textDescription without audio', () => {
      const input = {
        textDescription: 'I help product managers ship faster',
        price: 100,
        userName: 'Sarah',
      }

      const result = aiGenerateInputSchema.safeParse(input)
      expect(result.success).toBe(true)
    })
  })
})
