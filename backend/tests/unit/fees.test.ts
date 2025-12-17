import { describe, it, expect } from 'vitest'
import { calculateServiceFee } from '../../src/services/fees.js'

describe('calculateServiceFee', () => {
  it('should use 50 cent floor for USD > $1', () => {
    // $2.00 USD
    // 10% = 20 cents. Floor = 50 cents.
    const result = calculateServiceFee(200, 'USD', 'personal', 'absorb')
    expect(result.feeCents).toBe(50)
    expect(result.netCents).toBe(150)
  })

  it('should use 500 Naira floor for NGN > 1000 Naira', () => {
    // 2000 Naira (200000 kobo). 
    // 10% = 200 Naira. Floor = 500 Naira (50000 kobo).
    // Amount > 2 * minFee (200000 > 100000) -> true
    const result = calculateServiceFee(200000, 'NGN', 'personal', 'absorb')
    expect(result.feeCents).toBe(50000) // 500 NGN
  })

  it('should NOT apply floor for micro-transactions (< 2x floor)', () => {
    // $0.50 USD (50 cents)
    // Floor is 50. Amount is 50. Amount > 100 is false.
    // 10% of 50 = 5 cents.
    const result = calculateServiceFee(50, 'USD', 'personal', 'absorb')
    expect(result.feeCents).toBe(5) 
  })

  it('should apply cross-border buffer (1.5%)', () => {
    // $100.00 USD
    // Base 10% + 1.5% = 11.5%
    // Fee = $11.50 (1150 cents)
    const result = calculateServiceFee(10000, 'USD', 'personal', 'absorb', true)
    expect(result.feeCents).toBe(1150)
  })

  it('should handle pass_to_subscriber mode correctly', () => {
    // $100.00 USD
    // 10% fee = $10.00
    // Gross = $110.00, Net = $100.00
    const result = calculateServiceFee(10000, 'USD', 'personal', 'pass_to_subscriber')
    expect(result.feeCents).toBe(1000)
    expect(result.grossCents).toBe(11000)
    expect(result.netCents).toBe(10000)
  })
})
