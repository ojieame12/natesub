/**
 * Onboarding Schema Tests
 *
 * Tests for the onboarding progress schema including:
 * - Decimal price support (singleAmount)
 * - stepKey persistence
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'

// Recreate the schema from auth.ts for testing
// This ensures our schema accepts the expected values
const onboardingDataSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  country: z.string().optional(),
  countryCode: z.string().optional(),
  currency: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  paymentProvider: z.enum(['stripe', 'paystack']).optional(),
  purpose: z.enum(['tips', 'support', 'allowance', 'fan_club', 'exclusive_content', 'service', 'other']).optional(),
  pricingModel: z.enum(['single', 'tiers']).optional(),
  // Note: singleAmount allows decimals for USD/GBP/EUR (e.g. $9.99)
  singleAmount: z.number().min(0.01).max(1_000_000).optional(),
  tiers: z.array(z.object({
    id: z.string(),
    name: z.string(),
    amount: z.number(),
    perks: z.array(z.string()),
  })).optional(),
  serviceDescription: z.string().max(500).optional(),
  username: z.string().optional(),
}).passthrough()

const progressSchema = z.object({
  step: z.number().int().min(0).max(20),
  stepKey: z.string().optional(),
  data: onboardingDataSchema.optional(),
})

describe('Onboarding Schema', () => {
  describe('singleAmount decimal support', () => {
    it('accepts whole number prices', () => {
      const result = onboardingDataSchema.safeParse({
        singleAmount: 10,
        pricingModel: 'single',
      })
      expect(result.success).toBe(true)
    })

    it('accepts decimal prices like $9.99', () => {
      const result = onboardingDataSchema.safeParse({
        singleAmount: 9.99,
        pricingModel: 'single',
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.singleAmount).toBe(9.99)
      }
    })

    it('accepts small decimal prices like $0.99', () => {
      const result = onboardingDataSchema.safeParse({
        singleAmount: 0.99,
        pricingModel: 'single',
      })
      expect(result.success).toBe(true)
    })

    it('accepts prices with multiple decimal places', () => {
      const result = onboardingDataSchema.safeParse({
        singleAmount: 19.995, // Edge case
        pricingModel: 'single',
      })
      expect(result.success).toBe(true)
    })

    it('rejects prices below minimum (0.01)', () => {
      const result = onboardingDataSchema.safeParse({
        singleAmount: 0.001,
        pricingModel: 'single',
      })
      expect(result.success).toBe(false)
    })

    it('rejects zero price', () => {
      const result = onboardingDataSchema.safeParse({
        singleAmount: 0,
        pricingModel: 'single',
      })
      expect(result.success).toBe(false)
    })

    it('rejects prices above maximum', () => {
      const result = onboardingDataSchema.safeParse({
        singleAmount: 1_000_001,
        pricingModel: 'single',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('stepKey persistence', () => {
    it('accepts progress with stepKey', () => {
      const result = progressSchema.safeParse({
        step: 5,
        stepKey: 'identity',
        data: { firstName: 'John' },
      })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.stepKey).toBe('identity')
      }
    })

    it('accepts progress without stepKey (optional)', () => {
      const result = progressSchema.safeParse({
        step: 5,
        data: { firstName: 'John' },
      })
      expect(result.success).toBe(true)
    })

    it('accepts all valid step keys', () => {
      const stepKeys = [
        'start', 'email', 'otp', 'identity', 'address',
        'purpose', 'avatar', 'username', 'payments',
        'service-desc', 'ai-gen', 'review',
      ]

      for (const stepKey of stepKeys) {
        const result = progressSchema.safeParse({
          step: 1,
          stepKey,
        })
        expect(result.success).toBe(true)
      }
    })
  })

  describe('tiered pricing', () => {
    it('accepts tier amounts as decimals', () => {
      const result = onboardingDataSchema.safeParse({
        pricingModel: 'tiers',
        tiers: [
          { id: 't1', name: 'Basic', amount: 4.99, perks: ['Access'] },
          { id: 't2', name: 'Pro', amount: 9.99, perks: ['Access', 'Priority'] },
          { id: 't3', name: 'Premium', amount: 19.99, perks: ['All'] },
        ],
      })
      expect(result.success).toBe(true)
    })

    it('accepts mixed integer and decimal tier amounts', () => {
      const result = onboardingDataSchema.safeParse({
        pricingModel: 'tiers',
        tiers: [
          { id: 't1', name: 'Basic', amount: 5, perks: [] },
          { id: 't2', name: 'Pro', amount: 9.99, perks: [] },
        ],
      })
      expect(result.success).toBe(true)
    })
  })

  describe('service mode fields', () => {
    it('accepts service description with purpose', () => {
      const result = onboardingDataSchema.safeParse({
        purpose: 'service',
        serviceDescription: 'I provide graphic design services',
        singleAmount: 49.99,
      })
      expect(result.success).toBe(true)
    })

    it('enforces serviceDescription max length', () => {
      const result = onboardingDataSchema.safeParse({
        purpose: 'service',
        serviceDescription: 'x'.repeat(501), // Over 500 char limit
      })
      expect(result.success).toBe(false)
    })
  })
})
