import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    ArrowLeft,
    Clock,
    Eye,
    Check,
    X,
    ChevronRight,
    Send,
    RefreshCw,
    Filter,
} from 'lucide-react'
import { Pressable, useToast, SkeletonList, ErrorState, LoadingButton } from './components'
import { useRequests, useCurrentUser } from './api/hooks'
import { getCurrencySymbol, formatCompactNumber } from './utils/currency'
import './SentRequests.css'

// Display status type (UI-facing)
type DisplayStatus = 'pending' | 'viewed' | 'accepted' | 'declined' | 'expired'

// Map API status to display status
const mapApiStatusToDisplay = (apiStatus: string): DisplayStatus => {
    switch (apiStatus) {
        case 'sent': return 'pending'
        case 'pending_payment': return 'viewed'
        case 'accepted': return 'accepted'
        case 'declined': return 'declined'
        case 'expired': return 'expired'
        default: return 'pending'
    }
}

// Format date for display
const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })
}

const getStatusIcon = (status: DisplayStatus) => {
    switch (status) {
        case 'pending': return <Clock size={16} />
        case 'viewed': return <Eye size={16} />
        case 'accepted': return <Check size={16} />
        case 'declined': return <X size={16} />
        case 'expired': return <Clock size={16} />
    }
}

const getStatusLabel = (status: DisplayStatus) => {
    switch (status) {
        case 'pending': return 'Pending'
        case 'viewed': return 'Viewed'
        case 'accepted': return 'Accepted'
        case 'declined': return 'Declined'
        case 'expired': return 'Expired'
    }
}

// Map UI filter to API status
type FilterType = 'all' | 'pending' | 'viewed' | 'accepted' | 'declined'
type ApiStatus = 'all' | 'sent' | 'pending_payment' | 'accepted' | 'declined' | 'expired'

const mapFilterToApiStatus = (filter: FilterType): ApiStatus => {
    switch (filter) {
        case 'pending': return 'sent'
        case 'viewed': return 'pending_payment'
        case 'accepted': return 'accepted'
        case 'declined': return 'declined'
        default: return 'all'
    }
}

