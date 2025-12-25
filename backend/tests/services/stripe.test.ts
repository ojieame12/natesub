/**
 * Unit tests for Stripe service FX functions
 *
 * Tests getChargeFxData which retrieves FX conversion data from Stripe
 * for destination charges (platform charge → transfer → connected account).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  usdToNgnCharge,
  usdToNgnTransfer,
  usdToUsdCharge,
  usdToUsdTransfer,
  pendingCharge,
  usdToKesCharge,
  usdToKesTransfer,
} from '../fixtures/fx-data.js'

// Use vi.hoisted to define mock functions before vi.mock hoisting
const { mockChargesRetrieve, mockTransfersRetrieve } = vi.hoisted(() => {
  return {
    mockChargesRetrieve: vi.fn(),
    mockTransfersRetrieve: vi.fn(),
  }
})

vi.mock('stripe', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      charges: {
        retrieve: mockChargesRetrieve,
      },
      transfers: {
        retrieve: mockTransfersRetrieve,
      },
      accounts: {
        retrieve: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      accountLinks: {
        create: vi.fn(),
      },
      balance: {
        retrieve: vi.fn(),
      },
      payouts: {
        list: vi.fn(),
      },
      checkout: {
        sessions: {
          create: vi.fn(),
        },
      },
      subscriptions: {
        update: vi.fn(),
        cancel: vi.fn(),
      },
      invoices: {
        retrieve: vi.fn(),
      },
      billingPortal: {
        sessions: {
          create: vi.fn(),
        },
      },
    })),
  }
})

// Import after mocking
import { getChargeFxData } from '../../src/services/stripe.js'

describe('getChargeFxData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('USD → NGN cross-border payment', () => {
    it('returns FX data for destination charge with currency conversion', async () => {
      // Mock the charge retrieval (from platform account)
      mockChargesRetrieve.mockResolvedValue(usdToNgnCharge)

      // Mock the transfer retrieval with expanded destination_payment
      mockTransfersRetrieve.mockResolvedValue(usdToNgnTransfer)

      const result = await getChargeFxData('ch_usd_to_ngn_test', 'acct_ng_creator_test')

      expect(result.status).toBe('fx_found')
      if (result.status === 'fx_found') {
        expect(result.data).toEqual({
          originalCurrency: 'USD',
          originalAmountCents: 1000, // $10.00
          payoutCurrency: 'NGN',
          payoutAmountCents: 1395000, // ₦13,950
          exchangeRate: 1550.0,
        })
      }

      // Verify correct API calls
      expect(mockChargesRetrieve).toHaveBeenCalledWith('ch_usd_to_ngn_test', {
        expand: ['transfer'],
      })
      expect(mockTransfersRetrieve).toHaveBeenCalledWith('tr_usd_to_ngn_test', {
        expand: ['destination_payment.balance_transaction'],
      })
    })
  })

  describe('USD → USD same currency payment', () => {
    it('returns no_fx status when no FX conversion occurred', async () => {
      mockChargesRetrieve.mockResolvedValue(usdToUsdCharge)
      mockTransfersRetrieve.mockResolvedValue(usdToUsdTransfer)

      const result = await getChargeFxData('ch_usd_to_usd_test', 'acct_us_creator_test')

      // No FX data when currencies are the same
      expect(result.status).toBe('no_fx')
    })
  })

  describe('USD → KES cross-border payment', () => {
    it('returns FX data for Kenya-based creator', async () => {
      mockChargesRetrieve.mockResolvedValue(usdToKesCharge)
      mockTransfersRetrieve.mockResolvedValue(usdToKesTransfer)

      const result = await getChargeFxData('ch_usd_to_kes_test', 'acct_ke_creator_test')

      expect(result.status).toBe('fx_found')
      if (result.status === 'fx_found') {
        expect(result.data).toEqual({
          originalCurrency: 'USD',
          originalAmountCents: 2000, // $20.00
          payoutCurrency: 'KES',
          payoutAmountCents: 234000, // KES 2,340
          exchangeRate: 130.0,
        })
      }
    })
  })

  describe('pending charge (no transfer yet)', () => {
    it('returns pending status when charge has no transfer', async () => {
      mockChargesRetrieve.mockResolvedValue(pendingCharge)

      const result = await getChargeFxData('ch_pending_test', 'acct_ng_creator_test')

      expect(result.status).toBe('pending')
      // Should not try to retrieve transfer
      expect(mockTransfersRetrieve).not.toHaveBeenCalled()
    })
  })

  describe('error handling', () => {
    it('returns error status when charge retrieval fails', async () => {
      mockChargesRetrieve.mockRejectedValue(new Error('Stripe API error'))

      const result = await getChargeFxData('ch_nonexistent', 'acct_test')

      expect(result.status).toBe('error')
    })

    it('returns pending status when transfer has no destination_payment', async () => {
      mockChargesRetrieve.mockResolvedValue(usdToNgnCharge)
      mockTransfersRetrieve.mockResolvedValue({
        id: 'tr_test',
        destination_payment: null,
      })

      const result = await getChargeFxData('ch_usd_to_ngn_test', 'acct_ng_creator_test')

      expect(result.status).toBe('pending')
    })

    it('returns error status when balance_transaction fallback fetch fails', async () => {
      mockChargesRetrieve.mockResolvedValue(usdToNgnCharge)
      mockTransfersRetrieve.mockResolvedValue({
        id: 'tr_test',
        destination_payment: {
          id: 'py_test',
          balance_transaction: 'txn_string_id', // Not expanded, just ID - will trigger fallback
        },
      })

      const result = await getChargeFxData('ch_usd_to_ngn_test', 'acct_ng_creator_test')

      // Fallback fetch will fail since balanceTransactions.retrieve is not mocked
      expect(result.status).toBe('error')
    })
  })

  describe('transfer ID handling', () => {
    it('handles transfer as string ID', async () => {
      mockChargesRetrieve.mockResolvedValue({
        ...usdToNgnCharge,
        transfer: 'tr_string_id', // String, not expanded object
      })
      mockTransfersRetrieve.mockResolvedValue(usdToNgnTransfer)

      const result = await getChargeFxData('ch_usd_to_ngn_test', 'acct_ng_creator_test')

      expect(mockTransfersRetrieve).toHaveBeenCalledWith('tr_string_id', {
        expand: ['destination_payment.balance_transaction'],
      })
      expect(result.status).toBe('fx_found')
    })

    it('handles transfer as expanded object', async () => {
      mockChargesRetrieve.mockResolvedValue({
        ...usdToNgnCharge,
        transfer: { id: 'tr_object_id', amount: 900 }, // Expanded object
      })
      mockTransfersRetrieve.mockResolvedValue(usdToNgnTransfer)

      const result = await getChargeFxData('ch_usd_to_ngn_test', 'acct_ng_creator_test')

      expect(mockTransfersRetrieve).toHaveBeenCalledWith('tr_object_id', {
        expand: ['destination_payment.balance_transaction'],
      })
      expect(result.status).toBe('fx_found')
    })
  })

  describe('amount accuracy', () => {
    it('uses charge.amount for originalAmountCents (gross, not net)', async () => {
      mockChargesRetrieve.mockResolvedValue(usdToNgnCharge)
      mockTransfersRetrieve.mockResolvedValue(usdToNgnTransfer)

      const result = await getChargeFxData('ch_usd_to_ngn_test', 'acct_ng_creator_test')

      // Should use charge.amount (1000), not transfer.amount (900)
      expect(result.status).toBe('fx_found')
      if (result.status === 'fx_found') {
        expect(result.data.originalAmountCents).toBe(1000)
      }
    })

    it('uses balance_transaction.net for payoutAmountCents (after Stripe fees)', async () => {
      mockChargesRetrieve.mockResolvedValue(usdToNgnCharge)
      mockTransfersRetrieve.mockResolvedValue(usdToNgnTransfer)

      const result = await getChargeFxData('ch_usd_to_ngn_test', 'acct_ng_creator_test')

      // Should use balance_transaction.net
      expect(result.status).toBe('fx_found')
      if (result.status === 'fx_found') {
        expect(result.data.payoutAmountCents).toBe(1395000)
      }
    })
  })
})
