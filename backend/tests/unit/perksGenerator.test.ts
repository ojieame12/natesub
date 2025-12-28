import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/config/env.js', () => ({
  env: {
    GOOGLE_AI_API_KEY: 'test-api-key',
  },
}))

// Create a mock generateContent function we can control
const mockGenerateContent = vi.fn()

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}))

import { generatePerks, inferServiceType, validatePerks } from '../../src/services/ai/perksGenerator'

describe('Perks Generator', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock response - successful 3 perks
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        perks: ['Custom meal plans', 'Weekly check-ins', 'Direct messaging'],
      }),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('generatePerks', () => {
    it('generates exactly 3 perks', async () => {
      const perks = await generatePerks({
        serviceDescription: 'Personal fitness coaching',
        pricePerMonth: 200,
      })

      expect(perks).toHaveLength(3)
      expect(perks[0]).toHaveProperty('id')
      expect(perks[0]).toHaveProperty('title')
      expect(perks[0].title).toBe('Custom meal plans')
    })

    it('uses premium tier language for high price', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          perks: ['Daily coaching sessions', 'On-call access 24/7', 'Custom programs'],
        }),
      })

      await generatePerks({
        serviceDescription: 'Executive coaching',
        pricePerMonth: 1000,
      })

      const prompt = mockGenerateContent.mock.calls[0][0].contents[0].text
      expect(prompt).toContain('premium')
    })

    it('uses entry-level tier language for low price', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          perks: ['Monthly updates', 'Email support', 'Resource access'],
        }),
      })

      await generatePerks({
        serviceDescription: 'Basic mentorship',
        pricePerMonth: 50,
      })

      const prompt = mockGenerateContent.mock.calls[0][0].contents[0].text
      expect(prompt).toContain('entry-level')
    })

    it('uses mid-tier language for medium price', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          perks: ['Bi-weekly calls', 'Action plans', 'Priority support'],
        }),
      })

      await generatePerks({
        serviceDescription: 'Business consulting',
        pricePerMonth: 250,
      })

      const prompt = mockGenerateContent.mock.calls[0][0].contents[0].text
      expect(prompt).toContain('mid-tier')
    })

    it('falls back to generic perks on parse error', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: 'invalid json response',
      })

      const perks = await generatePerks({
        serviceDescription: 'Fitness coaching',
        serviceType: 'fitness',
        pricePerMonth: 100,
      })

      expect(perks).toHaveLength(3)
      // Should use fitness fallback
      expect(perks[0].title).toBe('Custom workout plans')
    })

    it('falls back when AI returns wrong perk count (too few)', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          perks: ['Only one perk'],
        }),
      })

      const perks = await generatePerks({
        serviceDescription: 'Generic service',
        pricePerMonth: 50,
      })

      expect(perks).toHaveLength(3)
    })

    it('falls back when AI returns wrong perk count (too many)', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          perks: ['One', 'Two', 'Three', 'Four', 'Five'],
        }),
      })

      const perks = await generatePerks({
        serviceDescription: 'Generic service',
        pricePerMonth: 50,
      })

      expect(perks).toHaveLength(3)
    })

    it('falls back when API throws error', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('API Error'))

      const perks = await generatePerks({
        serviceDescription: 'Test service',
        pricePerMonth: 100,
      })

      expect(perks).toHaveLength(3)
    })

    it('handles JSON wrapped in markdown code blocks', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: '```json\n{"perks": ["Perk 1", "Perk 2", "Perk 3"]}\n```',
      })

      const perks = await generatePerks({
        serviceDescription: 'Test service',
        pricePerMonth: 100,
      })

      expect(perks).toHaveLength(3)
      expect(perks[0].title).toBe('Perk 1')
    })

    it('includes service type and industry in prompt when provided', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          perks: ['A', 'B', 'C'],
        }),
      })

      await generatePerks({
        serviceDescription: 'Helping people get fit',
        serviceType: 'fitness coaching',
        industry: 'health',
        pricePerMonth: 200,
        displayName: 'Jane Doe',
      })

      const prompt = mockGenerateContent.mock.calls[0][0].contents[0].text
      expect(prompt).toContain('fitness coaching')
      expect(prompt).toContain('health')
      expect(prompt).toContain('Jane Doe')
    })

    it('generates unique IDs for each perk', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: JSON.stringify({
          perks: ['Perk A', 'Perk B', 'Perk C'],
        }),
      })

      const perks = await generatePerks({
        serviceDescription: 'Test',
        pricePerMonth: 100,
      })

      const ids = perks.map(p => p.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(3)
    })

    it('uses correct industry-specific fallback perks', async () => {
      // All calls will fail, triggering fallback
      mockGenerateContent.mockRejectedValue(new Error('API Error'))

      // Test different industries
      const fitnessPerks = await generatePerks({
        serviceDescription: 'Fitness',
        serviceType: 'fitness',
        pricePerMonth: 100,
      })
      expect(fitnessPerks[0].title).toBe('Custom workout plans')

      const consultingPerks = await generatePerks({
        serviceDescription: 'Consulting',
        serviceType: 'consulting',
        pricePerMonth: 100,
      })
      expect(consultingPerks[0].title).toBe('Bi-weekly consulting calls')

      const techPerks = await generatePerks({
        serviceDescription: 'Tech',
        serviceType: 'tech',
        pricePerMonth: 100,
      })
      expect(techPerks[0].title).toBe('Weekly code reviews')
    })
  })

  describe('inferServiceType', () => {
    it('categorizes fitness description correctly', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: 'fitness',
      })

      const type = await inferServiceType('I help people lose weight and build muscle')
      expect(type).toBe('fitness')
    })

    it('returns lowercase category', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: 'CONSULTING',
      })

      const type = await inferServiceType('Business strategy advice')
      expect(type).toBe('consulting')
    })

    it('returns other for invalid categories', async () => {
      mockGenerateContent.mockResolvedValueOnce({
        text: 'random-invalid-category',
      })

      const type = await inferServiceType('Something unusual')
      expect(type).toBe('other')
    })

    it('returns other on API error', async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error('API Error'))

      const type = await inferServiceType('Test description')
      expect(type).toBe('other')
    })
  })

  describe('validatePerks', () => {
    it('validates correct perks array', () => {
      const perks = [
        { id: '1', title: 'Perk 1', enabled: true },
        { id: '2', title: 'Perk 2', enabled: true },
        { id: '3', title: 'Perk 3', enabled: true },
      ]
      expect(validatePerks(perks)).toBe(true)
    })

    it('rejects non-array input', () => {
      expect(validatePerks('not an array')).toBe(false)
      expect(validatePerks(null)).toBe(false)
      expect(validatePerks(undefined)).toBe(false)
      expect(validatePerks({})).toBe(false)
    })

    it('rejects wrong number of perks', () => {
      expect(validatePerks([{ id: '1', title: 'One', enabled: true }])).toBe(false)
      expect(validatePerks([
        { id: '1', title: 'One', enabled: true },
        { id: '2', title: 'Two', enabled: true },
      ])).toBe(false)
      expect(validatePerks([
        { id: '1', title: 'One', enabled: true },
        { id: '2', title: 'Two', enabled: true },
        { id: '3', title: 'Three', enabled: true },
        { id: '4', title: 'Four', enabled: true },
      ])).toBe(false)
    })

    it('rejects perks with missing fields', () => {
      expect(validatePerks([
        { title: 'No ID', enabled: true },
        { id: '2', title: 'Two', enabled: true },
        { id: '3', title: 'Three', enabled: true },
      ])).toBe(false)

      expect(validatePerks([
        { id: '1', enabled: true },
        { id: '2', title: 'Two', enabled: true },
        { id: '3', title: 'Three', enabled: true },
      ])).toBe(false)

      // Missing enabled field
      expect(validatePerks([
        { id: '1', title: 'One' },
        { id: '2', title: 'Two', enabled: true },
        { id: '3', title: 'Three', enabled: true },
      ])).toBe(false)
    })

    it('rejects empty titles', () => {
      expect(validatePerks([
        { id: '1', title: '', enabled: true },
        { id: '2', title: 'Two', enabled: true },
        { id: '3', title: 'Three', enabled: true },
      ])).toBe(false)
    })

    it('rejects overly long titles', () => {
      const longTitle = 'a'.repeat(101)
      expect(validatePerks([
        { id: '1', title: longTitle, enabled: true },
        { id: '2', title: 'Two', enabled: true },
        { id: '3', title: 'Three', enabled: true },
      ])).toBe(false)
    })
  })
})
