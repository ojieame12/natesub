import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    ChevronLeft,
    Calendar,
    UserPlus,
    DollarSign,
    RefreshCw,
    UserX,
    Activity as ActivityIcon,
    Share2,
} from 'lucide-react'
import { Pressable, Skeleton, SkeletonList, ErrorState } from './components'
import './Activity.css'

// Mock activity data with dates
const activityData = [
    { id: 1, type: 'new_subscriber', name: 'Sarah K.', amount: 10, time: '10:45 AM', tier: 'Supporter', date: 'Today' },
    { id: 2, type: 'payment', name: 'James T.', amount: 25, time: '9:30 AM', tier: 'VIP', date: 'Today' },
    { id: 3, type: 'new_subscriber', name: 'Mike R.', amount: 5, time: '8:15 AM', tier: 'Fan', date: 'Today' },
    { id: 4, type: 'renewal', name: 'Lisa M.', amount: 10, time: '5:30 PM', tier: 'Supporter', date: 'Yesterday' },
    { id: 5, type: 'cancelled', name: 'Tom H.', amount: 5, time: '2:15 PM', tier: 'Fan', date: 'Yesterday' },
    { id: 6, type: 'payment', name: 'Emma W.', amount: 25, time: '11:00 AM', tier: 'VIP', date: 'Yesterday' },
    { id: 7, type: 'new_subscriber', name: 'Alex P.', amount: 10, time: '9:45 AM', tier: 'Supporter', date: 'Dec 7' },
    { id: 8, type: 'renewal', name: 'Jordan B.', amount: 25, time: '4:20 PM', tier: 'VIP', date: 'Dec 7' },
]

// Activity icon helper
const getActivityIcon = (type: string) => {
    switch (type) {
        case 'new_subscriber': return <UserPlus size={20} />
        case 'payment': return <DollarSign size={20} />
        case 'renewal': return <RefreshCw size={20} />
        case 'cancelled': return <UserX size={20} />
        default: return <DollarSign size={20} />
    }
}

const getActivityIconClass = (type: string) => {
    switch (type) {
        case 'new_subscriber': return 'activity-icon subscriber'
        case 'payment': return 'activity-icon payment'
        case 'renewal': return 'activity-icon renewal'
        case 'cancelled': return 'activity-icon cancelled'
        default: return 'activity-icon'
    }
}

const getActivityTitle = (type: string) => {
    switch (type) {
        case 'new_subscriber': return 'New Subscriber'
        case 'payment': return 'Payment Received'
        case 'renewal': return 'Renewed'
        case 'cancelled': return 'Cancelled'
        default: return 'Activity'
    }
}

export default function Activity() {
    const navigate = useNavigate()
    const [isLoading, setIsLoading] = useState(true)
    const [hasError, setHasError] = useState(false)

    // Load data with error handling
    const loadData = async () => {
        setIsLoading(true)
        setHasError(false)
        try {
            await new Promise(resolve => setTimeout(resolve, 600))
        } catch {
            setHasError(true)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        loadData()
    }, [])

    // Group activities by date
    const groupedActivities = activityData.reduce((groups, activity) => {
        const date = activity.date
        if (!groups[date]) {
            groups[date] = []
        }
        groups[date].push(activity)
        return groups
    }, {} as Record<string, typeof activityData>)

    return (
        <div className="activity-page">
            {/* Header */}
            <header className="activity-header">
                <Pressable className="back-btn" onClick={() => navigate(-1)}>
                    <ChevronLeft size={24} />
                </Pressable>
                <span className="activity-page-title">Activity</span>
                <div className="header-spacer" />
            </header>

            {/* Content */}
            <div className="activity-content">
                {hasError ? (
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
                ) : activityData.length === 0 ? (
                    <div className="activity-empty">
                        <div className="activity-empty-icon">
                            <ActivityIcon size={32} />
                        </div>
                        <h3 className="activity-empty-title">No activity yet</h3>
                        <p className="activity-empty-desc">
                            When you get subscribers or receive payments, they'll show up here.
                        </p>
                        <Pressable className="activity-empty-btn" onClick={() => navigate('/dashboard')}>
                            <Share2 size={18} />
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
                                    {activities.map((activity) => (
                                        <Pressable
                                            key={activity.id}
                                            className="activity-row"
                                            onClick={() => navigate(`/activity/${activity.id}`)}
                                        >
                                            <div className={getActivityIconClass(activity.type)}>
                                                {getActivityIcon(activity.type)}
                                            </div>
                                            <div className="activity-info">
                                                <div className="activity-row-title">{getActivityTitle(activity.type)}</div>
                                                <div className="activity-row-meta">{activity.time} - {activity.name}</div>
                                            </div>
                                            <div className="activity-amount-col">
                                                <span className={`activity-amount ${activity.type === 'cancelled' ? 'cancelled' : ''}`}>
                                                    {activity.type === 'cancelled' ? '-' : '+'}${activity.amount}
                                                </span>
                                                <span className="activity-tier">{activity.tier}</span>
                                            </div>
                                        </Pressable>
                                    ))}
                                </div>
                            </div>
                        ))}

                        {/* Monthly Summary */}
                        <div className="summary-card">
                            <span className="summary-title">This Month</span>
                            <div className="summary-grid">
                                <div className="summary-stat">
                                    <span className="summary-value">8</span>
                                    <span className="summary-label">New Subs</span>
                                </div>
                                <div className="summary-stat">
                                    <span className="summary-value positive">+$145</span>
                                    <span className="summary-label">Revenue</span>
                                </div>
                                <div className="summary-stat">
                                    <span className="summary-value negative">2</span>
                                    <span className="summary-label">Cancelled</span>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}
