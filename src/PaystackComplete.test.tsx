import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import PaystackComplete from './PaystackComplete'
import { renderWithProviders } from './test/testUtils'
import { api } from './api'

// Mock API
vi.mock('./api', () => ({
  api: {
    paystack: {
      verifyTransaction: vi.fn(),
    },
  },
}))

// Mock navigation
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

describe('PaystackComplete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('verifies payment successfully', async () => {
    vi.mocked(api.paystack.verifyTransaction).mockResolvedValue({
      verified: true,
      status: 'success',
      amount: 500000,
      currency: 'NGN',
      creatorUsername: 'creator123',
    })

    // Simulate URL params
    renderWithProviders(<PaystackComplete />, {
      route: '/payment/success?reference=ref_123&creator=creator123'
    })

    expect(screen.getByText('Verifying payment...')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Payment Successful!')).toBeInTheDocument()
    })
    
    // Check amount formatting (500000 kobo -> NGN 5,000.00)
    // The exact format depends on formatCurrencyFromCents impl, but usually contains symbol
    expect(screen.getByText(/5,000/)).toBeInTheDocument()
  })

  it('handles verification error', async () => {
    vi.mocked(api.paystack.verifyTransaction).mockRejectedValue({ error: 'Verification failed' })

    renderWithProviders(<PaystackComplete />, {
      route: '/payment/success?reference=ref_invalid'
    })

    await waitFor(() => {
      expect(screen.getByText('Payment Issue')).toBeInTheDocument()
      expect(screen.getByText('Verification failed')).toBeInTheDocument()
    })
  })

  it('handles missing reference', async () => {
    renderWithProviders(<PaystackComplete />, {
      route: '/payment/success' // No reference
    })

    await waitFor(() => {
      expect(screen.getByText('Payment Issue')).toBeInTheDocument()
      expect(screen.getByText('No payment reference found')).toBeInTheDocument()
    })
  })

  it('redirects to creator page on done', async () => {
    vi.mocked(api.paystack.verifyTransaction).mockResolvedValue({
      verified: true,
      status: 'success',
      amount: 500000,
      currency: 'NGN',
      creatorUsername: 'creator123',
    })

    renderWithProviders(<PaystackComplete />, {
      route: '/payment/success?reference=ref_123&creator=creator123'
    })

    await waitFor(() => {
      expect(screen.getByText('Done')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Done'))

    // Now includes reference for verification on creator page
    expect(mockNavigate).toHaveBeenCalledWith('/creator123?success=true&provider=paystack&reference=ref_123')
  })
})
