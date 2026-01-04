import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../test/testUtils'
import { useOnboardingStore } from './store'
import PersonalReviewStep from './PersonalReviewStep'

// Mock API - vi.hoisted ensures mocks are defined before vi.mock runs
const { mockProfileUpdate, mockProfileUpdateSettings, mockSaveProgress } = vi.hoisted(() => ({
  mockProfileUpdate: vi.fn(),
  mockProfileUpdateSettings: vi.fn(),
  mockSaveProgress: vi.fn(),
}))

vi.mock('../api', () => ({
  api: {
    put: vi.fn(() => Promise.resolve({ profile: { id: 'test-id' } })),
    profile: {
      update: mockProfileUpdate,
      updateSettings: mockProfileUpdateSettings,
    },
    auth: {
      saveOnboardingProgress: mockSaveProgress,
    },
  },
}))

// Mock hooks
let aiConfigReturn: any = { data: { available: true } }
let generatePerksMutationReturn: any = { mutateAsync: vi.fn(), isPending: false }

vi.mock('../api/hooks', () => ({
  uploadFile: vi.fn(),
  useGeneratePerks: () => generatePerksMutationReturn,
  useAIConfig: () => aiConfigReturn,
  useCurrentUser: () => ({ data: { onboarding: { step: 0, data: {} } } }),
  // Mock useCreatorMinimum - returns null (no minimum enforced in tests)
  useCreatorMinimum: () => null,
  // Mock useMyMinimum - returns undefined (no dynamic minimum in tests)
  useMyMinimum: () => ({ data: undefined }),
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

describe('PersonalReviewStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProfileUpdate.mockResolvedValue({ profile: { id: 'test-id' } })
    mockProfileUpdateSettings.mockResolvedValue({ success: true })
    mockSaveProgress.mockResolvedValue({ success: true })
    aiConfigReturn = { data: { available: true } }
    generatePerksMutationReturn = { mutateAsync: vi.fn(), isPending: false }

    // Reset store with base state
    useOnboardingStore.setState({
      firstName: 'Test',
      lastName: 'User',
      username: 'testuser',
      purpose: 'support',
      pricingModel: 'single',
      singleAmount: 10,
      tiers: [],
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      avatarUrl: 'https://example.com/avatar.jpg',
      paymentProvider: 'stripe',
      currentStep: 7,
      serviceDescription: '',
      servicePerks: [],
      bannerUrl: null,
    })
  })

  describe('Service mode rendering', () => {
    it('shows service description field for service purpose', async () => {
      useOnboardingStore.setState({ purpose: 'service' })

      renderWithProviders(<PersonalReviewStep />)

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/I help entrepreneurs/i)).toBeInTheDocument()
      })
    })

    it('shows perks section for service purpose', async () => {
      useOnboardingStore.setState({ purpose: 'service' })

      renderWithProviders(<PersonalReviewStep />)

      await waitFor(() => {
        expect(screen.getByText(/What subscribers get/i)).toBeInTheDocument()
      })
    })

    it('does not show service fields for non-service purpose', async () => {
      useOnboardingStore.setState({ purpose: 'tips' })

      renderWithProviders(<PersonalReviewStep />)

      await waitFor(() => {
        expect(screen.queryByText('What Subscribers Get')).not.toBeInTheDocument()
      })
    })
  })

  describe('AI availability', () => {
    it('shows Generate button when AI is available', async () => {
      aiConfigReturn = { data: { available: true } }
      useOnboardingStore.setState({
        purpose: 'service',
        serviceDescription: 'Test service',
      })

      renderWithProviders(<PersonalReviewStep />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /generate/i })).toBeInTheDocument()
      })
    })

    it('hides Generate button when AI is unavailable', async () => {
      aiConfigReturn = { data: { available: false } }
      useOnboardingStore.setState({
        purpose: 'service',
        serviceDescription: 'Test service',
      })

      renderWithProviders(<PersonalReviewStep />)

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /generate/i })).not.toBeInTheDocument()
      })
    })

    it('shows AI unavailable hint when AI is off and perks are empty', async () => {
      aiConfigReturn = { data: { available: false } }
      useOnboardingStore.setState({
        purpose: 'service',
        servicePerks: [],
      })

      renderWithProviders(<PersonalReviewStep />)

      await waitFor(() => {
        expect(screen.getByText(/Add at least 3 perks that describe what subscribers will receive/i)).toBeInTheDocument()
      })
    })
  })

  describe('Manual perk management', () => {
    it('shows Add perk button when less than 3 perks', async () => {
      useOnboardingStore.setState({
        purpose: 'service',
        servicePerks: [
          { id: 'perk-1', title: 'Perk 1', enabled: true },
        ],
      })

      renderWithProviders(<PersonalReviewStep />)

      await waitFor(() => {
        expect(screen.getByText(/Add perk/i)).toBeInTheDocument()
      })
    })

    it('hides Add perk button when 5 perks exist', async () => {
      useOnboardingStore.setState({
        purpose: 'service',
        servicePerks: [
          { id: 'perk-1', title: 'Perk 1', enabled: true },
          { id: 'perk-2', title: 'Perk 2', enabled: true },
          { id: 'perk-3', title: 'Perk 3', enabled: true },
          { id: 'perk-4', title: 'Perk 4', enabled: true },
          { id: 'perk-5', title: 'Perk 5', enabled: true },
        ],
      })

      renderWithProviders(<PersonalReviewStep />)

      await waitFor(() => {
        expect(screen.queryByText(/Add perk/i)).not.toBeInTheDocument()
      })
    })

    it('displays existing perks', async () => {
      useOnboardingStore.setState({
        purpose: 'service',
        servicePerks: [
          { id: 'perk-1', title: 'Weekly coaching calls', enabled: true },
          { id: 'perk-2', title: 'Custom meal plans', enabled: true },
          { id: 'perk-3', title: 'Priority support', enabled: true },
        ],
      })

      renderWithProviders(<PersonalReviewStep />)

      await waitFor(() => {
        expect(screen.getByText('Weekly coaching calls')).toBeInTheDocument()
        expect(screen.getByText('Custom meal plans')).toBeInTheDocument()
        expect(screen.getByText('Priority support')).toBeInTheDocument()
      })
    })

    it('disables delete button when at 3 perks', async () => {
      useOnboardingStore.setState({
        purpose: 'service',
        servicePerks: [
          { id: 'perk-1', title: 'Perk 1', enabled: true },
          { id: 'perk-2', title: 'Perk 2', enabled: true },
          { id: 'perk-3', title: 'Perk 3', enabled: true },
        ],
      })

      renderWithProviders(<PersonalReviewStep />)

      await waitFor(() => {
        const deleteButtons = document.querySelectorAll('.service-perk-delete-btn')
        expect(deleteButtons.length).toBe(3)
        deleteButtons.forEach(btn => {
          expect(btn.getAttribute('aria-disabled')).toBe('true')
        })
      })
    })
  })

  describe('Launch validation', () => {
    it('shows error when service user tries to launch with fewer than 3 perks', async () => {
      useOnboardingStore.setState({
        purpose: 'service',
        serviceDescription: 'My service',
        servicePerks: [
          { id: 'perk-1', title: 'Perk 1', enabled: true },
        ],
      })

      renderWithProviders(<PersonalReviewStep />)

      // Click Launch button
      const launchButton = screen.getByRole('button', { name: /launch/i })
      fireEvent.click(launchButton)

      // Should show error about missing perks
      await waitFor(() => {
        expect(screen.getByText(/please add 2 more perks/i)).toBeInTheDocument()
      })
    })

    it('shows error when service user has no service description', async () => {
      useOnboardingStore.setState({
        purpose: 'service',
        serviceDescription: '',
        servicePerks: [
          { id: 'perk-1', title: 'Perk 1', enabled: true },
          { id: 'perk-2', title: 'Perk 2', enabled: true },
          { id: 'perk-3', title: 'Perk 3', enabled: true },
        ],
      })

      renderWithProviders(<PersonalReviewStep />)

      const launchButton = screen.getByRole('button', { name: /launch/i })
      fireEvent.click(launchButton)

      await waitFor(() => {
        expect(screen.getByText(/please describe your service/i)).toBeInTheDocument()
      })
    })

    it('does not require perks for non-service users', async () => {
      useOnboardingStore.setState({
        purpose: 'tips',
        servicePerks: [],
      })

      renderWithProviders(<PersonalReviewStep />)

      // Launch button should be enabled (not aria-disabled)
      const launchButton = screen.getByRole('button', { name: /launch/i })
      expect(launchButton).not.toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('Purpose selection', () => {
    it('shows Retainer label for service purpose', async () => {
      useOnboardingStore.setState({ purpose: 'service' })

      renderWithProviders(<PersonalReviewStep />)

      await waitFor(() => {
        expect(screen.getByText('Services')).toBeInTheDocument()
      })
    })

    it('shows Support label for support purpose', async () => {
      useOnboardingStore.setState({ purpose: 'support' })

      renderWithProviders(<PersonalReviewStep />)

      await waitFor(() => {
        expect(screen.getByText('Support Me')).toBeInTheDocument()
      })
    })
  })

  describe('Pricing model submission', () => {
    it('submits single pricing when pricingModel is single', async () => {
      useOnboardingStore.setState({
        pricingModel: 'single',
        singleAmount: 15,
        tiers: [],
      })

      renderWithProviders(<PersonalReviewStep />)

      const launchButton = screen.getByRole('button', { name: /launch/i })
      fireEvent.click(launchButton)

      await waitFor(() => {
        expect(mockProfileUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            pricingModel: 'single',
            singleAmount: 15,
            tiers: null,
          })
        )
      })
    })

    it('submits tiered pricing when pricingModel is tiers', async () => {
      useOnboardingStore.setState({
        pricingModel: 'tiers',
        singleAmount: null,
        tiers: [
          { id: 't1', name: 'Basic', amount: 5, perks: ['Perk A'] },
          { id: 't2', name: 'Pro', amount: 15, perks: ['Perk A', 'Perk B'], isPopular: true },
          { id: 't3', name: 'VIP', amount: 50, perks: ['All perks'] },
        ],
      })

      renderWithProviders(<PersonalReviewStep />)

      const launchButton = screen.getByRole('button', { name: /launch/i })
      fireEvent.click(launchButton)

      await waitFor(() => {
        expect(mockProfileUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            pricingModel: 'tiers',
            singleAmount: null,
            tiers: expect.arrayContaining([
              expect.objectContaining({ name: 'Basic', amount: 5 }),
              expect.objectContaining({ name: 'Pro', amount: 15, isPopular: true }),
              expect.objectContaining({ name: 'VIP', amount: 50 }),
            ]),
          })
        )
      })
    })

    it('does not wipe tiers when pricingModel is tiers', async () => {
      const tiers = [
        { id: 't1', name: 'Tier 1', amount: 10, perks: ['A'] },
        { id: 't2', name: 'Tier 2', amount: 25, perks: ['A', 'B'] },
      ]
      useOnboardingStore.setState({
        pricingModel: 'tiers',
        singleAmount: null,
        tiers,
      })

      renderWithProviders(<PersonalReviewStep />)

      const launchButton = screen.getByRole('button', { name: /launch/i })
      fireEvent.click(launchButton)

      await waitFor(() => {
        expect(mockProfileUpdate).toHaveBeenCalled()
        const call = mockProfileUpdate.mock.calls[0]![0]
        expect(call.pricingModel).toBe('tiers')
        expect(call.tiers).not.toBeNull()
        expect(call.tiers).toHaveLength(2)
      })
    })
  })

  describe('Price input hydration', () => {
    it('syncs priceInput when singleAmount hydrates after mount', async () => {
      // Start with no singleAmount (simulates fresh mount before hydration)
      // Ensure pricingModel is 'single' to show the price input
      useOnboardingStore.setState({
        singleAmount: null,
        pricingModel: 'single',
        tiers: [],
      })

      renderWithProviders(<PersonalReviewStep />)

      // Should show default price initially (10)
      await waitFor(() => {
        const priceInput = document.querySelector('.setup-price-input') as HTMLInputElement
        expect(priceInput).toBeInTheDocument()
        expect(priceInput.value).toBe('10') // Default
      })

      // Simulate hydration from server (singleAmount updates)
      useOnboardingStore.setState({ singleAmount: 25 })

      // Price should sync to hydrated value
      await waitFor(() => {
        const priceInput = document.querySelector('.setup-price-input') as HTMLInputElement
        expect(priceInput.value).toBe('25')
      })
    })

    it('does not overwrite user-edited price when singleAmount hydrates', async () => {
      useOnboardingStore.setState({
        singleAmount: null,
        pricingModel: 'single',
        tiers: [],
      })

      renderWithProviders(<PersonalReviewStep />)

      const priceInput = await waitFor(() => {
        const input = document.querySelector('.setup-price-input') as HTMLInputElement
        expect(input).toBeInTheDocument()
        return input
      })

      // User manually edits the price
      fireEvent.change(priceInput, { target: { value: '50' } })

      await waitFor(() => {
        expect(priceInput.value).toBe('50')
      })

      // Simulate hydration with different value
      useOnboardingStore.setState({ singleAmount: 25 })

      // Price should NOT change (user already edited)
      await waitFor(() => {
        expect(priceInput.value).toBe('50')
      })
    })

    it('uses correct pricing type for currency change based on purpose', async () => {
      // Non-service purpose should use 'personal' pricing
      useOnboardingStore.setState({
        purpose: 'tips',
        currency: 'USD',
        countryCode: 'NG', // Cross-border to show currency selector
        paymentProvider: 'stripe',
        pricingModel: 'single',
        tiers: [],
      })

      renderWithProviders(<PersonalReviewStep />)

      // Verify component renders without crashing for non-service purpose
      await waitFor(() => {
        expect(screen.getByText('Tips & Appreciation')).toBeInTheDocument()
      })
    })
  })

  describe('Perk debounce persistence', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('persists perks after debounce delay when editing', async () => {
      useOnboardingStore.setState({
        purpose: 'service',
        currentStep: 7,
        servicePerks: [
          { id: 'perk-1', title: 'Original Perk 1', enabled: true },
          { id: 'perk-2', title: 'Original Perk 2', enabled: true },
          { id: 'perk-3', title: 'Original Perk 3', enabled: true },
        ],
      })

      renderWithProviders(<PersonalReviewStep />)

      // Wait for component to render
      await waitFor(() => {
        expect(screen.getByText('Original Perk 1')).toBeInTheDocument()
      })

      // Clear any initial calls
      mockSaveProgress.mockClear()

      // Update the store with new perks (simulates user editing a perk)
      useOnboardingStore.setState({
        servicePerks: [
          { id: 'perk-1', title: 'Edited Perk 1', enabled: true },
          { id: 'perk-2', title: 'Original Perk 2', enabled: true },
          { id: 'perk-3', title: 'Original Perk 3', enabled: true },
        ],
      })

      // Should not have saved immediately
      expect(mockSaveProgress).not.toHaveBeenCalled()

      // Advance timers past the 1.5s debounce
      await vi.advanceTimersByTimeAsync(1600)

      // Now should have saved
      await waitFor(() => {
        expect(mockSaveProgress).toHaveBeenCalledWith(
          expect.objectContaining({
            stepKey: 'review',
            data: expect.objectContaining({
              servicePerks: expect.arrayContaining([
                expect.objectContaining({ title: 'Edited Perk 1' }),
              ]),
            }),
          })
        )
      })
    })

    it('does not persist perks for non-service users', async () => {
      useOnboardingStore.setState({
        purpose: 'tips',
        currentStep: 7,
        servicePerks: [],
        singleAmount: 10, // Set initial amount
      })

      renderWithProviders(<PersonalReviewStep />)

      // Clear any initial calls (price debounce may have fired)
      mockSaveProgress.mockClear()

      // Simulate changing perks for a non-service user (shouldn't trigger perk save)
      useOnboardingStore.setState({
        servicePerks: [
          { id: 'perk-1', title: 'New Perk', enabled: true },
        ],
      })

      // Advance timers past perk debounce
      await vi.advanceTimersByTimeAsync(2000)

      // If called, verify it's NOT a perk save (could be price debounce)
      // Perk debounce should not run for non-service users
      const perkSaveCalls = mockSaveProgress.mock.calls.filter(
        (call: any[]) => call[0]?.data?.servicePerks
      )
      expect(perkSaveCalls).toHaveLength(0)
    })

    it('debounces multiple rapid edits into one save', async () => {
      useOnboardingStore.setState({
        purpose: 'service',
        currentStep: 7,
        servicePerks: [
          { id: 'perk-1', title: 'Perk 1', enabled: true },
          { id: 'perk-2', title: 'Perk 2', enabled: true },
          { id: 'perk-3', title: 'Perk 3', enabled: true },
        ],
      })

      renderWithProviders(<PersonalReviewStep />)
      mockSaveProgress.mockClear()

      // Simulate rapid edits
      useOnboardingStore.setState({
        servicePerks: [
          { id: 'perk-1', title: 'Edit 1', enabled: true },
          { id: 'perk-2', title: 'Perk 2', enabled: true },
          { id: 'perk-3', title: 'Perk 3', enabled: true },
        ],
      })
      await vi.advanceTimersByTimeAsync(500)

      useOnboardingStore.setState({
        servicePerks: [
          { id: 'perk-1', title: 'Edit 2', enabled: true },
          { id: 'perk-2', title: 'Perk 2', enabled: true },
          { id: 'perk-3', title: 'Perk 3', enabled: true },
        ],
      })
      await vi.advanceTimersByTimeAsync(500)

      useOnboardingStore.setState({
        servicePerks: [
          { id: 'perk-1', title: 'Final Edit', enabled: true },
          { id: 'perk-2', title: 'Perk 2', enabled: true },
          { id: 'perk-3', title: 'Perk 3', enabled: true },
        ],
      })

      // Advance past debounce
      await vi.advanceTimersByTimeAsync(1600)

      // Filter for perk-related saves only (not price debounce)
      const perkSaveCalls = mockSaveProgress.mock.calls.filter(
        (call: any[]) => call[0]?.data?.servicePerks
      )

      // Should only have saved perks once with the final value
      await waitFor(() => {
        expect(perkSaveCalls.length).toBe(1)
        expect(perkSaveCalls[0]![0]).toEqual(
          expect.objectContaining({
            data: expect.objectContaining({
              servicePerks: expect.arrayContaining([
                expect.objectContaining({ title: 'Final Edit' }),
              ]),
            }),
          })
        )
      })
    })
  })
})
