import { useNavigate } from 'react-router-dom'
import { FileText, ChevronRight, Calendar, ArrowLeft, AlertTriangle } from 'lucide-react'
import type { PayPeriod } from '../api/client'
import { Pressable, Skeleton, ErrorState } from '../components'
import { usePayrollPeriods, useCurrentUser } from '../api/hooks'
import { formatCurrencyFromCents } from '../utils/currency'
import './payroll.css'

// Format date range for display
const formatPeriodRange = (start: string, end: string) => {
    const startDate = new Date(start)
    const endDate = new Date(end)
    const sameMonth = startDate.getMonth() === endDate.getMonth()

    if (sameMonth) {
        return `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.getDate()}, ${endDate.getFullYear()}`
    }
    return `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

// Group periods by month
const groupByMonth = (periods: PayPeriod[]) => {
    return periods.reduce((groups, period) => {
        const date = new Date(period.startDate)
        const key = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        if (!groups[key]) {
            groups[key] = []
        }
        groups[key].push(period)
        return groups
    }, {} as Record<string, PayPeriod[]>)
}

export default function PayrollHistory() {
    const navigate = useNavigate()
    const { data: userData } = useCurrentUser()
    const currencyCode = userData?.profile?.currency || 'USD'

    const { data, isLoading, isError, refetch } = usePayrollPeriods()
    const periods = data?.periods || []
    const ytdByCurrency = data?.ytdByCurrency || {}
    const warnings = data?.warnings || []
    const groupedPeriods = groupByMonth(periods)
    const hasAddressWarning = warnings.some(w => w.type === 'missing_address')

    // Get YTD entries sorted by user's preferred currency first
    const ytdEntries = Object.entries(ytdByCurrency).sort(([a], [b]) => {
        if (a === currencyCode) return -1
        if (b === currencyCode) return 1
        return a.localeCompare(b)
    })

    return (
        <div className="payroll-page">
            {/* Header */}
            <header className="payroll-header">
                <Pressable className="payroll-back-btn" onClick={() => navigate(-1)}>
                    <ArrowLeft size={20} />
                </Pressable>
                <img src="/logo.svg" alt="NatePay" className="payroll-logo" />
                <div className="payroll-header-spacer" />
            </header>

            {/* Page Title */}
            <div className="payroll-page-title">
                <h1>Payroll</h1>
            </div>

            {/* Content */}
            <div className="payroll-content">
                {isError ? (
                    <ErrorState
                        title="Couldn't load payroll"
                        message="We had trouble loading your pay history. Please try again."
                        onRetry={refetch}
                    />
                ) : isLoading ? (
                    <>
                        {/* YTD Skeleton */}
                        <div className="payroll-ytd-card">
                            <Skeleton width={100} height={12} />
                            <Skeleton width={140} height={32} style={{ marginTop: 8 }} />
                        </div>

                        {/* Period Skeletons */}
                        <div className="payroll-section">
                            <Skeleton width={120} height={14} style={{ marginBottom: 12 }} />
                            <div className="payroll-period-card">
                                <Skeleton width="100%" height={72} borderRadius="12px" />
                            </div>
                            <div className="payroll-period-card">
                                <Skeleton width="100%" height={72} borderRadius="12px" />
                            </div>
                        </div>
                    </>
                ) : periods.length === 0 ? (
                    <div className="payroll-empty">
                        <div className="payroll-empty-icon">
                            <FileText size={24} />
                        </div>
                        <h3 className="payroll-empty-title">No pay periods yet</h3>
                        <p className="payroll-empty-desc">
                            When you receive payments from clients, your pay statements will appear here.
                        </p>
                    </div>
                ) : (
                    <>
                        {/* YTD Summary - per currency for mathematical accuracy */}
                        <div className="payroll-ytd-card">
                            <span className="payroll-ytd-label">Year to Date</span>
                            {ytdEntries.length === 0 ? (
                                <span className="payroll-ytd-amount">{formatCurrencyFromCents(0, currencyCode)}</span>
                            ) : ytdEntries.length === 1 ? (
                                <span className="payroll-ytd-amount">
                                    {formatCurrencyFromCents(ytdEntries[0][1], ytdEntries[0][0])}
                                </span>
                            ) : (
                                <div className="payroll-ytd-multi">
                                    {ytdEntries.map(([currency, amount]) => (
                                        <span key={currency} className="payroll-ytd-amount">
                                            {formatCurrencyFromCents(amount, currency)}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Address Warning */}
                        {hasAddressWarning && (
                            <Pressable
                                className="payroll-warning-banner"
                                onClick={() => navigate('/settings')}
                            >
                                <AlertTriangle size={16} />
                                <span>Add your address in Settings for complete income statements</span>
                            </Pressable>
                        )}

                        {/* Grouped Periods */}
                        {Object.entries(groupedPeriods).map(([month, monthPeriods]) => (
                            <div key={month} className="payroll-section">
                                <div className="payroll-section-header">
                                    <Calendar size={14} />
                                    <span>{month}</span>
                                </div>

                                <div className="payroll-period-list">
                                    {monthPeriods.map((period) => (
                                        <Pressable
                                            key={period.id}
                                            className="payroll-period-card"
                                            onClick={() => navigate(`/payroll/${period.id}`)}
                                        >
                                            <div className="payroll-period-info">
                                                <span className="payroll-period-range">
                                                    {formatPeriodRange(period.startDate, period.endDate)}
                                                </span>
                                                <span className="payroll-period-status">
                                                    {period.status === 'current' ? (
                                                        <span className="payroll-status-badge current">Current</span>
                                                    ) : period.status === 'pending' ? (
                                                        <span className="payroll-status-badge pending">Pending</span>
                                                    ) : (
                                                        <span className="payroll-status-badge paid">Paid</span>
                                                    )}
                                                </span>
                                            </div>
                                            <div className="payroll-period-right">
                                                <span className="payroll-period-amount">
                                                    {formatCurrencyFromCents(period.netAmount, period.currency || currencyCode)}
                                                </span>
                                                <ChevronRight size={18} className="payroll-period-chevron" />
                                            </div>
                                        </Pressable>
                                    ))}
                                </div>
                            </div>
                        ))}

                        {/* Footer Note */}
                        <p className="payroll-footer-note">
                            Pay statements are generated after each payout period. Download PDFs for income verification.
                        </p>
                    </>
                )}
            </div>
        </div>
    )
}
