import { useMemo } from 'react'
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
} from 'lucide-react'
import { Pressable, Skeleton, SkeletonList, ErrorState } from './components'
import { useScrolled } from './hooks'
import { useActivity, useMetrics, useCurrentUser } from './api/hooks'
import { getCurrencySymbol, formatCompactNumber } from './utils/currency'
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

export default function Activity() {
    const navigate = useNavigate()
    const [scrollRef, isScrolled] = useScrolled()
    const { data: userData } = useCurrentUser()
    const currencySymbol = getCurrencySymbol(userData?.profile?.currency || 'USD')
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
                                        const amount = payload.amount ? payload.amount / 100 : 0
                                        const name = payload.subscriberName || payload.recipientName || ''
                                        const tier = payload.tierName || ''
                                        const isCanceled = activity.type === 'subscription_canceled'

                                        return (
                                            <Pressable
                                                key={activity.id}
                                                className="activity-row stagger-item"
                                                style={{ animationDelay: `${index * 50}ms` }}
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
                                                        <span className={`activity-amount ${isCanceled ? 'cancelled' : ''}`}>
                                                            {isCanceled ? '-' : '+'}{currencySymbol}{formatCompactNumber(amount)}
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
                            <Pressable
                                className="load-more-btn"
                                onClick={() => fetchNextPage()}
                                disabled={isFetchingNextPage}
                            >
                                {isFetchingNextPage ? 'Loading...' : 'Load More'}
                            </Pressable>
                        )}

                        {/* Monthly Summary */}
                        {metrics && (
                            <div className="summary-card">
                                <span className="summary-title">Overview</span>
                                <div className="summary-grid">
                                    <div className="summary-stat">
                                        <span className="summary-value">{metrics.subscriberCount}</span>
                                        <span className="summary-label">{isService ? 'Clients' : 'Subscribers'}</span>
                                    </div>
                                    <div className="summary-stat">
                                        <span className="summary-value positive">{currencySymbol}{metrics.mrr}</span>
                                        <span className="summary-label">MRR</span>
                                    </div>
                                    <div className="summary-stat">
                                        <span className="summary-value">{currencySymbol}{metrics.totalRevenue}</span>
                                        <span className="summary-label">Total Revenue</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}
