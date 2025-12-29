import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../test/testUtils'
import SelectRecipient from './SelectRecipient'
import { useRequestStore } from './store'

// Mock navigation
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

// Mock hooks
let mockUserData: any = { profile: { purpose: 'support', currency: 'USD' } }
let mockRequestsData: any = { pages: [] }

vi.mock('../api/hooks', () => ({
  useCurrentUser: () => ({ data: mockUserData }),
  useRequests: () => ({ data: mockRequestsData }),
}))

describe('SelectRecipient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUserData = { profile: { purpose: 'support', currency: 'USD' } }
    mockRequestsData = { pages: [] }
    useRequestStore.getState().reset()
  })

  describe('Service mode rendering', () => {
    it('shows "New Invoice" title for service users', async () => {
      mockUserData = { profile: { purpose: 'service', currency: 'USD' } }

      renderWithProviders(<SelectRecipient />)

      await waitFor(() => {
        expect(screen.getByText('New Invoice')).toBeInTheDocument()
      })
    })

    it('shows "New Request" title for non-service users', async () => {
      mockUserData = { profile: { purpose: 'support', currency: 'USD' } }

      renderWithProviders(<SelectRecipient />)

      await waitFor(() => {
        expect(screen.getByText('New Request')).toBeInTheDocument()
      })
    })

    it('shows "Client name" placeholder for service users', async () => {
      mockUserData = { profile: { purpose: 'service', currency: 'USD' } }

      renderWithProviders(<SelectRecipient />)

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Client name')).toBeInTheDocument()
      })
    })

    it('shows "Recipient name" placeholder for non-service users', async () => {
      mockUserData = { profile: { purpose: 'tips', currency: 'USD' } }

      renderWithProviders(<SelectRecipient />)

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Recipient name')).toBeInTheDocument()
      })
    })

    it('shows service purpose suggestions for service users', async () => {
      mockUserData = { profile: { purpose: 'service', currency: 'USD' } }

      renderWithProviders(<SelectRecipient />)

      await waitFor(() => {
        expect(screen.getByText('Retainer')).toBeInTheDocument()
        expect(screen.getByText('Project')).toBeInTheDocument()
        expect(screen.getByText('Consultation')).toBeInTheDocument()
        expect(screen.getByText('Services')).toBeInTheDocument()
      })
    })

    it('shows personal purpose suggestions for non-service users', async () => {
      mockUserData = { profile: { purpose: 'support', currency: 'USD' } }

      renderWithProviders(<SelectRecipient />)

      await waitFor(() => {
        // Get the purpose chips container
        const purposeChips = document.querySelector('.request-purpose-chips')
        expect(purposeChips).toBeInTheDocument()
        expect(purposeChips?.textContent).toContain('Support')
        expect(purposeChips?.textContent).toContain('Monthly')
        expect(purposeChips?.textContent).toContain('Tip')
        expect(purposeChips?.textContent).toContain('Help')
      })
    })
  })

  describe('Form validation', () => {
    it('disables Continue button when no recipient or amount', async () => {
      renderWithProviders(<SelectRecipient />)

      await waitFor(() => {
        const continueBtn = screen.getByRole('button', { name: /continue/i })
        expect(continueBtn).toHaveAttribute('aria-disabled', 'true')
      })
    })

    it('enables Continue button when recipient and amount are filled', async () => {
      renderWithProviders(<SelectRecipient />)

      // Fill in recipient name
      const nameInput = screen.getByPlaceholderText('Recipient name')
      fireEvent.change(nameInput, { target: { value: 'John Doe' } })

      // Fill in amount
      const amountInput = screen.getByPlaceholderText('0')
      fireEvent.change(amountInput, { target: { value: '50' } })

      await waitFor(() => {
        const continueBtn = screen.getByRole('button', { name: /continue/i })
        expect(continueBtn).not.toHaveAttribute('aria-disabled', 'true')
      })
    })
  })

  describe('Amount selection', () => {
    it('allows quick amount selection', async () => {
      renderWithProviders(<SelectRecipient />)

      // Click a quick amount chip (first suggested amount is $10)
      const amountChip = screen.getByText('$10')
      fireEvent.click(amountChip)

      await waitFor(() => {
        const amountInput = screen.getByPlaceholderText('0') as HTMLInputElement
        expect(amountInput.value).toBe('10')
      })
    })

    it('allows manual amount entry', async () => {
      renderWithProviders(<SelectRecipient />)

      const amountInput = screen.getByPlaceholderText('0')
      fireEvent.change(amountInput, { target: { value: '75' } })

      await waitFor(() => {
        expect((amountInput as HTMLInputElement).value).toBe('75')
      })
    })
  })

  describe('Payment type toggle', () => {
    it('defaults to one-time payment', async () => {
      renderWithProviders(<SelectRecipient />)

      await waitFor(() => {
        const oneTimeBtn = screen.getByText('One-time').closest('[role="button"]')
        expect(oneTimeBtn).toHaveClass('active')
      })
    })

    it('can toggle to recurring payment', async () => {
      renderWithProviders(<SelectRecipient />)

      // Get the Monthly button in the type toggle (has refresh-cw icon)
      const typeToggle = document.querySelector('.request-type-toggle-modern')
      const monthlyBtn = typeToggle?.querySelector('[role="button"]:last-child')
      expect(monthlyBtn).toBeInTheDocument()
      fireEvent.click(monthlyBtn!)

      await waitFor(() => {
        expect(monthlyBtn).toHaveClass('active')
      })
    })
  })

  describe('Navigation', () => {
    it('navigates to preview on continue', async () => {
      renderWithProviders(<SelectRecipient />)

      // Fill required fields
      const nameInput = screen.getByPlaceholderText('Recipient name')
      fireEvent.change(nameInput, { target: { value: 'Jane Doe' } })

      const amountInput = screen.getByPlaceholderText('0')
      fireEvent.change(amountInput, { target: { value: '25' } })

      // Click continue
      const continueBtn = screen.getByRole('button', { name: /continue/i })
      fireEvent.click(continueBtn)

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/request/preview')
      })
    })

    it('resets and navigates back on close', async () => {
      renderWithProviders(<SelectRecipient />)

      // Click close button (X)
      const closeBtn = document.querySelector('.request-close-btn')
      expect(closeBtn).toBeInTheDocument()
      fireEvent.click(closeBtn!)

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(-1)
      })
    })
  })

  describe('Currency handling', () => {
    it('shows correct currency symbol for USD', async () => {
      mockUserData = { profile: { purpose: 'support', currency: 'USD' } }

      renderWithProviders(<SelectRecipient />)

      await waitFor(() => {
        expect(screen.getByText('$')).toBeInTheDocument()
      })
    })

    it('shows correct currency symbol for NGN', async () => {
      mockUserData = { profile: { purpose: 'support', currency: 'NGN' } }

      renderWithProviders(<SelectRecipient />)

      await waitFor(() => {
        expect(screen.getByText('₦')).toBeInTheDocument()
      })
    })
  })
})
