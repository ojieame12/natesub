import { describe, it, expect } from 'vitest'
import { calculateServiceFee, calculateLegacyServiceFee } from '../../src/services/fees.js'

describe('calculateServiceFee (split model v2)', () => {
  it('should split fee 50/50 between subscriber and creator', () => {
    // $100 base price
    // Subscriber pays: $100 + $4 (4%) = $104
    // Creator gets: $100 - $4 (4%) = $96
    // Platform keeps: $8 (8% total)
    const result = calculateServiceFee(10000, 'USD', 'personal')
    expect(result.subscriberFeeCents).toBe(400)  // 4%
    expect(result.creatorFeeCents).toBe(400)     // 4%
    expect(result.feeCents).toBe(800)            // 8% total
    expect(result.grossCents).toBe(10400)        // $104
    expect(result.netCents).toBe(9600)           // $96
    expect(result.baseCents).toBe(10000)         // Original price
    expect(result.feeMode).toBe('split')
    expect(result.feeModel).toBe('split_v1')
  })

  it('should apply processor buffer on small transactions', () => {
    // $5 base price
    // Naive 4% each = $0.20 subscriber + $0.20 creator = $0.40 total
    // But processor fee (~2.9% + $0.30) ≈ $0.45 would exceed platform fee
    // So buffer kicks in to ensure positive margin
    const result = calculateServiceFee(500, 'USD', 'personal')
    expect(result.feeWasCapped).toBe(true)
    expect(result.estimatedMargin).toBeGreaterThan(0)
    expect(result.feeCents).toBeGreaterThan(40) // More than naive 8%
  })

  it('should guarantee positive margin on all transactions', () => {
    const currencies = ['USD', 'NGN', 'KES', 'ZAR', 'GHS']
    const amounts = [100, 500, 1000, 5000, 10000, 50000]

    for (const currency of currencies) {
      for (const amount of amounts) {
        const result = calculateServiceFee(amount, currency, 'personal')
        expect(result.estimatedMargin).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('should add cross-border buffer (1.5% split between parties)', () => {
    // $100 base price with cross-border
    // Base rate: 4% each + 0.75% each = 4.75% each
    // Subscriber: ~$4.75, Creator: ~$4.75
    const result = calculateServiceFee(10000, 'USD', 'personal', undefined, true)
    expect(result.subscriberFeeCents).toBe(475) // 4.75%
    expect(result.creatorFeeCents).toBe(475)    // 4.75%
    expect(result.feeCents).toBe(950)           // 9.5% total
  })

  it('should ignore legacy feeMode parameter', () => {
    // Even if we pass 'absorb', it should use split model
    const result = calculateServiceFee(10000, 'USD', 'personal', 'absorb')
    expect(result.feeMode).toBe('split')
    expect(result.subscriberFeeCents).toBe(400) // 4%
    expect(result.creatorFeeCents).toBe(400)    // 4%
  })

  it('should handle zero amount', () => {
    const result = calculateServiceFee(0, 'USD', 'personal')
    expect(result.feeCents).toBe(0)
    expect(result.grossCents).toBe(0)
    expect(result.netCents).toBe(0)
    expect(result.feeWasCapped).toBe(false)
  })

  it('should handle NGN currency correctly', () => {
    // ₦10,000 (1,000,000 kobo)
    // 4% subscriber = ₦400, 4% creator = ₦400
    const result = calculateServiceFee(1000000, 'NGN', 'personal')
    expect(result.subscriberFeeCents).toBe(40000)  // ₦400
    expect(result.creatorFeeCents).toBe(40000)     // ₦400
    expect(result.feeCents).toBe(80000)            // ₦800 total
    expect(result.currency).toBe('NGN')
  })

  describe('processor buffer edge cases', () => {
    it('should ensure minimum margin on $1 micro-transaction (USD)', () => {
      // $1 transaction - processor would eat all of naive 8% ($0.08)
      // Stripe: 2.9% + $0.30 = ~$0.33 processor cost
      // Without buffer: negative margin!
      const result = calculateServiceFee(100, 'USD', 'personal')
      expect(result.feeWasCapped).toBe(true)
      expect(result.estimatedMargin).toBeGreaterThanOrEqual(25) // $0.25 min margin
      expect(result.feeCents).toBeGreaterThan(result.estimatedProcessorFee)
    })

    it('should ensure minimum margin on ₦500 micro-transaction (NGN)', () => {
      // ₦500 (50000 kobo) - very small for NGN
      // Paystack: 1.5% + ₦100 = ~₦107.50 processor cost
      // Naive 8% = ₦40 fee - would be negative!
      const result = calculateServiceFee(50000, 'NGN', 'personal')
      expect(result.feeWasCapped).toBe(true)
      expect(result.estimatedMargin).toBeGreaterThanOrEqual(25000) // ₦250 min margin
      expect(result.feeCents).toBeGreaterThan(result.estimatedProcessorFee)
    })

    it('should maintain positive margin across all supported currencies at minimum viable amount', () => {
      // Test absolute minimums where processor fees dominate
      const minimums: Record<string, number> = {
        USD: 100,     // $1
        EUR: 100,     // €1
        GBP: 100,     // £1
        NGN: 50000,   // ₦500
        KES: 10000,   // KSh100
        ZAR: 1000,    // R10
        GHS: 1000,    // ₵10
      }

      for (const [currency, minAmount] of Object.entries(minimums)) {
        const result = calculateServiceFee(minAmount, currency, 'personal')
        expect(result.estimatedMargin).toBeGreaterThanOrEqual(0)
        expect(result.feeCents).toBeGreaterThan(result.estimatedProcessorFee)
      }
    })

    it('should not apply buffer on large transactions where 8% exceeds processor costs', () => {
      // $500 transaction - 8% = $40, processor ~$14.80
      // No buffer needed
      const result = calculateServiceFee(50000, 'USD', 'personal')
      expect(result.feeWasCapped).toBe(false)
      expect(result.feeCents).toBe(4000) // Exact 8%
      expect(result.estimatedMargin).toBeGreaterThan(0)
    })
  })
})

describe('calculateLegacyServiceFee (backward compatibility)', () => {
  it('should handle absorb mode for legacy subscriptions', () => {
    // $100 price, creator absorbs 8%
    const result = calculateLegacyServiceFee(10000, 'USD', 'personal', 'absorb')
    expect(result.subscriberFeeCents).toBe(0)       // Subscriber pays nothing extra
    expect(result.creatorFeeCents).toBe(800)        // Creator pays 8%
    expect(result.grossCents).toBe(10000)           // Subscriber pays $100
    expect(result.netCents).toBe(9200)              // Creator gets $92
  })

  it('should handle pass_to_subscriber mode for legacy subscriptions', () => {
    // $100 price, subscriber pays 8%
    const result = calculateLegacyServiceFee(10000, 'USD', 'personal', 'pass_to_subscriber')
    expect(result.subscriberFeeCents).toBe(800)     // Subscriber pays 8%
    expect(result.creatorFeeCents).toBe(0)          // Creator pays nothing
    expect(result.grossCents).toBe(10800)           // Subscriber pays $108
    expect(result.netCents).toBe(10000)             // Creator gets $100
  })

  it('should redirect to split model when feeMode is split', () => {
    const result = calculateLegacyServiceFee(10000, 'USD', 'personal', 'split')
    expect(result.feeMode).toBe('split')
    expect(result.subscriberFeeCents).toBe(400)
    expect(result.creatorFeeCents).toBe(400)
  })
})
