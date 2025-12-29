import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOnboardingStore } from './store'
import { renderWithProviders } from '../test/testUtils'
import EmailStep from './EmailStep'

const sendMagicLink = vi.fn()

vi.mock('../api/hooks', () => {
  return {
    useRequestMagicLink: () => ({ mutateAsync: sendMagicLink }),
  }
})

describe('onboarding/EmailStep', () => {
  beforeEach(() => {
    sendMagicLink.mockReset()
  })

  it('validates email and requests a magic link before advancing', async () => {
    useOnboardingStore.getState().reset()

    renderWithProviders(<EmailStep />)
    const user = userEvent.setup()

    const button = screen.getByRole('button', { name: /continue/i })
    expect(button).toBeDisabled()

    const input = screen.getByPlaceholderText('email@example.com')
    await user.type(input, 'test@example.com')
    expect(button).toBeEnabled()

    sendMagicLink.mockResolvedValueOnce({ success: true })
    await user.click(button)

    expect(sendMagicLink).toHaveBeenCalledWith('test@example.com')
    // After successful magic link, we navigate to OTP step (index 2)
    expect(useOnboardingStore.getState().currentStep).toBe(2)
    expect(useOnboardingStore.getState().currentStepKey).toBe('otp')
  })

  it('shows an error when magic link request fails', async () => {
    useOnboardingStore.getState().reset()

    renderWithProviders(<EmailStep />)
    const user = userEvent.setup()

    await user.type(screen.getByPlaceholderText('email@example.com'), 'test@example.com')

    sendMagicLink.mockRejectedValueOnce({ error: 'Rate limited' })
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByText('Rate limited')).toBeInTheDocument()
    expect(useOnboardingStore.getState().currentStep).toBe(0)
  })
})
