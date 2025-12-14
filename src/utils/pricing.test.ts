import { describe, expect, it } from 'vitest'
import {
  calculateFee,
  calculateFeePreview,
  calculateNet,
  formatFee,
  getPricing,
  PRICING,
} from './pricing'

describe('utils/pricing', () => {
  it('returns personal pricing by default', () => {
    expect(getPricing(undefined)).toEqual(PRICING.personal)
    expect(getPricing('tips')).toEqual(PRICING.personal)
  })

  it('returns service pricing for service purpose', () => {
    expect(getPricing('service')).toEqual(PRICING.service)
  })

  it('formats fee percentages', () => {
    expect(formatFee(0.1)).toBe('10%')
    expect(formatFee(0.085)).toBe('9%')
  })

  it('calculates fee + net amounts (personal vs service)', () => {
    // $10.00 gross
    expect(calculateFee(1000, 'personal')).toBe(100) // 10%
    expect(calculateNet(1000, 'personal')).toBe(900)

    expect(calculateFee(1000, 'service')).toBe(80) // 8%
    expect(calculateNet(1000, 'service')).toBe(920)
  })

  it('calculates fee preview when creator absorbs fee', () => {
    const preview = calculateFeePreview(1000, 'service', 'absorb')
    expect(preview.subscriberPays).toBe(1000)
    expect(preview.creatorReceives).toBe(920)
    expect(preview.feeAmount).toBe(80)
    expect(preview.feePercent).toBe(8)
  })

  it('calculates fee preview when subscriber pays the fee', () => {
    const preview = calculateFeePreview(1000, 'personal', 'pass_to_subscriber')
    // subscriberPays = 1000 / 0.9 = 1111.11 -> rounded
    expect(preview.subscriberPays).toBe(1111)
    expect(preview.creatorReceives).toBe(1000)
    expect(preview.feeAmount).toBe(111)
    expect(preview.feePercent).toBe(10)
  })
})

