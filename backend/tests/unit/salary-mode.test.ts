import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { calculateBillingAnchorFromPayday } from '../../src/services/stripe.js'

describe('calculateBillingAnchorFromPayday', () => {
  const DELAY_DAYS = 7

  // Helper to convert Unix timestamp to UTC date string
  function timestampToUTCDate(timestamp: number): string {
    const date = new Date(timestamp * 1000)
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
  }

  // Helper to get day of month from timestamp
  function getDayOfMonth(timestamp: number): number {
    return new Date(timestamp * 1000).getUTCDate()
  }

  describe('mid-month paydays (simple cases)', () => {
    beforeEach(() => {
      // Dec 15, 2024 (mid-month)
      vi.useFakeTimers()
      vi.setSystemTime(new Date(Date.UTC(2024, 11, 15, 12, 0, 0)))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('payday 25 -> billing day 18', () => {
      const anchor = calculateBillingAnchorFromPayday(25, DELAY_DAYS)
      expect(getDayOfMonth(anchor)).toBe(18)
      expect(timestampToUTCDate(anchor)).toBe('2024-12-18')
    })

    it('payday 15 (same as today) -> next month billing day 8', () => {
      const anchor = calculateBillingAnchorFromPayday(15, DELAY_DAYS)
      // Payday 15 is today, so next payday is Jan 15, billing is Jan 8
      expect(getDayOfMonth(anchor)).toBe(8)
      expect(timestampToUTCDate(anchor)).toBe('2025-01-08')
    })
  })

  describe('early month paydays (month boundary crossing)', () => {
    beforeEach(() => {
      // Dec 26, 2024
      vi.useFakeTimers()
      vi.setSystemTime(new Date(Date.UTC(2024, 11, 26, 12, 0, 0)))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('payday 1 -> billing Dec 25 (7 days before Jan 1)', () => {
      const anchor = calculateBillingAnchorFromPayday(1, DELAY_DAYS)
      // Next payday 1 is Jan 1, 2025. Billing = Jan 1 - 7 = Dec 25
      // But Dec 25 is in the past (today is Dec 26), so push to next cycle
      // Next cycle: Feb 1, billing = Jan 25
      expect(getDayOfMonth(anchor)).toBe(25)
      expect(timestampToUTCDate(anchor)).toBe('2025-01-25')
    })

    it('payday 7 -> billing Dec 31', () => {
      const anchor = calculateBillingAnchorFromPayday(7, DELAY_DAYS)
      // Next payday 7 is Jan 7, 2025. Billing = Jan 7 - 7 = Dec 31
      expect(getDayOfMonth(anchor)).toBe(31)
      expect(timestampToUTCDate(anchor)).toBe('2024-12-31')
    })
  })

  describe('late month paydays', () => {
    beforeEach(() => {
      // Dec 20, 2024
      vi.useFakeTimers()
      vi.setSystemTime(new Date(Date.UTC(2024, 11, 20, 12, 0, 0)))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('payday 28 -> billing Dec 21', () => {
      const anchor = calculateBillingAnchorFromPayday(28, DELAY_DAYS)
      // Next payday 28 is Dec 28 (still in future). Billing = Dec 28 - 7 = Dec 21
      expect(getDayOfMonth(anchor)).toBe(21)
      expect(timestampToUTCDate(anchor)).toBe('2024-12-21')
    })

    it('payday 25 -> billing Dec 18 is past, so Jan 18', () => {
      const anchor = calculateBillingAnchorFromPayday(25, DELAY_DAYS)
      // Payday 25 is Dec 25 (future). Billing = Dec 25 - 7 = Dec 18
      // But Dec 18 is in the past (today is Dec 20), so push to next cycle
      // Next cycle: Jan 25, billing = Jan 18
      expect(getDayOfMonth(anchor)).toBe(18)
      expect(timestampToUTCDate(anchor)).toBe('2025-01-18')
    })
  })

  describe('year rollover', () => {
    beforeEach(() => {
      // Dec 30, 2024
      vi.useFakeTimers()
      vi.setSystemTime(new Date(Date.UTC(2024, 11, 30, 12, 0, 0)))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('payday 5 -> billing Dec 29 is past, so Jan 29', () => {
      const anchor = calculateBillingAnchorFromPayday(5, DELAY_DAYS)
      // Next payday 5 is Jan 5, 2025. Billing = Jan 5 - 7 = Dec 29
      // But Dec 29 is in the past (today is Dec 30), so push to next cycle
      // Next cycle: Feb 5, billing = Jan 29
      expect(getDayOfMonth(anchor)).toBe(29)
      expect(timestampToUTCDate(anchor)).toBe('2025-01-29')
    })

    it('payday 10 -> billing Jan 3 (crosses year)', () => {
      const anchor = calculateBillingAnchorFromPayday(10, DELAY_DAYS)
      // Next payday 10 is Jan 10, 2025. Billing = Jan 10 - 7 = Jan 3
      expect(getDayOfMonth(anchor)).toBe(3)
      expect(timestampToUTCDate(anchor)).toBe('2025-01-03')
    })
  })

  describe('billing is always exactly 7 days before payday', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it.each([1, 7, 8, 14, 15, 21, 25, 28])('payday %d: billing is exactly 7 days earlier', (payday) => {
      // Set to a date early enough that all paydays are in the future
      vi.useFakeTimers()
      vi.setSystemTime(new Date(Date.UTC(2024, 0, 1, 12, 0, 0))) // Jan 1, 2024

      const anchor = calculateBillingAnchorFromPayday(payday, DELAY_DAYS)
      const billingDate = new Date(anchor * 1000)

      // Calculate what payday this anchor corresponds to
      const expectedPayday = new Date(billingDate)
      expectedPayday.setUTCDate(expectedPayday.getUTCDate() + DELAY_DAYS)

      expect(expectedPayday.getUTCDate()).toBe(payday)
    })
  })

  describe('edge case: February short month', () => {
    beforeEach(() => {
      // Feb 20, 2024 (leap year)
      vi.useFakeTimers()
      vi.setSystemTime(new Date(Date.UTC(2024, 1, 20, 12, 0, 0)))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('payday 28 -> billing Feb 21', () => {
      const anchor = calculateBillingAnchorFromPayday(28, DELAY_DAYS)
      expect(getDayOfMonth(anchor)).toBe(21)
      expect(timestampToUTCDate(anchor)).toBe('2024-02-21')
    })
  })
})
