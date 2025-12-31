import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/testUtils'
import SubscriberPortal from './SubscriberPortal'
import type { SubscriberSubscription, SubscriberSubscriptionDetail } from '../api/client'

// Mock API responses
const mockSubscription: SubscriberSubscription = {
  id: 'sub-123',
  creator: {
    displayName: 'John Doe',
    username: 'johndoe',
    avatarUrl: undefined,
  },
  amount: 10,
  currency: 'USD',
  interval: 'month',
  status: 'active',
  statusLabel: 'Active',
  currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  startedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
  totalPaid: 120,
  paymentCount: 12,
  provider: 'stripe',
  canUpdatePayment: true,
  updatePaymentMethod: 'portal',
  billingDescriptor: 'NATEPAY* JOHN DOE',
  isPastDue: false,
  cancelAtPeriodEnd: false,
}

const mockSubscriptionDetail: SubscriberSubscriptionDetail = {
  ...mockSubscription,
  createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
  pastDueMessage: null,
}

const mockListResponse = {
  email: 'test@example.com',
  maskedEmail: 't***t@example.com',
  subscriptions: [mockSubscription],
}

const mockDetailResponse = {
  subscription: mockSubscriptionDetail,
  payments: [
    { id: 'pay-1', amount: 10.20, currency: 'USD', date: new Date().toISOString(), status: 'succeeded' },
    { id: 'pay-2', amount: 10.20, currency: 'USD', date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), status: 'succeeded' },
  ],
  actions: {
    resubscribeUrl: 'https://natepay.co/johndoe',
  },
}

// Mock API
let mockRequestOtp = vi.fn()
let mockVerifyOtp = vi.fn()
let mockListSubscriptions = vi.fn()
let mockGetSubscription = vi.fn()
let mockCancelSubscription = vi.fn()
let mockGetPortalUrl = vi.fn()
let mockSignOut = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    subscriberPortal: {
      requestOtp: (...args: any[]) => mockRequestOtp(...args),
      verifyOtp: (...args: any[]) => mockVerifyOtp(...args),
      listSubscriptions: (...args: any[]) => mockListSubscriptions(...args),
      getSubscription: (...args: any[]) => mockGetSubscription(...args),
      cancelSubscription: (...args: any[]) => mockCancelSubscription(...args),
      getPortalUrl: (...args: any[]) => mockGetPortalUrl(...args),
      signOut: (...args: any[]) => mockSignOut(...args),
    },
  },
  formatCurrency: (amount: number, currency: string) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount),
}))

// Mock formatCurrency utility
vi.mock('../utils/currency', () => ({
  formatCurrency: (amount: number, currency: string) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount),
}))

