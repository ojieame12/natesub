import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../test/testUtils'
import { useOnboardingStore } from './store'
import AIGeneratingStep from './AIGeneratingStep'

// Mock API - vi.hoisted ensures mocks are defined before vi.mock runs
const { mockSaveProgress, mockGeneratePerks, mockGenerateBanner } = vi.hoisted(() => ({
  mockSaveProgress: vi.fn(),
  mockGeneratePerks: vi.fn(),
  mockGenerateBanner: vi.fn(),
}))

vi.mock('../api', () => ({
  api: {
    auth: {
      saveOnboardingProgress: mockSaveProgress,
    },
  },
}))

// Mock hooks
let aiConfigReturn: any = { data: { available: true }, isLoading: false }
let generatePerksMutationReturn: any = {
  mutateAsync: mockGeneratePerks,
  isPending: false,
}
let generateBannerMutationReturn: any = {
  mutateAsync: mockGenerateBanner,
  isPending: false,
}

vi.mock('../api/hooks', () => ({
  uploadFile: vi.fn(),
  useGeneratePerks: () => generatePerksMutationReturn,
  useGenerateBanner: () => generateBannerMutationReturn,
  useAIConfig: () => aiConfigReturn,
}))

// Mock navigation
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

describe('AIGeneratingStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSaveProgress.mockResolvedValue({ success: true })
    mockGeneratePerks.mockResolvedValue({
      perks: [
        { id: '1', title: 'Perk 1', enabled: true },
        { id: '2', title: 'Perk 2', enabled: true },
        { id: '3', title: 'Perk 3', enabled: true },
      ],
    })
    mockGenerateBanner.mockResolvedValue({
      bannerUrl: 'https://example.com/banner.jpg',
      remaining: 4,
    })
    aiConfigReturn = { data: { available: true }, isLoading: false }
    generatePerksMutationReturn = {
      mutateAsync: mockGeneratePerks,
      isPending: false,
    }
    generateBannerMutationReturn = {
      mutateAsync: mockGenerateBanner,
      isPending: false,
    }

    // Reset store with base state
    useOnboardingStore.setState({
      firstName: 'Test',
      lastName: 'User',
      serviceDescription: 'I help people with marketing',
      singleAmount: 10,
      avatarUrl: 'https://example.com/avatar.jpg',
      bannerUrl: null,
      bannerOptions: [],
      servicePerks: [],
      purpose: 'service',
      currentStep: 5,
      setServicePerks: vi.fn(),
      setBannerUrl: vi.fn(),
      addBannerOption: vi.fn(),
      clearBannerOptions: vi.fn(),
      nextStep: vi.fn(),
      prevStep: vi.fn(),
    })
  })

  describe('Skip functionality', () => {
    it('persists progress when user clicks Skip in AI unavailable state', async () => {
      // No perks - AI unavailable state shows "Continue to Review"
      useOnboardingStore.setState({
        servicePerks: [],
        bannerUrl: null,
        bannerOptions: [],
      })

      // Set AI unavailable
      aiConfigReturn = { data: { available: false }, isLoading: false }

      renderWithProviders(<AIGeneratingStep />)

      // Wait for the AI unavailable message and button
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Continue to Review/i })).toBeInTheDocument()
      })

      // Click skip
      fireEvent.click(screen.getByRole('button', { name: /Continue to Review/i }))

      // Verify saveOnboardingProgress was called with correct data
      await waitFor(() => {
        expect(mockSaveProgress).toHaveBeenCalledWith({
          step: expect.any(Number),
          stepKey: 'review',
          data: expect.objectContaining({
            purpose: 'service',
            serviceDescription: 'I help people with marketing',
          }),
        })
      })
    })

    it('preserves existing perks and banner when continuing from preview', async () => {
      const existingBannerUrl = 'https://example.com/existing-banner.jpg'
      const existingBannerOptions = [{ url: existingBannerUrl, variant: 'standard' as const }]
      const existingPerks = [
        { id: '1', title: 'Existing Perk 1', enabled: true },
        { id: '2', title: 'Existing Perk 2', enabled: true },
        { id: '3', title: 'Existing Perk 3', enabled: true },
      ]

      useOnboardingStore.setState({
        servicePerks: existingPerks,
        bannerUrl: existingBannerUrl,
        bannerOptions: existingBannerOptions,
      })

      // With perks, goes to preview state
      aiConfigReturn = { data: { available: true }, isLoading: false }

      renderWithProviders(<AIGeneratingStep />)

      // In preview state, there's a "Continue" button (handleContinue also saves progress)
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Continue/i })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /Continue/i }))

      await waitFor(() => {
        expect(mockSaveProgress).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              // Continue uses selected banner (first option by default)
              bannerUrl: existingBannerUrl,
              bannerOptions: existingBannerOptions,
              servicePerks: existingPerks,
            }),
          })
        )
      })
    })

    it('handles save failure gracefully (fire-and-forget)', async () => {
      mockSaveProgress.mockRejectedValue(new Error('Network error'))

      // No perks - AI unavailable state
      useOnboardingStore.setState({
        servicePerks: [],
      })

      aiConfigReturn = { data: { available: false }, isLoading: false }

      const nextStepMock = vi.fn()
      useOnboardingStore.setState({ nextStep: nextStepMock })

      renderWithProviders(<AIGeneratingStep />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Continue to Review/i })).toBeInTheDocument()
      })

      // Click skip - should not throw even if save fails
      fireEvent.click(screen.getByRole('button', { name: /Continue to Review/i }))

      // nextStep should still be called (fire-and-forget save)
      await waitFor(() => {
        expect(nextStepMock).toHaveBeenCalled()
      })
    })
  })

  describe('AI unavailable state', () => {
    it('shows unavailable message when AI is not available', async () => {
      aiConfigReturn = { data: { available: false }, isLoading: false }

      // No perks - needs generation
      useOnboardingStore.setState({ servicePerks: [] })

      renderWithProviders(<AIGeneratingStep />)

      await waitFor(() => {
        expect(screen.getByText(/AI-powered content generation is temporarily unavailable/i)).toBeInTheDocument()
      })
    })

    it('treats AI as unavailable when config fetch fails', async () => {
      // Simulate config fetch error - isError: true
      aiConfigReturn = { data: undefined, isLoading: false, isError: true }

      // No perks - would need AI generation
      useOnboardingStore.setState({ servicePerks: [] })

      renderWithProviders(<AIGeneratingStep />)

      // Should show unavailable message (not attempt AI and crash)
      await waitFor(() => {
        expect(screen.getByText(/AI-powered content generation is temporarily unavailable/i)).toBeInTheDocument()
      })
    })

    it('treats AI as unavailable when config data is null', async () => {
      // Simulate null data with no loading
      aiConfigReturn = { data: null, isLoading: false, isError: false }

      useOnboardingStore.setState({ servicePerks: [] })

      renderWithProviders(<AIGeneratingStep />)

      // Should show unavailable message (default to false, not true)
      await waitFor(() => {
        expect(screen.getByText(/AI-powered content generation is temporarily unavailable/i)).toBeInTheDocument()
      })
    })
  })
})
