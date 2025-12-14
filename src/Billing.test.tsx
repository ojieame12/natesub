import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from './test/testUtils'
import Billing from './Billing'

let billingStatusReturn: any
let checkoutReturn: any
let portalReturn: any

const toastSuccess = vi.fn()

vi.mock('./api/hooks', () => {
  return {
    useBillingStatus: () => billingStatusReturn,
    useCreateBillingCheckout: () => checkoutReturn,
    useCreateBillingPortal: () => portalReturn,
  }
})

vi.mock('./components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components')>()
  return {
    ...actual,
    useToast: () => ({
      showToast: vi.fn(),
      success: toastSuccess,
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    }),
  }
})

describe('Billing', () => {
  beforeEach(() => {
    toastSuccess.mockReset()
    billingStatusReturn = undefined
    checkoutReturn = undefined
    portalReturn = undefined
  })

  it('renders a loading state', () => {
    billingStatusReturn = {
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    }
    checkoutReturn = { mutate: vi.fn(), isPending: false }
    portalReturn = { mutate: vi.fn(), isPending: false }

    renderWithProviders(<Billing />, { route: '/settings/billing' })
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('renders an error state with retry', async () => {
    const refetch = vi.fn()
    billingStatusReturn = {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch,
    }
    checkoutReturn = { mutate: vi.fn(), isPending: false }
    portalReturn = { mutate: vi.fn(), isPending: false }

    renderWithProviders(<Billing />, { route: '/settings/billing' })
    expect(screen.getByText('Unable to load billing')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(refetch).toHaveBeenCalled()
  })

  it('starts free trial checkout for service plan when no subscription exists', async () => {
    const createCheckout = vi.fn()
    billingStatusReturn = {
      data: {
        plan: 'service',
        subscriptionRequired: true,
        subscription: null,
        debit: null,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }
    checkoutReturn = { mutate: createCheckout, isPending: false }
    portalReturn = { mutate: vi.fn(), isPending: false }

    renderWithProviders(<Billing />, { route: '/settings/billing' })

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /start free trial/i }))
    expect(createCheckout).toHaveBeenCalled()
  })

  it('shows success toast and refetches when redirected back with ?success=true', () => {
    const refetch = vi.fn()
    billingStatusReturn = {
      data: {
        plan: 'service',
        subscriptionRequired: true,
        subscription: null,
        debit: null,
      },
      isLoading: false,
      isError: false,
      refetch,
    }
    checkoutReturn = { mutate: vi.fn(), isPending: false }
    portalReturn = { mutate: vi.fn(), isPending: false }

    renderWithProviders(<Billing />, { route: '/settings/billing?success=true' })
    expect(toastSuccess).toHaveBeenCalledWith('Your free trial has started!')
    expect(refetch).toHaveBeenCalled()
  })
})
