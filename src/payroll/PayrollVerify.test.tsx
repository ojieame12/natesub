import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, cleanup } from '@testing-library/react'
import { renderWithProviders } from '../test/testUtils'
import PayrollVerify from './PayrollVerify'

// Mock hooks
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom')
    return {
        ...actual,
        useParams: () => ({ code: 'NP-2024-DEC-ABC123' }),
    }
})

const mockPayrollVerify = vi.fn()

vi.mock('../api/hooks', () => ({
    usePayrollVerify: () => mockPayrollVerify(),
}))

// Mock window.open
const mockWindowOpen = vi.fn()
Object.defineProperty(window, 'open', {
    value: mockWindowOpen,
    writable: true,
})

// Sample data
const mockVerifiedDocument = {
    creatorName: 'John Creator',
    periodStart: '2024-12-01T00:00:00.000Z',
    periodEnd: '2024-12-15T23:59:59.999Z',
    grossCents: 100000,
    netCents: 92000,
    currency: 'USD',
    createdAt: '2024-12-16T10:00:00.000Z',
    verificationCode: 'NP-2024-DEC-ABC123',
    paymentCount: 5,
    payoutDate: '2024-12-17T10:00:00.000Z',
    payoutMethod: 'Bank Transfer',
    platformConfirmed: true,
}

const mockDocumentWithoutPayout = {
    ...mockVerifiedDocument,
    payoutDate: null,
}

describe('PayrollVerify', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    afterEach(() => {
        cleanup()
    })

    describe('Loading State', () => {
        it('shows loading spinner while verifying', () => {
            mockPayrollVerify.mockReturnValue({
                data: null,
                isLoading: true,
                isError: false,
            })

            renderWithProviders(<PayrollVerify />)

            expect(screen.getByText('Verifying...')).toBeInTheDocument()
            expect(screen.getByText('Please wait while we verify this pay statement.')).toBeInTheDocument()
        })
    })

    describe('Error States', () => {
        it('shows error state when verification fails', () => {
            mockPayrollVerify.mockReturnValue({
                data: null,
                isLoading: false,
                isError: true,
            })

            renderWithProviders(<PayrollVerify />)

            expect(screen.getByText('Verification Failed')).toBeInTheDocument()
            expect(screen.getByText(/This verification code is invalid/)).toBeInTheDocument()
        })

        it('shows error state when verified is false', () => {
            mockPayrollVerify.mockReturnValue({
                data: { verified: false },
                isLoading: false,
                isError: false,
            })

            renderWithProviders(<PayrollVerify />)

            expect(screen.getByText('Verification Failed')).toBeInTheDocument()
        })

        it('shows error state when document is missing', () => {
            mockPayrollVerify.mockReturnValue({
                data: { verified: true, document: null },
                isLoading: false,
                isError: false,
            })

            renderWithProviders(<PayrollVerify />)

            expect(screen.getByText('Verification Failed')).toBeInTheDocument()
        })
    })

    describe('Verified Document Display', () => {
        beforeEach(() => {
            mockPayrollVerify.mockReturnValue({
                data: { verified: true, document: mockVerifiedDocument },
                isLoading: false,
                isError: false,
            })
        })

        it('shows success state with title', () => {
            renderWithProviders(<PayrollVerify />)

            expect(screen.getByText('Income Statement Verified')).toBeInTheDocument()
            expect(screen.getByText('This is a valid income statement issued by NatePay.')).toBeInTheDocument()
        })

        it('displays recipient name', () => {
            renderWithProviders(<PayrollVerify />)

            expect(screen.getByText('Recipient')).toBeInTheDocument()
            expect(screen.getByText('John Creator')).toBeInTheDocument()
        })

        it('displays period range', () => {
            renderWithProviders(<PayrollVerify />)

            expect(screen.getByText('Period')).toBeInTheDocument()
            // Format: "Dec 1 - Dec 15, 2024" from formatPeriodRange - check within payroll-verify-details
            const detailsSection = document.querySelector('.payroll-verify-details')
            expect(detailsSection?.textContent).toContain('Dec')
            expect(detailsSection?.textContent).toContain('2024')
        })

        it('displays net amount with currency', () => {
            renderWithProviders(<PayrollVerify />)

            expect(screen.getByText('Net Income')).toBeInTheDocument()
            expect(screen.getByText('$920.00')).toBeInTheDocument()
        })

        it('displays payment count', () => {
            renderWithProviders(<PayrollVerify />)

            expect(screen.getByText('Payments')).toBeInTheDocument()
            expect(screen.getByText('5')).toBeInTheDocument()
        })

        it('displays payout date when available', () => {
            renderWithProviders(<PayrollVerify />)

            expect(screen.getByText('Deposited')).toBeInTheDocument()
            expect(screen.getByText('December 17, 2024')).toBeInTheDocument()
        })

        it('hides payout date when not available', () => {
            mockPayrollVerify.mockReturnValue({
                data: { verified: true, document: mockDocumentWithoutPayout },
                isLoading: false,
                isError: false,
            })

            renderWithProviders(<PayrollVerify />)

            expect(screen.queryByText('Deposited')).not.toBeInTheDocument()
        })

        it('displays issued date', () => {
            renderWithProviders(<PayrollVerify />)

            expect(screen.getByText('Issued')).toBeInTheDocument()
            expect(screen.getByText('December 16, 2024')).toBeInTheDocument()
        })

        it('shows platform confirmation badge', () => {
            renderWithProviders(<PayrollVerify />)

            expect(screen.getByText('Confirmed by NatePay')).toBeInTheDocument()
        })

        it('shows verification code', () => {
            renderWithProviders(<PayrollVerify />)

            expect(screen.getByText('Verification Code: NP-2024-DEC-ABC123')).toBeInTheDocument()
        })

        it('shows download button', () => {
            renderWithProviders(<PayrollVerify />)

            expect(screen.getByText('Download Verification PDF')).toBeInTheDocument()
        })

        it('shows disclaimer', () => {
            renderWithProviders(<PayrollVerify />)

            expect(screen.getByText(/This verification confirms that a payment was processed/)).toBeInTheDocument()
            expect(screen.getByText(/does not constitute employment verification/)).toBeInTheDocument()
        })
    })

    describe('Download Functionality', () => {
        it('opens verification PDF in new tab on button click', async () => {
            mockPayrollVerify.mockReturnValue({
                data: { verified: true, document: mockVerifiedDocument },
                isLoading: false,
                isError: false,
            })

            renderWithProviders(<PayrollVerify />)

            const downloadBtn = screen.getByText('Download Verification PDF').closest('div')
            downloadBtn?.click()

            expect(mockWindowOpen).toHaveBeenCalledWith(
                expect.stringContaining('/payroll/verify/NP-2024-DEC-ABC123/pdf'),
                '_blank'
            )
        })
    })

    describe('Currency Handling', () => {
        it('formats amounts with NGN currency correctly', () => {
            mockPayrollVerify.mockReturnValue({
                data: {
                    verified: true,
                    document: {
                        ...mockVerifiedDocument,
                        currency: 'NGN',
                        netCents: 9200000, // 92,000 NGN
                    },
                },
                isLoading: false,
                isError: false,
            })

            renderWithProviders(<PayrollVerify />)

            // Should show NGN formatted amount
            expect(screen.getByText(/₦92,000/)).toBeInTheDocument()
        })
    })
})
