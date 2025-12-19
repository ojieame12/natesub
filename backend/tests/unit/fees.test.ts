import { describe, it, expect } from 'vitest'
import { calculateServiceFee } from '../../src/services/fees.js'

describe('calculateServiceFee', () => {
  it('should use 50 cent floor for USD > $1', () => {
    // $2.00 USD
    // 8% = 16 cents. Floor = 50 cents.
    const result = calculateServiceFee(200, 'USD', 'personal', 'absorb')
    expect(result.feeCents).toBe(50)
    expect(result.netCents).toBe(150)
  })

  it('should use 500 Naira floor for NGN > 1000 Naira', () => {
    // 2000 Naira (200000 kobo).
    // 8% = 160 Naira. Floor = 500 Naira (50000 kobo).
    // Amount > 2 * minFee (200000 > 100000) -> true
    const result = calculateServiceFee(200000, 'NGN', 'personal', 'absorb')
    expect(result.feeCents).toBe(50000) // 500 NGN
  })

  it('should NOT apply floor for micro-transactions (< 2x floor)', () => {
    // $0.50 USD (50 cents)
    // Floor is 50. Amount is 50. Amount > 100 is false.
    // 8% of 50 = 4 cents.
    const result = calculateServiceFee(50, 'USD', 'personal', 'absorb')
    expect(result.feeCents).toBe(4)
  })

  it('should apply cross-border buffer (1.5%)', () => {
    // $100.00 USD
    // Base 8% + 1.5% = 9.5%
    // Fee = $9.50 (950 cents)
    const result = calculateServiceFee(10000, 'USD', 'personal', 'absorb', true)
    expect(result.feeCents).toBe(950)
  })

  it('should handle pass_to_subscriber mode correctly', () => {
    // $100.00 USD
    // 8% fee = $8.00
    // Gross = $108.00, Net = $100.00
    const result = calculateServiceFee(10000, 'USD', 'personal', 'pass_to_subscriber')
    expect(result.feeCents).toBe(800)
    expect(result.grossCents).toBe(10800)
    expect(result.netCents).toBe(10000)
  })
})