export default function SentRequests() {
    const navigate = useNavigate()
    const toast = useToast()
    const [filter, setFilter] = useState<FilterType>('all')
    const [showFilters, setShowFilters] = useState(false)
    const { data: userData } = useCurrentUser()
    const currencySymbol = getCurrencySymbol(userData?.profile?.currency || 'USD')

    // Real API hook - fetch requests based on filter
    const {
        data,
        isLoading,
        isError,
        refetch,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useRequests(mapFilterToApiStatus(filter))

    // Flatten paginated data
    const allRequests = useMemo(() => {
        return data?.pages.flatMap(page => page.requests) || []
    }, [data])

    // Stats (from all requests, not filtered)
    const stats = useMemo(() => {
        const all = allRequests
        return {
            total: all.length,
            pending: all.filter((r: any) => r.status === 'sent').length,
            accepted: all.filter((r: any) => r.status === 'accepted').length,
            declined: all.filter((r: any) => r.status === 'declined').length,
        }
    }, [allRequests])

    const handleResend = (id: string) => {
        // TODO: Implement resend via API - would need to create new draft and send
        toast.success('Request resent')
        console.log('Resend request:', id)
    }

    const loadData = () => {
        refetch()
    }

    return (
        <div className="sent-requests-page">
            {/* Header */}
            <header className="sent-requests-header">
                <Pressable className="back-btn" onClick={() => navigate(-1)}>
                    <ArrowLeft size={20} />
                </Pressable>
                <img src="/logo.svg" alt="NatePay" className="header-logo" />
                <Pressable className="filter-btn" onClick={() => setShowFilters(!showFilters)}>
                    <Filter size={20} />
                </Pressable>
            </header>

            {/* Stats Row */}
            <div className="requests-stats-row">
                <div className="requests-stat">
                    <span className="requests-stat-value">{stats.total}</span>
                    <span className="requests-stat-label">Total</span>
                </div>
                <div className="requests-stat-divider" />
                <div className="requests-stat">
                    <span className="requests-stat-value pending">{stats.pending}</span>
                    <span className="requests-stat-label">Pending</span>
                </div>
                <div className="requests-stat-divider" />
                <div className="requests-stat">
                    <span className="requests-stat-value accepted">{stats.accepted}</span>
                    <span className="requests-stat-label">Accepted</span>
                </div>
                <div className="requests-stat-divider" />
                <div className="requests-stat">
                    <span className="requests-stat-value declined">{stats.declined}</span>
                    <span className="requests-stat-label">Declined</span>
                </div>
            </div>

            {/* Filter Tabs */}
            {showFilters && (
                <div className="requests-filter-tabs">
                    {(['all', 'pending', 'viewed', 'accepted', 'declined'] as FilterType[]).map((f) => (
                        <Pressable
                            key={f}
                            className={`requests-filter-tab ${filter === f ? 'active' : ''}`}
                            onClick={() => setFilter(f)}
                        >
                            {f.charAt(0).toUpperCase() + f.slice(1)}
                        </Pressable>
                    ))}
                </div>
            )}

            {/* Requests List */}
            <div className="sent-requests-content">
                {isError ? (
                    <ErrorState
                        title="Couldn't load requests"
                        message="We had trouble loading your sent requests. Please try again."
                        onRetry={loadData}
                    />
                ) : isLoading ? (
                    <SkeletonList count={5} />
                ) : allRequests.length === 0 ? (
                    <div className="requests-empty">
                        <div className="requests-empty-icon">
                            <Send size={32} />
                        </div>
                        <p className="requests-empty-title">No requests found</p>
                        <p className="requests-empty-desc">
                            {filter === 'all'
                                ? 'Send your first request to get started'
                                : `No ${filter} requests`}
                        </p>
                        <Pressable
                            className="requests-empty-btn"
                            onClick={() => navigate('/new-request')}
                        >
                            <Send size={18} />
                            <span>New Request</span>
                        </Pressable>
                    </div>
                ) : (
                    <div className="requests-list">
                        {allRequests.map((request: any, index: number) => {
                            const displayStatus = mapApiStatusToDisplay(request.status)
                            const sentDate = request.sentAt ? formatDate(request.sentAt) : formatDate(request.createdAt)
                            const sentVia = request.sendMethod || 'link'

                            return (
                                <div
                                    key={request.id}
                                    className="request-card animate-fade-in-up"
                                    style={{ animationDelay: `${index * 0.05}s`, animationFillMode: 'both' }}
                                >
                                    <Pressable className="request-card-main">
                                        <div className="request-avatar">
                                            {request.recipientName.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="request-info">
                                            <div className="request-top-row">
                                                <span className="request-recipient">{request.recipientName}</span>
                                                <span className="request-amount">
                                                    {currencySymbol}{formatCompactNumber(request.amount)}{request.isRecurring ? '/mo' : ''}
                                                </span>
                                            </div>
                                            <div className="request-bottom-row">
                                                <span className="request-purpose">{request.relationship}</span>
                                                <span className="request-date">{sentDate}</span>
                                            </div>
                                        </div>
                                        <ChevronRight size={18} className="request-chevron" />
                                    </Pressable>

                                    <div className="request-card-footer">
                                        <div className={`request-status ${displayStatus}`}>
                                            {getStatusIcon(displayStatus)}
                                            <span>{getStatusLabel(displayStatus)}</span>
                                        </div>

                                        <div className="request-actions">
                                            {(displayStatus === 'declined' || displayStatus === 'expired') && (
                                                <Pressable
                                                    className="request-action-btn"
                                                    onClick={() => handleResend(request.id)}
                                                >
                                                    <RefreshCw size={14} />
                                                    <span>Resend</span>
                                                </Pressable>
                                            )}
                                            {displayStatus === 'pending' && (
                                                <span className="request-via">via {sentVia}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )
                        })}

                        {/* Load More */}
                        {hasNextPage && (
                            <LoadingButton
                                className="load-more-btn"
                                onClick={async () => { await fetchNextPage() }}
                                loading={isFetchingNextPage}
                                variant="secondary"
                            >
                                Load More
                            </LoadingButton>
                        )}
                    </div>
                )}
            </div>

            {/* FAB for new request */}
            <Pressable className="requests-fab" onClick={() => navigate('/new-request')}>
                <Send size={24} />
            </Pressable>
        </div>
    )
}
