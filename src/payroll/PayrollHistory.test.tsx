import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../test/testUtils'
import PayrollHistory from './PayrollHistory'

// Mock the hooks
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom')
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    }
})

const mockPayrollPeriods = vi.fn()
const mockCurrentUser = vi.fn()

vi.mock('../api/hooks', () => ({
    usePayrollPeriods: () => mockPayrollPeriods(),
    useCurrentUser: () => mockCurrentUser(),
}))

// Sample data
const mockPeriods = [
    {
        id: 'period-1',
        startDate: '2024-12-01T00:00:00.000Z',
        endDate: '2024-12-15T23:59:59.999Z',
        currency: 'USD',
        grossAmount: 100000,
        platformFee: 8000,
        netAmount: 92000,
        status: 'paid' as const,
    },
    {
        id: 'period-2',
        startDate: '2024-12-16T00:00:00.000Z',
        endDate: '2024-12-31T23:59:59.999Z',
        currency: 'USD',
        grossAmount: 150000,
        platformFee: 12000,
        netAmount: 138000,
        status: 'pending' as const,
    },
]

const mockUserData = {
    profile: {
        currency: 'USD',
    },
}

describe('PayrollHistory', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockCurrentUser.mockReturnValue({ data: mockUserData })
    })

    afterEach(() => {
        cleanup()
    })

    describe('Loading State', () => {
        it('renders loading skeleton while fetching', () => {
            mockPayrollPeriods.mockReturnValue({
                data: null,
                isLoading: true,
                isError: false,
                refetch: vi.fn(),
            })

            renderWithProviders(<PayrollHistory />)

            // Should show skeleton elements
            expect(document.querySelector('.payroll-ytd-card')).toBeInTheDocument()
        })
    })

    describe('Error State', () => {
        it('renders error state on fetch failure', () => {
            mockPayrollPeriods.mockReturnValue({
                data: null,
                isLoading: false,
                isError: true,
                refetch: vi.fn(),
            })

            renderWithProviders(<PayrollHistory />)

            expect(screen.getByText("Couldn't load payroll")).toBeInTheDocument()
            expect(screen.getByText(/We had trouble loading your pay history/)).toBeInTheDocument()
        })

        it('calls refetch when retry button is clicked', async () => {
            const mockRefetch = vi.fn()
            mockPayrollPeriods.mockReturnValue({
                data: null,
                isLoading: false,
                isError: true,
                refetch: mockRefetch,
            })

            renderWithProviders(<PayrollHistory />)

            const retryButton = screen.getByText('Try Again')
            retryButton.click()

            await waitFor(() => {
                expect(mockRefetch).toHaveBeenCalled()
            })
        })
    })

    describe('Empty State', () => {
        it('renders empty state when no periods', () => {
            mockPayrollPeriods.mockReturnValue({
                data: { periods: [], ytdByCurrency: {}, warnings: [] },
                isLoading: false,
                isError: false,
                refetch: vi.fn(),
            })

            renderWithProviders(<PayrollHistory />)

            expect(screen.getByText('No pay periods yet')).toBeInTheDocument()
            expect(screen.getByText(/When you receive payments from clients/)).toBeInTheDocument()
        })
    })

    describe('Periods Display', () => {
        it('renders YTD summary with formatted amount', () => {
            mockPayrollPeriods.mockReturnValue({
                data: {
                    periods: mockPeriods,
                    ytdByCurrency: { USD: 230000 },
                    warnings: [],
                },
                isLoading: false,
                isError: false,
                refetch: vi.fn(),
            })

            renderWithProviders(<PayrollHistory />)

            expect(screen.getByText('Year to Date')).toBeInTheDocument()
            expect(screen.getByText('$2,300.00')).toBeInTheDocument()
        })

        it('renders period list with correct dates', () => {
            mockPayrollPeriods.mockReturnValue({
                data: {
                    periods: mockPeriods,
                    ytdByCurrency: { USD: 230000 },
                    warnings: [],
                },
                isLoading: false,
                isError: false,
                refetch: vi.fn(),
            })

            renderWithProviders(<PayrollHistory />)

            // Should show period date ranges (same month format: "Dec 1 - 15, 2024")
            const periodList = document.querySelector('.payroll-period-list')
            expect(periodList?.textContent).toContain('Dec')
            expect(periodList?.textContent).toContain('2024')
        })

        it('shows correct status badges', () => {
            mockPayrollPeriods.mockReturnValue({
                data: {
                    periods: mockPeriods,
                    ytdByCurrency: { USD: 230000 },
                    warnings: [],
                },
                isLoading: false,
                isError: false,
                refetch: vi.fn(),
            })

            renderWithProviders(<PayrollHistory />)

            expect(screen.getByText('Paid')).toBeInTheDocument()
            expect(screen.getByText('Pending')).toBeInTheDocument()
        })

        it('shows net amounts for each period', () => {
            mockPayrollPeriods.mockReturnValue({
                data: {
                    periods: mockPeriods,
                    ytdByCurrency: { USD: 230000 },
                    warnings: [],
                },
                isLoading: false,
                isError: false,
                refetch: vi.fn(),
            })

            renderWithProviders(<PayrollHistory />)

            expect(screen.getByText('$920.00')).toBeInTheDocument()
            expect(screen.getByText('$1,380.00')).toBeInTheDocument()
        })
    })

    describe('Warning Banner', () => {
        it('shows address warning when missing_address in warnings', () => {
            mockPayrollPeriods.mockReturnValue({
                data: {
                    periods: mockPeriods,
                    ytdByCurrency: { USD: 230000 },
                    warnings: [{ type: 'missing_address', message: 'Add your address' }],
                },
                isLoading: false,
                isError: false,
                refetch: vi.fn(),
            })

            renderWithProviders(<PayrollHistory />)

            expect(screen.getByText(/Add your address in Settings/)).toBeInTheDocument()
        })

        it('hides warning when no warnings present', () => {
            mockPayrollPeriods.mockReturnValue({
                data: {
                    periods: mockPeriods,
                    ytdByCurrency: { USD: 230000 },
                    warnings: [],
                },
                isLoading: false,
                isError: false,
                refetch: vi.fn(),
            })

            renderWithProviders(<PayrollHistory />)

            expect(screen.queryByText(/Add your address in Settings/)).not.toBeInTheDocument()
        })

        it('navigates to settings when warning is clicked', async () => {
            mockPayrollPeriods.mockReturnValue({
                data: {
                    periods: mockPeriods,
                    ytdByCurrency: { USD: 230000 },
                    warnings: [{ type: 'missing_address', message: 'Add your address' }],
                },
                isLoading: false,
                isError: false,
                refetch: vi.fn(),
            })

            renderWithProviders(<PayrollHistory />)

            const warningBanner = screen.getByText(/Add your address in Settings/).closest('div')
            warningBanner?.click()

            await waitFor(() => {
                expect(mockNavigate).toHaveBeenCalledWith('/settings')
            })
        })
    })

    describe('Navigation', () => {
        it('navigates to period detail on card click', async () => {
            mockPayrollPeriods.mockReturnValue({
                data: {
                    periods: mockPeriods,
                    ytdByCurrency: { USD: 230000 },
                    warnings: [],
                },
                isLoading: false,
                isError: false,
                refetch: vi.fn(),
            })

            renderWithProviders(<PayrollHistory />)

            // Find the first period card by its class
            const periodCards = document.querySelectorAll('.payroll-period-card')
            expect(periodCards.length).toBeGreaterThan(0)
            periodCards[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

            await waitFor(() => {
                expect(mockNavigate).toHaveBeenCalledWith('/payroll/period-1')
            })
        })

        it('navigates back on back button click', async () => {
            mockPayrollPeriods.mockReturnValue({
                data: {
                    periods: mockPeriods,
                    ytdByCurrency: { USD: 230000 },
                    warnings: [],
                },
                isLoading: false,
                isError: false,
                refetch: vi.fn(),
            })

            renderWithProviders(<PayrollHistory />)

            const backButton = document.querySelector('.payroll-back-btn')
            backButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

            await waitFor(() => {
                expect(mockNavigate).toHaveBeenCalledWith(-1)
            })
        })
    })
})
