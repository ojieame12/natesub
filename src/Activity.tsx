import { useMemo, useCallback, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { GroupedVirtuoso } from 'react-virtuoso'
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
} from 'lucide-react'
import { Pressable, Skeleton, SkeletonList, ErrorState, LoadingButton } from './components'
import { useScrolled } from './hooks'
import { useActivity, useMetrics, useCurrentUser } from './api/hooks'
import { centsToDisplayAmount, getCurrencySymbol, formatCompactNumber, formatSmartAmount } from './utils/currency'
import './Activity.css'

// Activity icon helper
const getActivityIcon = (type: string) => {
    switch (type) {
        case 'subscription_created':
        case 'new_subscriber': return <UserPlus size={20} />
        case 'payment_received':
        case 'payment': return <DollarSign size={20} />
        case 'renewal': return <RefreshCw size={20} />
        case 'subscription_canceled':
        case 'cancelled': return <UserX size={20} />
        case 'request_sent': return <Send size={20} />
        case 'request_accepted': return <Check size={20} />
        default: return <DollarSign size={20} />
    }
}

const getActivityIconClass = (type: string) => {
    switch (type) {
        case 'subscription_created':
        case 'new_subscriber': return 'activity-icon subscriber'
        case 'payment_received':
        case 'payment': return 'activity-icon payment'
        case 'renewal': return 'activity-icon renewal'
        case 'subscription_canceled':
        case 'cancelled': return 'activity-icon cancelled'
        case 'request_sent':
        case 'request_accepted': return 'activity-icon payment'
        default: return 'activity-icon'
    }
}

const getActivityTitle = (type: string, isService: boolean) => {
    switch (type) {
        case 'subscription_created':
        case 'new_subscriber': return isService ? 'New Client' : 'New Subscriber'
        case 'payment_received':
        case 'payment': return isService ? 'Invoice Paid' : 'Payment Received'
        case 'renewal': return isService ? 'Retainer Renewed' : 'Renewed'
        case 'subscription_canceled':
        case 'cancelled': return isService ? 'Client Left' : 'Cancelled'
        case 'request_sent': return isService ? 'Invoice Sent' : 'Request Sent'
        case 'request_accepted': return isService ? 'Invoice Accepted' : 'Request Accepted'
        default: return 'Activity'
    }
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

// Memoized activity row for virtualization performance
interface ActivityRowProps {
    activity: any
    currencyCode: string
    isService: boolean
    onNavigate: (id: string) => void
}

const ActivityRow = memo(function ActivityRow({ activity, currencyCode, isService, onNavigate }: ActivityRowProps) {
    const payload = activity.payload || {}
    const currency = (payload.currency || currencyCode || 'USD').toUpperCase()
    const currencySymbolForRow = getCurrencySymbol(currency)
    const amount = payload.amount ? centsToDisplayAmount(payload.amount, currency) : 0
    const name = payload.subscriberName || payload.recipientName || ''
    const tier = payload.tierName || ''
    const isCanceled = activity.type === 'subscription_canceled'

    return (
        <Pressable
            className="activity-row"
            onClick={() => onNavigate(activity.id)}
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
                    <span className={`activity-amount ${isCanceled ? 'cancelled' : ''}`}>
                        {isCanceled ? '-' : '+'}{currencySymbolForRow}{formatCompactNumber(amount)}
                    </span>
                    {tier && <span className="activity-tier">{tier}</span>}
                </div>
            )}
        </Pressable>
    )
})

export default function Activity() {
    const navigate = useNavigate()
    const [scrollRef, isScrolled] = useScrolled()
    const { data: userData } = useCurrentUser()
    const currencyCode = userData?.profile?.currency || 'USD'
    const isService = userData?.profile?.purpose === 'service'

    // Real API hooks
    const {
        data: activityData,
        isLoading,
        isError,
        refetch,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useActivity(20)

    const { data: metricsData } = useMetrics()
    const metrics = metricsData?.metrics

    // Flatten paginated data
    const allActivities = useMemo(() => {
        return activityData?.pages.flatMap(page => page.activities) || []
    }, [activityData])

    // Group activities by date for virtualized list
    const { groups, groupCounts, flatActivities } = useMemo(() => {
        const grouped: Record<string, any[]> = {}

        for (const activity of allActivities) {
            const date = formatDateGroup(activity.createdAt)
            if (!grouped[date]) {
                grouped[date] = []
            }
            grouped[date].push(activity)
        }

        const groupNames = Object.keys(grouped)
        const counts = groupNames.map(name => grouped[name].length)
        const flat = groupNames.flatMap(name => grouped[name])

        return { groups: groupNames, groupCounts: counts, flatActivities: flat }
    }, [allActivities])

    const handleNavigate = useCallback((id: string) => {
        navigate(`/activity/${id}`)
    }, [navigate])

    const loadData = () => {
        refetch()
    }

    // Render group header (date)
    const renderGroupHeader = useCallback((index: number) => (
        <div className="activity-date-header">
            <Calendar size={16} />
            <span>{groups[index]}</span>
        </div>
    ), [groups])

    // Render activity item
    const renderItem = useCallback((index: number) => (
        <ActivityRow
            activity={flatActivities[index]}
            currencyCode={currencyCode}
            isService={isService}
            onNavigate={handleNavigate}
        />
    ), [flatActivities, currencyCode, isService, handleNavigate])

    // Footer component with load more and summary
    const Footer = useCallback(() => (
        <>
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
    ), [hasNextPage, fetchNextPage, isFetchingNextPage, metrics, isService, currencyCode])

    return (
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
                ) : isLoading ? (
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
                    <GroupedVirtuoso
                        useWindowScroll
                        groupCounts={groupCounts}
                        groupContent={renderGroupHeader}
                        itemContent={renderItem}
                        components={{ Footer }}
                        style={{ minHeight: '100%' }}
                    />
                )}
            </div>
        </div>
    )
}
