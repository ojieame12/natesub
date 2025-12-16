import { describe, expect, it } from 'vitest'
import {
  centsToDisplayAmount,
  displayAmountToCents,
  formatCompactNumber,
  formatCurrency,
  formatCurrencyFromCents,
  getCurrencySymbol,
  isZeroDecimalCurrency,
} from './currency'

describe('utils/currency', () => {
  it('detects zero-decimal currencies', () => {
    expect(isZeroDecimalCurrency('JPY')).toBe(true)
    expect(isZeroDecimalCurrency('jpy')).toBe(true)
    expect(isZeroDecimalCurrency('USD')).toBe(false)
  })

  it('converts cents to display amounts (and back) with zero-decimal support', () => {
    expect(centsToDisplayAmount(1234, 'USD')).toBe(12.34)
    expect(displayAmountToCents(12.34, 'USD')).toBe(1234)

    expect(centsToDisplayAmount(1234, 'JPY')).toBe(1234)
    expect(displayAmountToCents(1234.9, 'JPY')).toBe(1235)
  })

  it('formats currencies with expected symbols and decimal rules', () => {
    expect(getCurrencySymbol('usd')).toBe('$')
    expect(formatCurrency(10, 'USD')).toBe('$10.00')
    expect(formatCurrency(10, 'JPY')).toBe('¥10')
    expect(formatCurrencyFromCents(1000, 'USD')).toBe('$10.00')
    expect(formatCurrencyFromCents(1000, 'JPY')).toBe('¥1,000')
  })

  it('formats compact numbers without symbols', () => {
    expect(formatCompactNumber(999)).toBe('999')
    expect(formatCompactNumber(1000)).toBe('1,000')
    expect(formatCompactNumber(10_000)).toBe('10K')
    expect(formatCompactNumber(1_500_000)).toBe('1.5M')
    expect(formatCompactNumber(1_500_000_000)).toBe('1.5B')
    expect(formatCompactNumber(1_500_000_000_000)).toBe('1.5T')
    expect(formatCompactNumber(999_950_000)).toBe('1B')
    expect(formatCompactNumber(-1500)).toBe('-1,500')
    expect(formatCompactNumber(10.49999997)).toBe('10.5')
  })
})
