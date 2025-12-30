import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../test/testUtils'
import ManageSubscription from './ManageSubscription'

// Mock react-router-dom
const mockParams = { token: 'test-token-123' }
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useParams: () => mockParams,
  }
})

// Mock API responses
const mockSubscriptionData = {
  subscription: {
    id: 'sub-123',
    status: 'active',
    cancelAtPeriodEnd: false,
    amount: 10,
    currency: 'USD',
    interval: 'month',
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    startedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    provider: 'stripe' as const,
    canUpdatePayment: true,
    updatePaymentMethod: 'portal' as const,
    billingDescriptor: 'NATEPAY* JOHN DOE',
    isPastDue: false,
    pastDueMessage: null,
  },
  creator: {
    displayName: 'John Doe',
    username: 'johndoe',
    avatarUrl: null,
  },
  subscriber: {
    maskedEmail: 'j***n@example.com',
  },
  stats: {
    totalSupported: 120,
    memberSince: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    paymentCount: 12,
  },
  payments: [
    { id: 'pay-1', amount: 10, currency: 'USD', date: new Date().toISOString(), type: 'recurring' },
  ],
  actions: {
    resubscribeUrl: 'https://natepay.co/johndoe',
    canOpenPortal: true,
  },
}

let mockApiGet = vi.fn()
let mockApiCancel = vi.fn()
let mockApiPortal = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    subscriptionManage: {
      get: (...args: any[]) => mockApiGet(...args),
      cancel: (...args: any[]) => mockApiCancel(...args),
      getPortalUrl: (...args: any[]) => mockApiPortal(...args),
    },
  },
}))

describe('ManageSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiGet = vi.fn().mockResolvedValue(mockSubscriptionData)
    mockApiCancel = vi.fn().mockResolvedValue({ success: true })
    mockApiPortal = vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/session' })
  })

  describe('Status labels', () => {
    it('shows "Active" for active status', async () => {
      renderWithProviders(<ManageSubscription />)

      await waitFor(() => {
        expect(screen.getByText('Active')).toBeInTheDocument()
      })
    })

    it('shows "Past Due" for past_due status', async () => {
      mockApiGet.mockResolvedValue({
        ...mockSubscriptionData,
        subscription: { ...mockSubscriptionData.subscription, status: 'past_due' },
      })

      renderWithProviders(<ManageSubscription />)

      await waitFor(() => {
        expect(screen.getByText('Past Due')).toBeInTheDocument()
      })
    })

    it('shows "Canceled" for canceled status', async () => {
      mockApiGet.mockResolvedValue({
        ...mockSubscriptionData,
        subscription: { ...mockSubscriptionData.subscription, status: 'canceled' },
      })

      renderWithProviders(<ManageSubscription />)

      await waitFor(() => {
        // Canceled view shows "Subscription Canceled" header
        expect(screen.getByText('Subscription Canceled')).toBeInTheDocument()
      })
    })
  })

  describe('Billing descriptor', () => {
    it('shows NATEPAY* prefixed billing descriptor', async () => {
      renderWithProviders(<ManageSubscription />)

      await waitFor(() => {
        // Check for the label and the descriptor (may be in separate elements)
        expect(screen.getByText(/Appears on statement as:/)).toBeInTheDocument()
        // Use regex to find text containing NATEPAY* prefix
        expect(screen.getByText(/NATEPAY\* JOHN DOE/)).toBeInTheDocument()
      })
    })
  })

  describe('Resubscribe URL', () => {
    it('shows resubscribe button using PUBLIC_PAGE_URL', async () => {
      mockApiGet.mockResolvedValue({
        ...mockSubscriptionData,
        subscription: { ...mockSubscriptionData.subscription, status: 'canceled' },
      })

      renderWithProviders(<ManageSubscription />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /resubscribe/i })).toBeInTheDocument()
      })
    })
  })

  describe('Total supported', () => {
    it('shows total supported amount', async () => {
      renderWithProviders(<ManageSubscription />)

      await waitFor(() => {
        expect(screen.getByText('Total supported')).toBeInTheDocument()
        expect(screen.getByText('$120.00')).toBeInTheDocument()
      })
    })
  })

  describe('Update payment button', () => {
    it('shows update payment button for Stripe users', async () => {
      renderWithProviders(<ManageSubscription />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /update payment method/i })).toBeInTheDocument()
      })
    })

    it('shows Paystack hint when canUpdatePayment is false', async () => {
      mockApiGet.mockResolvedValue({
        ...mockSubscriptionData,
        subscription: {
          ...mockSubscriptionData.subscription,
          provider: 'paystack',
          canUpdatePayment: false,
          updatePaymentMethod: 'resubscribe',
        },
      })

      renderWithProviders(<ManageSubscription />)

      await waitFor(() => {
        expect(screen.getByText(/cancel and resubscribe/i)).toBeInTheDocument()
      })
    })
  })

  describe('Past due alert', () => {
    it('shows past due alert when isPastDue is true', async () => {
      mockApiGet.mockResolvedValue({
        ...mockSubscriptionData,
        subscription: {
          ...mockSubscriptionData.subscription,
          isPastDue: true,
          pastDueMessage: 'Your last payment failed. Please update your payment method.',
        },
      })

      renderWithProviders(<ManageSubscription />)

      await waitFor(() => {
        expect(screen.getByText('Payment Failed')).toBeInTheDocument()
        expect(screen.getByText(/Your last payment failed/)).toBeInTheDocument()
      })
    })
  })
})
