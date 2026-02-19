import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    ArrowLeft,
    Check,
    Clock,
    XCircle,
    Building2,
    RefreshCw,
    Loader2,
    Inbox,
} from 'lucide-react'
import { Pressable, Skeleton, SkeletonList, ErrorState } from './components'
import { usePayoutHistory, useCurrentUser } from './api/hooks'
import { centsToDisplayAmount, getCurrencySymbol } from './utils/currency'
import './PayoutHistory.css'

// Format date for display
const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })
}

// Format short date
const formatShortDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
    })
}

// Get status display
const getStatusDisplay = (status: string) => {
    switch (status) {
        case 'paid':
            return { label: 'Deposited', icon: Check, className: 'success' }
        case 'pending':
            return { label: 'Processing', icon: Clock, className: 'pending' }
        case 'failed':
            return { label: 'Failed', icon: XCircle, className: 'error' }
        default:
            return { label: status, icon: Clock, className: 'pending' }
    }
}

// Group payouts by month
const groupByMonth = (payouts: any[]) => {
    const groups: Record<string, any[]> = {}

    for (const payout of payouts) {
        const date = new Date(payout.initiatedAt)
        const key = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        if (!groups[key]) groups[key] = []
        groups[key].push(payout)
    }

    return Object.entries(groups)
}

export default function PayoutHistory() {
    const navigate = useNavigate()
    const { data: userData } = useCurrentUser()
    const currencyCode = userData?.profile?.currency || 'USD'
    const currencySymbol = getCurrencySymbol(currencyCode)

    const {
        data,
        isLoading,
        isError,
        refetch,
        isRefetching,
    } = usePayoutHistory()

    const payouts = data?.payouts || []
    const accountHealth = data?.accountHealth

    const groupedPayouts = useMemo(() => groupByMonth(payouts), [payouts])

    // Loading state
    if (isLoading) {
        return (
            <div className="payout-history-page">
                <header className="payout-history-header">
                    <Pressable className="header-btn" onClick={() => navigate('/settings/payments')}>
                        <ArrowLeft size={20} />
                    </Pressable>
                    <h1 className="header-title">Payout History</h1>
                    <div className="header-spacer" />
                </header>

                <div className="payout-history-content">
                    {/* Account Health Skeleton */}
                    <div className="account-health-card">
                        <Skeleton width={100} height={14} />
                        <div className="health-stats">
                            <Skeleton width="100%" height={60} />
                        </div>
                    </div>

                    {/* List Skeleton */}
                    <SkeletonList count={5} />
                </div>
            </div>
        )
    }

    // Error state
    if (isError) {
        return (
            <div className="payout-history-page">
                <header className="payout-history-header">
                    <Pressable className="header-btn" onClick={() => navigate('/settings/payments')}>
                        <ArrowLeft size={20} />
                    </Pressable>
                    <h1 className="header-title">Payout History</h1>
                    <div className="header-spacer" />
                </header>

                <ErrorState
                    title="Couldn't load payouts"
                    message="We had trouble loading your payout history."
                    onRetry={() => refetch()}
                />
            </div>
        )
    }

    return (
        <div className="payout-history-page">
            {/* Header */}
            <header className="payout-history-header">
                <Pressable className="header-btn" onClick={() => navigate('/settings/payments')}>
                    <ArrowLeft size={20} />
                </Pressable>
                <h1 className="header-title">Payout History</h1>
                <Pressable
                    className="header-btn"
                    onClick={() => refetch()}
                    disabled={isRefetching}
                >
                    {isRefetching ? <Loader2 size={20} className="spin" /> : <RefreshCw size={20} />}
                </Pressable>
            </header>

            <div className="payout-history-content">
                {/* Account Health Summary */}
                {accountHealth && (
                    <div className="account-health-card">
                        <div className="health-header">
                            <span className="health-title">Current Balance</span>
                            <span className={`health-status ${accountHealth.payoutStatus}`}>
                                {accountHealth.payoutStatus === 'active' ? 'Active' :
                                 accountHealth.payoutStatus === 'pending' ? 'Pending Setup' :
                                 accountHealth.payoutStatus === 'restricted' ? 'Action Needed' : 'Disabled'}
                            </span>
                        </div>

                        <div className="health-stats">
                            <div className="health-stat">
                                <span className="health-stat-value">
                                    {getCurrencySymbol(accountHealth.currentBalance.currency)}{centsToDisplayAmount(accountHealth.currentBalance.available, accountHealth.currentBalance.currency)}
                                </span>
                                <span className="health-stat-label">Available</span>
                            </div>
                            {accountHealth.currentBalance.pending > 0 && (
                                <div className="health-stat pending">
                                    <span className="health-stat-value">
                                        {getCurrencySymbol(accountHealth.currentBalance.currency)}{centsToDisplayAmount(accountHealth.currentBalance.pending, accountHealth.currentBalance.currency)}
                                    </span>
                                    <span className="health-stat-label">Pending</span>
                                </div>
                            )}
                        </div>

                        {accountHealth.lastPayout && (
                            <div className="health-last-payout">
                                <Building2 size={14} />
                                <span>
                                    Last payout: {getCurrencySymbol(accountHealth.currentBalance.currency)}{centsToDisplayAmount(accountHealth.lastPayout.amount, accountHealth.currentBalance.currency)} on {formatShortDate(accountHealth.lastPayout.date)}
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {/* Empty State */}
                {payouts.length === 0 && (
                    <div className="payout-empty">
                        <div className="payout-empty-icon">
                            <Inbox size={48} />
                        </div>
                        <h3 className="payout-empty-title">No payouts yet</h3>
                        <p className="payout-empty-desc">
                            When you receive payments, they'll be automatically deposited to your bank account.
                        </p>
                    </div>
                )}

                {/* Payout List */}
                {groupedPayouts.map(([month, monthPayouts]) => (
                    <div key={month} className="payout-group">
                        <h3 className="payout-group-title">{month}</h3>

                        <div className="payout-list">
                            {monthPayouts.map((payout: any) => {
                                const status = getStatusDisplay(payout.status)
                                const StatusIcon = status.icon
                                const payoutCurrency = payout.currency || accountHealth?.currentBalance.currency || currencyCode

                                return (
                                    <div key={payout.id} className="payout-item">
                                        <div className={`payout-status-icon ${status.className}`}>
                                            <StatusIcon size={18} />
                                        </div>

                                        <div className="payout-info">
                                            <div className="payout-amount">
                                                {getCurrencySymbol(payoutCurrency)}{centsToDisplayAmount(payout.amount, payoutCurrency)}
                                            </div>
                                            <div className="payout-date">
                                                {payout.status === 'paid' && payout.arrivedAt
                                                    ? `Deposited ${formatDate(payout.arrivedAt)}`
                                                    : payout.status === 'pending'
                                                        ? `Initiated ${formatDate(payout.initiatedAt)}`
                                                        : payout.failureReason || `Failed ${formatDate(payout.initiatedAt)}`
                                                }
                                            </div>
                                        </div>

                                        <div className={`payout-badge ${status.className}`}>
                                            {status.label}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
