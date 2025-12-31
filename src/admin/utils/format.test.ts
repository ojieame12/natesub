import { describe, it, expect } from 'vitest'
import { formatCurrency, formatNumber, formatDate } from './format'

describe('Admin Format Utils', () => {
  describe('formatCurrency', () => {
    it('formats USD correctly', () => {
      expect(formatCurrency(1000, 'USD')).toBe('$10.00')
      expect(formatCurrency(1050, 'USD')).toBe('$10.50')
      expect(formatCurrency(0, 'USD')).toBe('$0.00')
    })

    it('formats EUR correctly', () => {
      const result = formatCurrency(1000, 'EUR')
      // Check for numbers, symbol might vary by locale/environment but usually contains €
      expect(result).toContain('10.00')
    })

    it('formats zero-decimal currencies (JPY) correctly', () => {
      // 1000 input -> 1000 output (no division)
      expect(formatCurrency(1000, 'JPY')).toBe('¥1,000')
      expect(formatCurrency(500, 'JPY')).toBe('¥500')
    })

    it('defaults to USD if currency is missing', () => {
      expect(formatCurrency(2500)).toBe('$25.00')
    })

    it('handles invalid currency codes gracefully', () => {
      const result = formatCurrency(1000, 'XYZ')
      // Intl usually accepts custom/unknown codes and puts them as prefix/suffix
      expect(result).toContain('XYZ')
      expect(result).toContain('10.00')
    })

    it('handles NaN/invalid inputs', () => {
      expect(formatCurrency(NaN)).toBe('0.00')
      // @ts-expect-error
      expect(formatCurrency(null)).toBe('0.00')
    })
  })

  describe('formatNumber', () => {
    it('formats numbers with commas', () => {
      expect(formatNumber(1000)).toBe('1,000')
      expect(formatNumber(1000000)).toBe('1,000,000')
    })
  })

  describe('formatDate', () => {
    it('formats dates correctly', () => {
      const date = new Date('2023-01-01T12:00:00Z')
      expect(formatDate(date)).toContain('Jan 1, 2023')
    })

    it('handles invalid dates', () => {
      expect(formatDate(null)).toBe('-')
      expect(formatDate(undefined)).toBe('-')
    })
  })
})
