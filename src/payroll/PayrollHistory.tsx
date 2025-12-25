import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, ChevronRight, Calendar, ArrowLeft, AlertTriangle, Filter, X, Loader2 } from 'lucide-react'
import type { PayPeriod } from '../api/client'
import { Pressable, Skeleton, ErrorState, useToast } from '../components'
import { usePayrollPeriods, useCurrentUser, useCustomStatement } from '../api/hooks'
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

// Get default date range (last 3 months)
const getDefaultDateRange = () => {
    const end = new Date()
    const start = new Date()
    start.setMonth(start.getMonth() - 3)
    return {
        start: start.toISOString().split('T')[0],
        end: end.toISOString().split('T')[0],
    }
}

export default function PayrollHistory() {
    const navigate = useNavigate()
    const toast = useToast()
    const { data: userData } = useCurrentUser()
    const currencyCode = userData?.profile?.currency || 'USD'

    const { data, isLoading, isError, refetch } = usePayrollPeriods()
    const periods = data?.periods || []
    const ytdByCurrency = data?.ytdByCurrency || {}
    const warnings = data?.warnings || []
    const groupedPeriods = groupByMonth(periods)
    const hasAddressWarning = warnings.some(w => w.type === 'missing_address')

    // Custom statement modal state
    const [showCustomModal, setShowCustomModal] = useState(false)
    const [customDateRange, setCustomDateRange] = useState(getDefaultDateRange)
    const [customResult, setCustomResult] = useState<{
        statement: any
        warnings: Array<{ type: string; message: string }>
    } | null>(null)
    const customStatement = useCustomStatement()

    const handleGenerateCustom = async () => {
        try {
            const result = await customStatement.mutateAsync({
                startDate: customDateRange.start,
                endDate: customDateRange.end,
            })
            setShowCustomModal(false)
            setCustomResult(result)
            toast.success('Custom report generated')
        } catch (err) {
            toast.error('Failed to generate statement')
        }
    }

    const clearCustomResult = () => {
        setCustomResult(null)
    }

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

                        {/* Custom Statement Result */}
                        {customResult && (
                            <div className="payroll-custom-result">
                                <div className="payroll-custom-result-header">
                                    <h3>Custom Report</h3>
                                    <Pressable className="payroll-custom-result-close" onClick={clearCustomResult}>
                                        <X size={16} />
                                    </Pressable>
                                </div>
                                <div className="payroll-custom-result-range">
                                    {formatPeriodRange(customResult.statement.periodStart, customResult.statement.periodEnd)}
                                </div>
                                <div className="payroll-custom-result-stats">
                                    <div className="payroll-custom-result-stat">
                                        <span className="stat-value">{formatCurrencyFromCents(customResult.statement.grossCents, customResult.statement.currency)}</span>
                                        <span className="stat-label">Gross</span>
                                    </div>
                                    <div className="payroll-custom-result-stat">
                                        <span className="stat-value">{formatCurrencyFromCents(customResult.statement.totalFeeCents, customResult.statement.currency)}</span>
                                        <span className="stat-label">Fees</span>
                                    </div>
                                    <div className="payroll-custom-result-stat highlight">
                                        <span className="stat-value">{formatCurrencyFromCents(customResult.statement.netCents, customResult.statement.currency)}</span>
                                        <span className="stat-label">Net</span>
                                    </div>
                                </div>
                                <div className="payroll-custom-result-meta">
                                    {customResult.statement.paymentCount} payment{customResult.statement.paymentCount !== 1 ? 's' : ''}
                                    {!customResult.statement.isVerifiable && (
                                        <span className="payroll-custom-note"> • Cannot be independently verified</span>
                                    )}
                                </div>
                            </div>
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

                        {/* Custom Report Action */}
                        <Pressable
                            className="payroll-custom-action"
                            onClick={() => setShowCustomModal(true)}
                        >
                            <Filter size={18} />
                            <div className="payroll-custom-action-text">
                                <span className="payroll-custom-action-title">Custom Report</span>
                                <span className="payroll-custom-action-desc">Generate a statement for any date range</span>
                            </div>
                            <ChevronRight size={18} />
                        </Pressable>

                        {/* Footer Note */}
                        <p className="payroll-footer-note">
                            Pay statements are generated after each payout period. Download PDFs for income verification.
                        </p>
                    </>
                )}
            </div>

            {/* Custom Statement Modal */}
            {showCustomModal && (
                <>
                    <div className="payroll-modal-overlay" onClick={() => setShowCustomModal(false)} />
                    <div className="payroll-modal">
                        <div className="payroll-modal-header">
                            <h2>Custom Report</h2>
                            <Pressable className="payroll-modal-close" onClick={() => setShowCustomModal(false)}>
                                <X size={20} />
                            </Pressable>
                        </div>

                        <div className="payroll-modal-content">
                            <p className="payroll-modal-desc">
                                Generate a custom income statement for any date range. Note: Custom reports cannot be independently verified.
                            </p>

                            <div className="payroll-date-inputs">
                                <label className="payroll-date-field">
                                    <span>Start Date</span>
                                    <input
                                        type="date"
                                        value={customDateRange.start}
                                        onChange={(e) => setCustomDateRange(prev => ({ ...prev, start: e.target.value }))}
                                        max={customDateRange.end}
                                    />
                                </label>
                                <label className="payroll-date-field">
                                    <span>End Date</span>
                                    <input
                                        type="date"
                                        value={customDateRange.end}
                                        onChange={(e) => setCustomDateRange(prev => ({ ...prev, end: e.target.value }))}
                                        min={customDateRange.start}
                                        max={new Date().toISOString().split('T')[0]}
                                    />
                                </label>
                            </div>
                        </div>

                        <div className="payroll-modal-actions">
                            <Pressable
                                className="payroll-modal-btn secondary"
                                onClick={() => setShowCustomModal(false)}
                            >
                                Cancel
                            </Pressable>
                            <Pressable
                                className="payroll-modal-btn primary"
                                onClick={handleGenerateCustom}
                                disabled={customStatement.isPending}
                            >
                                {customStatement.isPending ? (
                                    <>
                                        <Loader2 size={16} className="spin" />
                                        Generating...
                                    </>
                                ) : (
                                    'Generate Report'
                                )}
                            </Pressable>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
