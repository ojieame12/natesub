import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderWithProviders } from './test/testUtils'
import EditPage from './EditPage'

// Mock profile data
const mockProfile = {
  id: 'profile-123',
  username: 'testcreator',
  displayName: 'Test Creator',
  avatarUrl: 'https://example.com/avatar.jpg',
  country: 'United States',
  countryCode: 'US',
  currency: 'USD',
  purpose: 'service',
  pricingModel: 'single',
  singleAmount: 1000,
  bio: 'Test bio',
  perks: [],
  bannerUrl: null,
  payoutStatus: 'active',
}

let profileReturn: any
let updateProfileReturn: any
let generatePerksReturn: any
let generateBannerReturn: any
let aiConfigReturn: any

vi.mock('./api/hooks', () => ({
  useProfile: () => profileReturn,
  useUpdateProfile: () => updateProfileReturn,
  useGeneratePerks: () => generatePerksReturn,
  useGenerateBanner: () => generateBannerReturn,
  useAIConfig: () => aiConfigReturn,
  // Mock useCreatorMinimum - returns null (no minimum enforced in tests)
  useCreatorMinimum: () => null,
  // Mock useMyMinimum - returns undefined (no dynamic minimum in tests)
  useMyMinimum: () => ({ data: undefined }),
  uploadFile: vi.fn(),
}))

vi.mock('./components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./components')>()
  return {
    ...actual,
    useToast: () => ({
      showToast: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    }),
  }
})

describe('EditPage', () => {
  beforeEach(() => {
    profileReturn = {
      data: { profile: mockProfile },
      isLoading: false,
      error: null,
    }
    updateProfileReturn = {
      mutateAsync: vi.fn(),
      isPending: false,
    }
    generatePerksReturn = {
      mutateAsync: vi.fn(),
      isPending: false,
    }
    generateBannerReturn = {
      mutateAsync: vi.fn(),
      isPending: false,
    }
    aiConfigReturn = {
      data: { available: true },
    }
  })

  describe('AI availability UX text', () => {
    it('shows "click Generate" text when AI is available and perks are empty', async () => {
      aiConfigReturn = { data: { available: true } }

      renderWithProviders(<EditPage />, { route: '/edit' })

      await waitFor(() => {
        expect(screen.getByText(/click Generate to create your perks/)).toBeInTheDocument()
      })
    })

    it('shows AI unavailable message when AI is unavailable and perks are empty', async () => {
      aiConfigReturn = { data: { available: false } }

      renderWithProviders(<EditPage />, { route: '/edit' })

      await waitFor(() => {
        // Both perks and banner sections show AI unavailable message
        const unavailableMessages = screen.getAllByText(/AI is temporarily unavailable/)
        expect(unavailableMessages.length).toBeGreaterThan(0)
      })
    })

    it('shows "click Generate" for banner when AI is available and banner is empty', async () => {
      aiConfigReturn = { data: { available: true } }

      renderWithProviders(<EditPage />, { route: '/edit' })

      await waitFor(() => {
        expect(screen.getByText(/click Generate to create your banner/)).toBeInTheDocument()
      })
    })

    it('shows AI unavailable message for banner when AI is unavailable', async () => {
      aiConfigReturn = { data: { available: false } }

      renderWithProviders(<EditPage />, { route: '/edit' })

      await waitFor(() => {
        expect(screen.getByText(/Your avatar will be used as the banner/)).toBeInTheDocument()
      })
    })

    it('hides Generate button when AI is unavailable', async () => {
      aiConfigReturn = { data: { available: false } }

      renderWithProviders(<EditPage />, { route: '/edit' })

      await waitFor(() => {
        // Generate buttons should not be present
        expect(screen.queryByRole('button', { name: /generate/i })).not.toBeInTheDocument()
      })
    })

    it('shows Generate button when AI is available', async () => {
      aiConfigReturn = { data: { available: true } }

      renderWithProviders(<EditPage />, { route: '/edit' })

      await waitFor(() => {
        // Generate buttons should be present for perks and banner
        const generateButtons = screen.getAllByRole('button', { name: /generate/i })
        expect(generateButtons.length).toBeGreaterThan(0)
      })
    })
  })

  describe('Service mode rendering', () => {
    it('shows perks section for service mode', async () => {
      renderWithProviders(<EditPage />, { route: '/edit' })

      await waitFor(() => {
        expect(screen.getByText('What Subscribers Get')).toBeInTheDocument()
      })
    })

    it('shows banner section for service mode', async () => {
      renderWithProviders(<EditPage />, { route: '/edit' })

      await waitFor(() => {
        expect(screen.getByText('Banner Image')).toBeInTheDocument()
      })
    })

    it('does not show perks section for non-service mode', async () => {
      profileReturn = {
        data: { profile: { ...mockProfile, purpose: 'tips' } },
        isLoading: false,
        error: null,
      }

      renderWithProviders(<EditPage />, { route: '/edit' })

      await waitFor(() => {
        expect(screen.queryByText('What Subscribers Get')).not.toBeInTheDocument()
      })
    })
  })

  describe('Manual perk management', () => {
    it('shows Add perk button when perks are empty', async () => {
      renderWithProviders(<EditPage />, { route: '/edit' })

      await waitFor(() => {
        expect(screen.getByText('Add perk')).toBeInTheDocument()
      })
    })

    it('shows Add perk button when fewer than 5 perks exist', async () => {
      profileReturn = {
        data: {
          profile: {
            ...mockProfile,
            perks: [
              { id: 'perk-1', title: 'Perk 1', enabled: true },
              { id: 'perk-2', title: 'Perk 2', enabled: true },
            ],
          },
        },
        isLoading: false,
        error: null,
      }

      renderWithProviders(<EditPage />, { route: '/edit' })

      await waitFor(() => {
        expect(screen.getByText('Add perk')).toBeInTheDocument()
      })
    })

    it('shows helpful hint when AI unavailable and perks empty', async () => {
      aiConfigReturn = { data: { available: false } }

      renderWithProviders(<EditPage />, { route: '/edit' })

      await waitFor(() => {
        expect(screen.getByText(/Click "Add perk" above to add perks manually/)).toBeInTheDocument()
      })
    })

    it('disables delete button when service user has 3 or fewer perks', async () => {
      profileReturn = {
        data: {
          profile: {
            ...mockProfile,
            perks: [
              { id: 'perk-1', title: 'Perk 1', enabled: true },
              { id: 'perk-2', title: 'Perk 2', enabled: true },
              { id: 'perk-3', title: 'Perk 3', enabled: true },
            ],
          },
        },
        isLoading: false,
        error: null,
      }

      renderWithProviders(<EditPage />, { route: '/edit' })

      await waitFor(() => {
        // Delete buttons should be disabled (aria-disabled="true")
        const deleteButtons = document.querySelectorAll('.perk-delete-btn')
        expect(deleteButtons.length).toBe(3)
        deleteButtons.forEach(btn => {
          expect(btn.getAttribute('aria-disabled')).toBe('true')
        })
      })
    })
  })
})
