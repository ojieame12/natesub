import { useMemo, useRef, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Calendar,
    UserPlus,
    DollarSign,
    RefreshCw,
    UserX,
    Inbox,
    Share2,
    Send,
    Check,
    XCircle,
    RotateCcw,
    AlertTriangle,
    CheckCircle,
    Banknote,
    ShieldAlert,
    ShieldCheck,
    ShieldX,
} from 'lucide-react'
import { Pressable, Skeleton, SkeletonList, ErrorState, LoadingButton, PullToRefresh } from './components'
import { useScrolled, useDelayedLoading } from './hooks'
import { useActivity, useMetrics, useCurrentUser } from './api/hooks'
import { centsToDisplayAmount, getCurrencySymbol, formatCompactNumber, formatSmartAmount } from './utils/currency'
import './Activity.css'

// Activity icon helper - comprehensive list
const getActivityIcon = (type: string) => {
    switch (type) {
        // Positive events
        case 'subscription_created':
        case 'new_subscriber': return <UserPlus size={20} />
        case 'payment_received':
        case 'payment': return <DollarSign size={20} />
        case 'renewal': return <RefreshCw size={20} />
        case 'request_accepted': return <Check size={20} />
        case 'dispute_won': return <ShieldCheck size={20} />
        case 'payout_completed': return <CheckCircle size={20} />

        // Negative events
        case 'payment_refunded': return <RotateCcw size={20} />
        case 'dispute_lost': return <ShieldX size={20} />

        // Warning events
        case 'payment_failed': return <XCircle size={20} />
        case 'dispute_created': return <ShieldAlert size={20} />
        case 'payout_failed': return <AlertTriangle size={20} />

        // Neutral events
        case 'subscription_canceled':
        case 'cancelled':
        case 'subscription_auto_canceled': return <UserX size={20} />
        case 'request_sent': return <Send size={20} />
        case 'request_declined': return <XCircle size={20} />
        case 'payout_initiated': return <Banknote size={20} />
        case 'payout_in_transit': return <Banknote size={20} />

        default: return <DollarSign size={20} />
    }
}

// Icon class determines color/background
const getActivityIconClass = (type: string) => {
    switch (type) {
        // Positive - green
        case 'subscription_created':
        case 'new_subscriber': return 'activity-icon subscriber'
        case 'payment_received':
        case 'payment': return 'activity-icon payment'
        case 'renewal': return 'activity-icon renewal'
        case 'request_accepted': return 'activity-icon payment'
        case 'dispute_won': return 'activity-icon payment'
        case 'payout_completed': return 'activity-icon payment'

        // Negative - red
        case 'payment_refunded':
        case 'dispute_lost': return 'activity-icon refund'

        // Warning - amber
        case 'payment_failed':
        case 'dispute_created':
        case 'payout_failed': return 'activity-icon warning'

        // Neutral - gray
        case 'subscription_canceled':
        case 'cancelled':
        case 'subscription_auto_canceled': return 'activity-icon cancelled'
        case 'request_sent':
        case 'request_declined':
        case 'payout_initiated': return 'activity-icon neutral'
        case 'payout_in_transit': return 'activity-icon payment' // Blue/positive since money is on the way

        default: return 'activity-icon'
    }
}

// Title with service vs personal variants
const getActivityTitle = (type: string, isService: boolean) => {
    switch (type) {
        // Positive
        case 'subscription_created':
        case 'new_subscriber': return isService ? 'New Client' : 'New Subscriber'
        case 'payment_received':
        case 'payment': return isService ? 'Invoice Paid' : 'Payment Received'
        case 'renewal': return isService ? 'Retainer Renewed' : 'Renewed'
        case 'request_accepted': return isService ? 'Invoice Accepted' : 'Request Accepted'
        case 'dispute_won': return 'Dispute Won'
        case 'payout_completed': return 'Payout Received'

        // Negative
        case 'payment_refunded': return 'Refund Issued'
        case 'dispute_lost': return 'Dispute Lost'

        // Warning
        case 'payment_failed': return 'Payment Failed'
        case 'dispute_created': return 'Dispute Opened'
        case 'payout_failed': return 'Payout Failed'

        // Neutral
        case 'subscription_canceled':
        case 'cancelled':
        case 'subscription_auto_canceled': return isService ? 'Client Left' : 'Cancelled'
        case 'request_sent': return isService ? 'Invoice Sent' : 'Request Sent'
        case 'request_declined': return isService ? 'Invoice Declined' : 'Request Declined'
        case 'payout_initiated': return 'Payout Started'
        case 'payout_in_transit': return 'Payout In Transit'

        default: return 'Activity'
    }
}

