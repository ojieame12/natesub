/**
 * Fee Constants Tests
 *
 * Verifies that fee constants are consistent across the codebase
 * and match the expected values for the split fee model.
 */

import { describe, it, expect } from 'vitest'
import {
  PLATFORM_FEE_RATE,
  SPLIT_RATE,
  CROSS_BORDER_BUFFER,
  PROCESSOR_FEES,
  DEFAULT_PROCESSOR_FEE,
  MIN_MARGIN_CENTS,
  DEFAULT_MIN_MARGIN,
} from '../../src/constants/fees'

describe('Fee Constants', () => {
  describe('Core Fee Rates', () => {
    it('platform fee rate should be 9%', () => {
      expect(PLATFORM_FEE_RATE).toBe(0.09)
    })

    it('split rate should be 4.5% (half of platform fee)', () => {
      expect(SPLIT_RATE).toBe(0.045)
    })

    it('split rates should sum to platform fee', () => {
      expect(SPLIT_RATE * 2).toBe(PLATFORM_FEE_RATE)
    })

    it('cross-border buffer should be 1.5%', () => {
      expect(CROSS_BORDER_BUFFER).toBe(0.015)
    })
  })

  describe('Processor Fee Estimates', () => {
    it('should have fees for all supported currencies', () => {
      const supportedCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'ZAR', 'KES', 'NGN', 'GHS']
      for (const currency of supportedCurrencies) {
        expect(PROCESSOR_FEES[currency]).toBeDefined()
        expect(PROCESSOR_FEES[currency].percentRate).toBeGreaterThan(0)
        expect(PROCESSOR_FEES[currency].fixedCents).toBeGreaterThanOrEqual(0)
      }
    })

    it('USD processor fee should be 2.9% + 30 cents', () => {
      expect(PROCESSOR_FEES.USD.percentRate).toBe(0.029)
      expect(PROCESSOR_FEES.USD.fixedCents).toBe(30)
    })

    it('NGN processor fee should be 1.5% + 10000 kobo (₦100)', () => {
      expect(PROCESSOR_FEES.NGN.percentRate).toBe(0.015)
      expect(PROCESSOR_FEES.NGN.fixedCents).toBe(10000)
    })

    it('default processor fee should be conservative', () => {
      expect(DEFAULT_PROCESSOR_FEE.percentRate).toBe(0.029)
      expect(DEFAULT_PROCESSOR_FEE.fixedCents).toBe(30)
    })
  })

  describe('Minimum Margins', () => {
    it('should have margins for all supported currencies', () => {
      const supportedCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'ZAR', 'KES', 'NGN', 'GHS']
      for (const currency of supportedCurrencies) {
        expect(MIN_MARGIN_CENTS[currency]).toBeDefined()
        expect(MIN_MARGIN_CENTS[currency]).toBeGreaterThan(0)
      }
    })

    it('USD minimum margin should be 25 cents', () => {
      expect(MIN_MARGIN_CENTS.USD).toBe(25)
    })

    it('NGN minimum margin should be 25000 kobo (₦250)', () => {
      expect(MIN_MARGIN_CENTS.NGN).toBe(25000)
    })

    it('default minimum margin should be 25', () => {
      expect(DEFAULT_MIN_MARGIN).toBe(25)
    })
  })

  describe('Platform Fee Profitability', () => {
    it('platform fee should exceed processor fees for typical transactions', () => {
      // For a $100 transaction
      const amountCents = 10000
      const platformFee = amountCents * PLATFORM_FEE_RATE // $8.00

      // USD processor fee: 2.9% + $0.30 = $3.20
      const usdProcessorFee = amountCents * PROCESSOR_FEES.USD.percentRate + PROCESSOR_FEES.USD.fixedCents

      expect(platformFee).toBeGreaterThan(usdProcessorFee)
      expect(platformFee - usdProcessorFee).toBeGreaterThan(MIN_MARGIN_CENTS.USD)
    })

    it('platform fee should exceed processor fees for NGN transactions', () => {
      // For ₦10,000 transaction (1,000,000 kobo)
      const amountKobo = 1000000
      const platformFee = amountKobo * PLATFORM_FEE_RATE // ₦800 (80,000 kobo)

      // NGN processor fee: 1.5% + ₦100 = ₦250 (25,000 kobo)
      const ngnProcessorFee = amountKobo * PROCESSOR_FEES.NGN.percentRate + PROCESSOR_FEES.NGN.fixedCents

      expect(platformFee).toBeGreaterThan(ngnProcessorFee)
      expect(platformFee - ngnProcessorFee).toBeGreaterThan(MIN_MARGIN_CENTS.NGN)
    })
  })
})
