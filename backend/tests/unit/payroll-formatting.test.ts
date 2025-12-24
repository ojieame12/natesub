import { describe, it, expect } from 'vitest'
import { formatPaymentDescription } from '../../src/services/payroll.js'

describe('formatPaymentDescription', () => {
  it('should format recurring payment with tier name', () => {
    const result = formatPaymentDescription('Pro Plan', 'recurring', 'john@example.com')
    expect(result).toBe('Pro Plan - Subscription (j***n@example.com)')
  })

  it('should format one-time payment with tier name', () => {
    const result = formatPaymentDescription('Basic', 'one_time', 'jane@test.com')
    expect(result).toBe('Basic - One-time payment (j***e@test.com)')
  })

  it('should use "Subscription" as default when tier is null', () => {
    const result = formatPaymentDescription(null, 'recurring', 'user@example.com')
    expect(result).toBe('Subscription - Subscription (u***r@example.com)')
  })

  it('should handle empty email gracefully', () => {
    const result = formatPaymentDescription('Premium', 'recurring', '')
    expect(result).toBe('Premium - Subscription (****)')
  })

  it('should handle email without @ symbol', () => {
    const result = formatPaymentDescription('Gold', 'one_time', 'invalidemail')
    expect(result).toBe('Gold - One-time payment (****)')
  })

  it('should handle short email local parts', () => {
    const result = formatPaymentDescription('Silver', 'recurring', 'jo@example.com')
    expect(result).toBe('Silver - Subscription (j***@example.com)')
  })

  it('should mask email correctly for longer local parts', () => {
    const result = formatPaymentDescription('Bronze', 'recurring', 'johndoe@example.com')
    expect(result).toBe('Bronze - Subscription (j***e@example.com)')
  })

  it('should handle single character local part', () => {
    const result = formatPaymentDescription('Starter', 'one_time', 'a@example.com')
    expect(result).toBe('Starter - One-time payment (a***@example.com)')
  })
})
