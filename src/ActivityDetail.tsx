import { useParams } from 'react-router-dom'
import { useSafeBack } from './hooks'
import {
    ChevronLeft,
    UserPlus,
    DollarSign,
    RefreshCw,
    UserX,
    Download,
    MessageCircle,
    XCircle,
    Send,
    Check,
} from 'lucide-react'
import { Pressable, useToast, Skeleton, ErrorState } from './components'
import { useActivityDetail, useCurrentUser } from './api/hooks'
import { getCurrencySymbol } from './utils/currency'
import './ActivityDetail.css'

// Format date
const formatDate = (date: string | null) => {
    if (!date) return '-'
    return new Date(date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })
}

// Format time
const formatTime = (date: string | null) => {
    if (!date) return '-'
    return new Date(date).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    })
}

const getActivityIcon = (type: string) => {
    switch (type) {
        case 'subscription_created':
        case 'new_subscriber': return <UserPlus size={36} />
        case 'payment_received':
        case 'payment': return <DollarSign size={36} />
        case 'renewal': return <RefreshCw size={36} />
        case 'subscription_canceled':
        case 'cancelled': return <UserX size={36} />
        case 'request_sent': return <Send size={36} />
        case 'request_accepted': return <Check size={36} />
        default: return <DollarSign size={36} />
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

export default function ActivityDetail() {
    const goBack = useSafeBack('/activity')
    const toast = useToast()
    const { id } = useParams()
    const { data: userData } = useCurrentUser()
    const currencySymbol = getCurrencySymbol(userData?.profile?.currency || 'USD')
    const isService = userData?.profile?.purpose === 'service'

    // Fetch activity from API
    const { data, isLoading, isError, refetch } = useActivityDetail(id || '')

    const activityData = data?.activity
    const payload = activityData?.payload || {}

    // Map API data to UI format
    const activity = activityData ? {
        id: activityData.id,
        type: activityData.type,
        name: payload.subscriberName || payload.recipientName || 'Unknown',
        email: payload.subscriberEmail || payload.recipientEmail || '',
        amount: (payload.amount || 0) / 100,
        time: formatTime(activityData.createdAt),
        tier: payload.tierName || (isService ? 'Client' : 'Supporter'),
        date: formatDate(activityData.createdAt),
        transactionId: payload.transactionId || payload.paymentId || activityData.id,
        paymentMethod: payload.paymentMethod || null,
        subscription: payload.subscription || null,
    } : null

    const handleDownloadReceipt = () => {
        toast.info('Receipt download coming soon')
    }

    const handleMessage = () => {
        toast.info('Messaging coming soon')
    }

    const handleCancel = () => {
        toast.info('Cancel subscription coming soon')
    }

    // Loading state
    if (isLoading) {
        return (
            <div className="detail-page">
                <header className="detail-header">
                    <Pressable className="back-btn" onClick={() => goBack()}>
                        <ChevronLeft size={24} />
                    </Pressable>
                    <img src="/logo.svg" alt="NatePay" className="header-logo" />
                    <div style={{ width: 36 }} />
                </header>
                <div className="detail-hero">
                    <Skeleton width={72} height={72} borderRadius="50%" />
                    <Skeleton width={100} height={40} style={{ marginTop: 16 }} />
                    <Skeleton width={80} height={24} style={{ marginTop: 8 }} />
                </div>
            </div>
        )
    }

    // Error state
    if (isError) {
        return (
            <div className="detail-page">
                <header className="detail-header">
                    <Pressable className="back-btn" onClick={() => goBack()}>
                        <ChevronLeft size={24} />
                    </Pressable>
                    <img src="/logo.svg" alt="NatePay" className="header-logo" />
                    <div style={{ width: 36 }} />
                </header>
                <ErrorState
                    title="Couldn't load activity"
                    message="We had trouble loading this activity."
                    onRetry={() => refetch()}
                />
            </div>
        )
    }

    // Not found
    if (!activity) {
        return (
            <div className="detail-page">
                <header className="detail-header">
                    <Pressable className="back-btn" onClick={() => goBack()}>
                        <ChevronLeft size={24} />
                    </Pressable>
                    <img src="/logo.svg" alt="NatePay" className="header-logo" />
                    <div style={{ width: 36 }} />
                </header>
                <div className="detail-empty">
                    <span>Activity not found</span>
                </div>
            </div>
        )
    }

    const isNegative = activity.type === 'cancelled' || activity.type === 'subscription_canceled'
    const isCancelled = activity.type === 'cancelled' || activity.type === 'subscription_canceled'

    return (
        <div className="detail-page">
            {/* Header */}
            <header className="detail-header">
                <Pressable className="back-btn" onClick={() => goBack()}>
                    <ChevronLeft size={24} />
                </Pressable>
                <img src="/logo.svg" alt="NatePay" className="header-logo" />
                <div style={{ width: 36 }} />
            </header>

            {/* Hero */}
            <div className="detail-hero">
                <div className={`detail-icon ${isNegative ? 'negative' : ''}`}>
                    {getActivityIcon(activity.type)}
                </div>
                <div className="detail-amount">
                    {isNegative ? '-' : '+'}{currencySymbol}{activity.amount}
                    <span className="cents">.00</span>
                </div>
                <span className="detail-badge">{getActivityTitle(activity.type, isService)}</span>
            </div>

            <div className="detail-content">
                {/* Customer Card */}
                <div className="detail-card">
                    <div className="detail-card-title">{isService ? 'Client' : 'Customer'}</div>
                    <div className="customer-row">
                        <div className="customer-avatar">{activity.name[0]}</div>
                        <div className="customer-info">
                            <div className="customer-name">{activity.name}</div>
                            <div className="customer-email">{activity.email}</div>
                        </div>
                    </div>
                </div>

                {/* Transaction Details */}
                <div className="detail-card">
                    <div className="detail-card-title">Transaction Details</div>
                    <div className="detail-row">
                        <span className="detail-label">Tier</span>
                        <span className="detail-value">{activity.tier}</span>
                    </div>
                    <div className="detail-row">
                        <span className="detail-label">Amount</span>
                        <span className="detail-value">{currencySymbol}{activity.amount}.00/mo</span>
                    </div>
                    <div className="detail-row">
                        <span className="detail-label">Date</span>
                        <span className="detail-value">{activity.date}</span>
                    </div>
                    <div className="detail-row">
                        <span className="detail-label">Time</span>
                        <span className="detail-value">{activity.time}</span>
                    </div>
                    <div className="detail-row">
                        <span className="detail-label">Transaction ID</span>
                        <span className="detail-value mono">#{activity.transactionId}</span>
                    </div>
                    {activity.paymentMethod && (
                        <div className="detail-row">
                            <span className="detail-label">Payment</span>
                            <span className="detail-value">{activity.paymentMethod.brand} ****{activity.paymentMethod.last4}</span>
                        </div>
                    )}
                </div>

                {/* Subscription Info */}
                {activity.subscription && (
                    <div className="detail-card">
                        <div className="detail-card-title">{isService ? 'Retainer' : 'Subscription'}</div>
                        <div className="detail-row">
                            <span className="detail-label">Status</span>
                            <span className={`detail-status ${activity.subscription.status}`}>
                                {activity.subscription.status === 'active' ? 'Active' : 'Cancelled'}
                            </span>
                        </div>
                        {activity.subscription.nextBilling && (
                            <div className="detail-row">
                                <span className="detail-label">Next Billing</span>
                                <span className="detail-value">{activity.subscription.nextBilling}</span>
                            </div>
                        )}
                        <div className="detail-row">
                            <span className="detail-label">{isService ? 'Total Billed' : 'Lifetime Value'}</span>
                            <span className="detail-value">{currencySymbol}{activity.subscription.lifetimeValue}</span>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">{isService ? 'Months as Client' : 'Months Subscribed'}</span>
                            <span className="detail-value">{activity.subscription.monthsSubscribed}</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Actions */}
            <div className="detail-actions">
                <Pressable className="detail-btn primary" onClick={handleDownloadReceipt}>
                    <Download size={18} />
                    <span>Download Receipt</span>
                </Pressable>
                {!isCancelled && (
                    <div className="detail-actions-row">
                        <Pressable className="detail-btn secondary" onClick={handleMessage}>
                            <MessageCircle size={18} />
                            <span>Message</span>
                        </Pressable>
                        <Pressable className="detail-btn danger" onClick={handleCancel}>
                            <XCircle size={18} />
                        </Pressable>
                    </div>
                )}
            </div>
        </div>
    )
}