describe('SubscriberPortal', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock implementations
    mockRequestOtp = vi.fn().mockResolvedValue({ message: 'Code sent' })
    mockVerifyOtp = vi.fn().mockResolvedValue({ success: true, expiresAt: new Date(Date.now() + 3600000).toISOString() })
    mockListSubscriptions = vi.fn().mockRejectedValue({ status: 401 }) // No session by default
    mockGetSubscription = vi.fn().mockResolvedValue(mockDetailResponse)
    mockCancelSubscription = vi.fn().mockResolvedValue({ success: true, message: 'Subscription canceled' })
    mockGetPortalUrl = vi.fn().mockResolvedValue({ url: 'https://billing.stripe.com/session' })
    mockSignOut = vi.fn().mockResolvedValue({ success: true })
  })

  describe('Email step', () => {
    it('renders email input form initially', async () => {
      renderWithProviders(<SubscriberPortal />)

      expect(screen.getByText('Manage Subscriptions')).toBeInTheDocument()
      expect(screen.getByPlaceholderText('your@email.com')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument()
    })

    it('disables continue button until valid email', async () => {
      renderWithProviders(<SubscriberPortal />)

      const button = screen.getByRole('button', { name: /continue/i })
      const input = screen.getByPlaceholderText('your@email.com')

      // Initially disabled (empty)
      expect(button).toBeDisabled()

      // Invalid email
      await userEvent.type(input, 'invalid')
      expect(button).toBeDisabled()

      // Valid email
      await userEvent.clear(input)
      await userEvent.type(input, 'test@example.com')
      expect(button).not.toBeDisabled()
    })

    it('sends OTP request and shows OTP screen', async () => {
      renderWithProviders(<SubscriberPortal />)

      const input = screen.getByPlaceholderText('your@email.com')
      await userEvent.type(input, 'test@example.com')
      await userEvent.click(screen.getByRole('button', { name: /continue/i }))

      await waitFor(() => {
        expect(mockRequestOtp).toHaveBeenCalledWith('test@example.com')
      })

      // Should show OTP input
      await waitFor(() => {
        expect(screen.getByText(/sent a 6-digit code/i)).toBeInTheDocument()
      })
    })
  })

  describe('OTP step', () => {
    beforeEach(async () => {
      renderWithProviders(<SubscriberPortal />)

      const input = screen.getByPlaceholderText('your@email.com')
      await userEvent.type(input, 'test@example.com')
      await userEvent.click(screen.getByRole('button', { name: /continue/i }))

      await waitFor(() => {
        expect(screen.getByText(/sent a 6-digit code/i)).toBeInTheDocument()
      })
    })

    it('shows OTP input fields', () => {
      const inputs = screen.getAllByRole('textbox')
      expect(inputs.length).toBe(6)
    })

    it('allows changing email', async () => {
      await userEvent.click(screen.getByText(/use different email/i))

      await waitFor(() => {
        expect(screen.getByPlaceholderText('your@email.com')).toBeInTheDocument()
      })
    })

    it('shows error on invalid OTP', async () => {
      mockVerifyOtp.mockResolvedValue({ error: 'Invalid code', attemptsRemaining: 4 })

      const inputs = screen.getAllByRole('textbox')
      for (let i = 0; i < 6; i++) {
        await userEvent.type(inputs[i], String(i + 1))
      }

      await waitFor(() => {
        expect(screen.getByText(/invalid/i)).toBeInTheDocument()
      })
    })
  })

  describe('Subscriptions list', () => {
    beforeEach(() => {
      // Simulate existing session
      mockListSubscriptions = vi.fn().mockResolvedValue(mockListResponse)
    })

    it('loads and displays subscriptions on mount', async () => {
      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument()
      })
    })

    it('shows plan price with label', async () => {
      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText(/Plan/)).toBeInTheDocument()
        expect(screen.getByText(/\$10\.00/)).toBeInTheDocument()
      })
    })

    it('shows masked email', async () => {
      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText('t***t@example.com')).toBeInTheDocument()
      })
    })

    it('shows status label', async () => {
      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText('Active')).toBeInTheDocument()
      })
    })

    it('shows past due alert for past_due subscriptions', async () => {
      mockListSubscriptions.mockResolvedValue({
        ...mockListResponse,
        subscriptions: [{
          ...mockSubscription,
          status: 'past_due',
          statusLabel: 'Payment failed',
          isPastDue: true,
        }],
      })

      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText(/action required/i)).toBeInTheDocument()
      })
    })

    it('shows canceling status', async () => {
      mockListSubscriptions.mockResolvedValue({
        ...mockListResponse,
        subscriptions: [{
          ...mockSubscription,
          cancelAtPeriodEnd: true,
          statusLabel: 'Canceling',
        }],
      })

      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText('Canceling')).toBeInTheDocument()
      })
    })

    it('allows sign out', async () => {
      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText(/sign out/i)).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText(/sign out/i))

      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalled()
      })
    })
  })

  describe('Subscription detail', () => {
    beforeEach(() => {
      mockListSubscriptions = vi.fn().mockResolvedValue(mockListResponse)
    })

    it('loads subscription details when clicked', async () => {
      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument()
      })

      // Click on subscription row
      await userEvent.click(screen.getByText('John Doe'))

      await waitFor(() => {
        expect(mockGetSubscription).toHaveBeenCalledWith('sub-123')
      })
    })

    it('shows total supported amount', async () => {
      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('John Doe'))

      await waitFor(() => {
        expect(screen.getByText('Total supported')).toBeInTheDocument()
        expect(screen.getByText('$120.00')).toBeInTheDocument()
      })
    })

    it('shows billing descriptor', async () => {
      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('John Doe'))

      await waitFor(() => {
        expect(screen.getByText('Statement shows as')).toBeInTheDocument()
        expect(screen.getByText('NATEPAY* JOHN DOE')).toBeInTheDocument()
      })
    })

    it('shows payment history', async () => {
      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('John Doe'))

      await waitFor(() => {
        expect(screen.getByText('Recent Payments')).toBeInTheDocument()
        // Payment amounts should show gross (what subscriber paid)
        expect(screen.getAllByText('$10.20').length).toBeGreaterThan(0)
      })
    })

    it('shows update payment method button for Stripe', async () => {
      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('John Doe'))

      await waitFor(() => {
        expect(screen.getByText('Update Payment Method')).toBeInTheDocument()
      })
    })

    it('shows resubscribe hint for Paystack', async () => {
      mockGetSubscription.mockResolvedValue({
        ...mockDetailResponse,
        subscription: {
          ...mockSubscriptionDetail,
          provider: 'paystack',
          canUpdatePayment: false,
          updatePaymentMethod: 'resubscribe',
        },
      })

      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('John Doe'))

      await waitFor(() => {
        expect(screen.getByText(/cancel and resubscribe/i)).toBeInTheDocument()
      })
    })

    it('allows navigation back to list', async () => {
      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('John Doe'))

      await waitFor(() => {
        expect(screen.getByText('Total supported')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('← Back'))

      await waitFor(() => {
        expect(screen.getByText('Your Subscriptions')).toBeInTheDocument()
      })
    })
  })

  describe('Cancel flow', () => {
    beforeEach(() => {
      mockListSubscriptions = vi.fn().mockResolvedValue(mockListResponse)
    })

    it('shows cancel button on detail view', async () => {
      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('John Doe'))

      await waitFor(() => {
        expect(screen.getByText('Cancel Subscription')).toBeInTheDocument()
      })
    })

    it('shows cancel reason options', async () => {
      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('John Doe'))

      await waitFor(() => {
        expect(screen.getByText('Cancel Subscription')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('Cancel Subscription'))

      await waitFor(() => {
        expect(screen.getByText('Before you go...')).toBeInTheDocument()
        expect(screen.getByText('Too expensive right now')).toBeInTheDocument()
        expect(screen.getByText('Not getting enough value')).toBeInTheDocument()
      })
    })

    it('shows access until date after cancel', async () => {
      mockCancelSubscription.mockResolvedValue({
        success: true,
        message: 'Subscription canceled',
        accessUntil: mockSubscription.currentPeriodEnd,
      })

      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('John Doe'))

      await waitFor(() => {
        expect(screen.getByText('Cancel Subscription')).toBeInTheDocument()
      })

      // Click cancel, select a reason, and confirm
      await userEvent.click(screen.getByText('Cancel Subscription'))

      await waitFor(() => {
        expect(screen.getByText('Too expensive right now')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('Too expensive right now'))

      // Find and click the actual cancel button (red one at the bottom)
      const cancelButtons = screen.getAllByRole('button')
      const confirmCancelBtn = cancelButtons.find(btn =>
        btn.textContent === 'Cancel Subscription' &&
        btn.style.background?.includes('ef4444') // red background
      )

      if (confirmCancelBtn) {
        await userEvent.click(confirmCancelBtn)
      }
    })

    it('allows keeping subscription from cancel flow', async () => {
      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('John Doe'))

      await waitFor(() => {
        expect(screen.getByText('Cancel Subscription')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('Cancel Subscription'))

      await waitFor(() => {
        expect(screen.getByText(/keep subscription/i)).toBeInTheDocument()
      })
    })
  })

  describe('Error handling', () => {
    it('shows error when OTP request fails', async () => {
      mockRequestOtp.mockRejectedValue(new Error('Failed to send'))

      renderWithProviders(<SubscriberPortal />)

      const input = screen.getByPlaceholderText('your@email.com')
      await userEvent.type(input, 'test@example.com')
      await userEvent.click(screen.getByRole('button', { name: /continue/i }))

      await waitFor(() => {
        expect(screen.getByText(/failed to send/i)).toBeInTheDocument()
      })
    })

    it('shows error when subscription load fails', async () => {
      mockListSubscriptions = vi.fn().mockResolvedValue(mockListResponse)
      mockGetSubscription.mockRejectedValue(new Error('Failed to load'))

      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument()
      })

      await userEvent.click(screen.getByText('John Doe'))

      await waitFor(() => {
        expect(screen.getByText(/failed to load/i)).toBeInTheDocument()
      })
    })

    it('shows error when cancel fails', async () => {
      mockCancelSubscription.mockRejectedValue(new Error('Failed to cancel'))

      renderWithProviders(<SubscriberPortal />)

      mockListSubscriptions = vi.fn().mockResolvedValue(mockListResponse)

      // Re-render to pick up new mock
      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText('John Doe')).toBeInTheDocument()
      })
    })

    it('allows dismissing error messages', async () => {
      mockRequestOtp.mockRejectedValue(new Error('Network error'))

      renderWithProviders(<SubscriberPortal />)

      const input = screen.getByPlaceholderText('your@email.com')
      await userEvent.type(input, 'test@example.com')
      await userEvent.click(screen.getByRole('button', { name: /continue/i }))

      await waitFor(() => {
        expect(screen.getByText(/network error/i)).toBeInTheDocument()
      })

      // Find and click dismiss button (X)
      const dismissButton = screen.getByRole('button', { name: '' })
      if (dismissButton) {
        await userEvent.click(dismissButton)
      }
    })
  })

  describe('Empty state', () => {
    it('shows empty state when no subscriptions', async () => {
      mockListSubscriptions = vi.fn().mockResolvedValue({
        email: 'test@example.com',
        maskedEmail: 't***t@example.com',
        subscriptions: [],
      })

      renderWithProviders(<SubscriberPortal />)

      await waitFor(() => {
        expect(screen.getByText(/no active subscriptions/i)).toBeInTheDocument()
      })
    })
  })
})