// Check if amount should show as negative
const isNegativeActivity = (type: string) => {
    return ['payment_refunded', 'dispute_lost'].includes(type)
}

// Format date for grouping
const formatDateGroup = (date: Date | string) => {
    const now = new Date()
    const d = new Date(date)
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)

    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return d.toLocaleDateString('en-US', { weekday: 'long' })
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Format time
const formatTime = (date: Date | string) => {
    return new Date(date).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    })
}

export default function Activity() {
    const navigate = useNavigate()
    const [scrollRef, isScrolled] = useScrolled()
    const { data: userData } = useCurrentUser()
    const currencyCode = userData?.profile?.currency || 'USD'
    const isService = userData?.profile?.purpose === 'service'

    // Track previously seen activity IDs to detect new items
    const [seenIds, setSeenIds] = useState<Set<string>>(new Set())
    const [newIds, setNewIds] = useState<Set<string>>(new Set())

    // Real API hooks with polling enabled
    const {
        data: activityData,
        isLoading,
        isError,
        refetch,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useActivity(20, { seedFromLimit: 5, polling: true }) // Seed from Dashboard's cached data + poll every 30s

    // Delay showing skeleton to prevent flash on fast cache hits
    const showSkeleton = useDelayedLoading(isLoading, 200)

    // Track if this is the initial load to prevent re-animating on refetch
    const hasAnimatedRef = useRef(false)
    if (activityData && !hasAnimatedRef.current) {
        hasAnimatedRef.current = true
    }

    const { data: metricsData } = useMetrics()
    const metrics = metricsData?.metrics

    // Flatten paginated data
    const allActivities = useMemo(() => {
        return activityData?.pages.flatMap(page => page.activities) || []
    }, [activityData])

    // Detect new activities for entry animation
    // Cap seenIds at 200 to prevent unbounded memory growth in long sessions
    const MAX_SEEN_IDS = 200

    useEffect(() => {
        if (allActivities.length === 0) return

        const currentIds = allActivities.map((a: any) => a.id)

        // First load - just store IDs, no animations
        if (seenIds.size === 0) {
            // Keep only the most recent MAX_SEEN_IDS
            const cappedIds = new Set(currentIds.slice(0, MAX_SEEN_IDS))
            setSeenIds(cappedIds)
            return
        }

        // Find new IDs that weren't in previous set
        const freshIds = new Set<string>()
        currentIds.forEach(id => {
            if (!seenIds.has(id)) {
                freshIds.add(id)
            }
        })

        if (freshIds.size > 0) {
            setNewIds(freshIds)
            // Merge current IDs with seen, capped at MAX_SEEN_IDS
            const mergedIds = [...currentIds, ...Array.from(seenIds)]
            const cappedIds = new Set(mergedIds.slice(0, MAX_SEEN_IDS))
            setSeenIds(cappedIds)

            // Clear "new" state after animation completes
            const timer = setTimeout(() => {
                setNewIds(new Set())
            }, 600)
            return () => clearTimeout(timer)
        }
    }, [allActivities])

    // Pull-to-refresh handler
    const handleRefresh = async () => {
        await refetch()
    }

    // Group activities by date
    const groupedActivities = useMemo(() => {
        return allActivities.reduce((groups, activity: any) => {
            const date = formatDateGroup(activity.createdAt)
            if (!groups[date]) {
                groups[date] = []
            }
            groups[date].push(activity)
            return groups
        }, {} as Record<string, any[]>)
    }, [allActivities])

    const loadData = () => {
        refetch()
    }

    return (
        <PullToRefresh onRefresh={handleRefresh} disabled={isLoading}>
            <div className="activity-page" ref={scrollRef}>
                {/* Header */}
                <header className={`activity-header ${isScrolled ? 'scrolled' : ''}`}>
                    <h1 className="activity-page-title">Activity</h1>
                </header>

                {/* Content */}
                <div className="activity-content">
                    {isError ? (
                    <ErrorState
                        title="Couldn't load activity"
                        message="We had trouble loading your activity. Please try again."
                        onRetry={loadData}
                    />
                ) : showSkeleton ? (
                    <>
                        <div className="activity-section">
                            <div className="activity-date-header">
                                <Skeleton width={16} height={16} borderRadius="4px" />
                                <Skeleton width={60} height={14} />
                            </div>
                            <SkeletonList count={3} />
                        </div>
                        <div className="activity-section">
                            <div className="activity-date-header">
                                <Skeleton width={16} height={16} borderRadius="4px" />
                                <Skeleton width={80} height={14} />
                            </div>
                            <SkeletonList count={3} />
                        </div>
                    </>
                ) : allActivities.length === 0 ? (
                    <div className="activity-empty">
                        <div className="activity-empty-icon">
                            <Inbox size={24} />
                        </div>
                        <h3 className="activity-empty-title">No activity yet</h3>
                        <p className="activity-empty-desc">
                            {isService
                                ? "When you get clients or receive payments, they'll show up here."
                                : "When you get subscribers or receive payments, they'll show up here."
                            }
                        </p>
                        <Pressable className="activity-empty-btn" onClick={() => navigate('/dashboard')}>
                            <Share2 size={16} />
                            <span>Share Your Page</span>
                        </Pressable>
                    </div>
                ) : (
                    <>
                        {Object.entries(groupedActivities).map(([date, activities]) => (
                            <div key={date} className="activity-section">
                                {/* Date Header */}
                                <div className="activity-date-header">
                                    <Calendar size={16} />
                                    <span>{date}</span>
                                </div>

                                {/* Activity Group */}
                                <div className="activity-group">
                                    {activities.map((activity: any, index: number) => {
                                        const payload = activity.payload || {}
                                        const currency = (payload.currency || currencyCode || 'USD').toUpperCase()
                                        const currencySymbolForRow = getCurrencySymbol(currency)
                                        const amount = payload.amount ? centsToDisplayAmount(payload.amount, currency) : 0
                                        const name = payload.subscriberName || payload.recipientName || ''
                                        const tier = payload.tierName || ''
                                        const isNegative = isNegativeActivity(activity.type)
                                        const isCanceled = activity.type === 'subscription_canceled' || activity.type === 'subscription_auto_canceled'

                                        // Determine amount styling class
                                        const amountClass = isNegative ? 'refund' : isCanceled ? 'cancelled' : ''

                                        // Check if this is a newly arrived activity
                                        const isNew = newIds.has(activity.id)

                                        return (
                                            <Pressable
                                                key={activity.id}
                                                className={`activity-row ${hasAnimatedRef.current ? '' : 'stagger-item'} ${isNew ? 'activity-new' : ''}`}
                                                style={hasAnimatedRef.current && !isNew ? undefined : { animationDelay: `${Math.min(index, 5) * 50}ms` }}
                                                onClick={() => navigate(`/activity/${activity.id}`)}
                                            >
                                                <div className={getActivityIconClass(activity.type)}>
                                                    {getActivityIcon(activity.type)}
                                                </div>
                                                <div className="activity-info">
                                                    <div className="activity-row-title">{getActivityTitle(activity.type, isService)}</div>
                                                    <div className="activity-row-meta">
                                                        {formatTime(activity.createdAt)}{name ? ` - ${name}` : ''}
                                                    </div>
                                                </div>
                                                {amount > 0 && (
                                                    <div className="activity-amount-col">
                                                        <span className={`activity-amount ${amountClass}`}>
                                                            {isNegative ? '-' : isCanceled ? '' : '+'}{currencySymbolForRow}{formatCompactNumber(amount)}
                                                        </span>
                                                        {tier && <span className="activity-tier">{tier}</span>}
                                                    </div>
                                                )}
                                            </Pressable>
                                        )
                                    })}
                                </div>
                            </div>
                        ))}

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

                        {/* Monthly Summary */}
	                        {metrics && (
	                            <div className="summary-card">
	                                <span className="summary-title">Overview</span>
	                                <div className="summary-grid">
	                                    <div className="summary-stat">
	                                        <span className="summary-value">{formatCompactNumber(metrics.subscriberCount)}</span>
	                                        <span className="summary-label">{isService ? 'Clients' : 'Subscribers'}</span>
	                                    </div>
	                                    <div className="summary-stat">
	                                        <span className="summary-value positive">{formatSmartAmount(metrics.mrr, currencyCode, 10)}</span>
	                                        <span className="summary-label">MRR</span>
	                                    </div>
	                                    <div className="summary-stat">
	                                        <span className="summary-value">{formatSmartAmount(metrics.totalRevenue, currencyCode, 10)}</span>
	                                        <span className="summary-label">Total Revenue</span>
	                                    </div>
	                                </div>
	                            </div>
	                        )}
                    </>
                )}
            </div>
        </div>
        </PullToRefresh>
    )
}
