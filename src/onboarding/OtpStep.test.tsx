import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Routes, Route } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOnboardingStore } from './store'
import { renderWithProviders } from '../test/testUtils'
import OtpStep from './OtpStep'

const verifyMagicLink = vi.fn()
const resendMagicLink = vi.fn()

vi.mock('../api/hooks', () => {
  return {
    useVerifyMagicLink: () => ({ mutateAsync: verifyMagicLink }),
    useRequestMagicLink: () => ({ mutateAsync: resendMagicLink }),
  }
})

function renderOtp() {
  return renderWithProviders(
    <Routes>
      <Route path="/onboarding" element={<OtpStep />} />
      <Route path="/dashboard" element={<div>Dashboard</div>} />
      <Route path="/settings/payments" element={<div>Payments</div>} />
    </Routes>,
    { route: '/onboarding' }
  )
}

describe('onboarding/OtpStep', () => {
  beforeEach(() => {
    verifyMagicLink.mockReset()
    resendMagicLink.mockReset()
  })

  it('auto-verifies and navigates to dashboard for fully set up users', async () => {
    useOnboardingStore.getState().reset()
    useOnboardingStore.getState().setEmail('test@example.com')

    verifyMagicLink.mockResolvedValueOnce({
      success: true,
      token: 'tok',
      hasProfile: true,
      hasActivePayment: true,
      onboardingStep: null,
      onboardingBranch: null,
      onboardingData: null,
      redirectTo: '/dashboard',
    })

    renderOtp()
    const user = userEvent.setup()

    const inputs = screen.getAllByRole('textbox')
    expect(inputs).toHaveLength(6)

    for (const [i, digit] of ['1', '2', '3', '4', '5', '6'].entries()) {
      await user.type(inputs[i], digit)
    }

    expect(verifyMagicLink).toHaveBeenCalledWith({ otp: '123456', email: 'test@example.com' })
    expect(await screen.findByText('Dashboard')).toBeInTheDocument()
  })

  it('hydrates onboarding progress when backend returns a resumable step', async () => {
    useOnboardingStore.getState().reset()
    useOnboardingStore.getState().setEmail('test@example.com')

    // Backend can send either old 'name' field or new firstName/lastName
    verifyMagicLink.mockResolvedValueOnce({
      success: true,
      token: 'tok',
      hasProfile: false,
      hasActivePayment: false,
      onboardingStep: 4,
      onboardingBranch: 'service',
      onboardingData: { name: 'Alice Smith', username: 'alice' }, // Old format
      redirectTo: '/onboarding',
    })

    renderOtp()
    const user = userEvent.setup()

    const inputs = screen.getAllByRole('textbox')
    for (const [i, digit] of ['1', '2', '3', '4', '5', '6'].entries()) {
      await user.type(inputs[i], digit)
    }

    expect(verifyMagicLink).toHaveBeenCalledWith({ otp: '123456', email: 'test@example.com' })
    expect(useOnboardingStore.getState().currentStep).toBe(4)
    expect(useOnboardingStore.getState().branch).toBe('service')
    // Old 'name' field should be migrated to firstName/lastName
    expect(useOnboardingStore.getState().firstName).toBe('Alice')
    expect(useOnboardingStore.getState().lastName).toBe('Smith')
  })

  it('shows improved error message for expired/used codes and clears inputs', async () => {
    useOnboardingStore.getState().reset()
    useOnboardingStore.getState().setEmail('test@example.com')

    verifyMagicLink.mockRejectedValueOnce({ error: 'Code already used' })

    renderOtp()
    const user = userEvent.setup()

    const inputs = screen.getAllByRole('textbox')
    for (const [i, digit] of ['1', '2', '3', '4', '5', '6'].entries()) {
      await user.type(inputs[i], digit)
    }

    expect(
      await screen.findByText('This code is no longer valid. Please click Resend to get a new code.')
    ).toBeInTheDocument()

    // Cleared for retry
    for (const input of screen.getAllByRole('textbox')) {
      expect((input as HTMLInputElement).value).toBe('')
    }
  })

  it('resends the code and shows a success message', async () => {
    useOnboardingStore.getState().reset()
    useOnboardingStore.getState().setEmail('test@example.com')

    resendMagicLink.mockResolvedValueOnce({ success: true })

    renderOtp()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /resend/i }))
    expect(resendMagicLink).toHaveBeenCalledWith('test@example.com')
    expect(await screen.findByText('New code sent! Check your email.')).toBeInTheDocument()
  })
})
