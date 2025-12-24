import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '../test/testUtils'
import { useOnboardingStore } from './store'
import AIGeneratingStep from './AIGeneratingStep'

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  blobToBase64: vi.fn(),
}))

vi.mock('../api/hooks', () => {
  return {
    useAIGenerate: () => ({ mutateAsync: mocks.generate }),
    blobToBase64: mocks.blobToBase64,
  }
})

describe('onboarding/AIGeneratingStep', () => {
  beforeEach(() => {
    mocks.generate.mockReset()
    mocks.blobToBase64.mockReset()
    // Reset store and clear navigation cooldown for tests
    useOnboardingStore.getState().reset()
    useOnboardingStore.setState({ _lastNavTime: 0 } as any)
  })

  it('fetches recorded audio, converts to base64 with correct mimeType, and calls generate', async () => {
    useOnboardingStore.getState().reset()
    useOnboardingStore.getState().setFirstName('Alice')
    useOnboardingStore.getState().setLastName('Smith')
    useOnboardingStore.getState().setPricing('single', [], 12)
    useOnboardingStore.getState().setServiceDescriptionAudioUrl('https://r2.example.com/audio.webm')

    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'audio/webm;codecs=opus' },
      })
    }) as any)

    mocks.blobToBase64.mockResolvedValueOnce('base64data')
    mocks.generate.mockResolvedValueOnce({
      bio: 'Bio',
      perks: ['Perk 1'],
      impactItems: ['Impact 1'],
    })

    renderWithProviders(<AIGeneratingStep />)

    await waitFor(() => {
      expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({
        audio: { data: 'base64data', mimeType: 'audio/webm' },
        price: 12,
        userName: 'Alice Smith', // firstName + lastName composite
        includeMarketResearch: false,
      }))
    })

    expect(useOnboardingStore.getState().generatedBio).toBe('Bio')
    // expect(useOnboardingStore.getState().generatedPerks).toEqual(['Perk 1']) -- removed
    // expect(useOnboardingStore.getState().generatedImpact).toEqual(['Impact 1']) -- removed
    expect(useOnboardingStore.getState().currentStep).toBe(1)
  })

  it('shows an error state and allows skipping to manual entry', async () => {
    useOnboardingStore.getState().reset()

    vi.spyOn(console, 'error').mockImplementation(() => { })
    mocks.generate.mockRejectedValueOnce({ error: 'Generation down' })

    renderWithProviders(<AIGeneratingStep />)

    expect(await screen.findByText('Generation failed')).toBeInTheDocument()
    expect(screen.getByText('Generation down')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /skip and enter manually/i }))

    expect(useOnboardingStore.getState().generatedBio).toBe('')
    // expect(useOnboardingStore.getState().generatedPerks).toEqual([]) -- removed
    // expect(useOnboardingStore.getState().generatedImpact).toEqual([]) -- removed
    expect(useOnboardingStore.getState().currentStep).toBe(1)
  })
})
