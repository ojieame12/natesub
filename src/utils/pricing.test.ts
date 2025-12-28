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
    // $10.00 gross - both personal and service use 9% fee
    expect(calculateFee(1000, 'personal')).toBe(90) // 9%
    expect(calculateNet(1000, 'personal')).toBe(910)

    expect(calculateFee(1000, 'service')).toBe(90) // 9%
    expect(calculateNet(1000, 'service')).toBe(910)
  })

  it('calculates fee preview using split model (ignores legacy feeMode)', () => {
    // Split model: 4.5% subscriber + 4.5% creator = 9% total
    // $10.00 base -> subscriber pays $10.45, creator receives $9.55
    const preview = calculateFeePreview(1000, 'service', 'absorb') // feeMode ignored
    expect(preview.subscriberPays).toBe(1045)    // base + 4.5%
    expect(preview.creatorReceives).toBe(955)    // base - 4.5%
    expect(preview.subscriberFee).toBe(45)       // 4.5% of 1000
    expect(preview.creatorFee).toBe(45)          // 4.5% of 1000
    expect(preview.feeAmount).toBe(90)           // total 9%
    expect(preview.feePercent).toBe(9)
  })

  it('calculates split fee preview for all purpose types', () => {
    // Both personal and service use same split model
    const personalPreview = calculateFeePreview(1000, 'personal')
    const servicePreview = calculateFeePreview(1000, 'service')

    // Same split for both
    expect(personalPreview.subscriberPays).toBe(1045)
    expect(personalPreview.creatorReceives).toBe(955)
    expect(servicePreview.subscriberPays).toBe(1045)
    expect(servicePreview.creatorReceives).toBe(955)
  })
})

