import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../test/testUtils'
import { useOnboardingStore } from './store'
import PersonalReviewStep from './PersonalReviewStep'

// Mock API
vi.mock('../api', () => ({
  api: {
    put: vi.fn(() => Promise.resolve({ profile: { id: 'test-id' } })),
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
    aiConfigReturn = { data: { available: true } }
    generatePerksMutationReturn = { mutateAsync: vi.fn(), isPending: false }

    // Reset store with base state
    useOnboardingStore.setState({
      firstName: 'Test',
      lastName: 'User',
      username: 'testuser',
      purpose: 'support',
      singleAmount: 10,
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
})
