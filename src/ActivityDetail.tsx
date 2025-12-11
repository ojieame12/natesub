import { useNavigate, useParams } from 'react-router-dom'
import {
    ChevronLeft,
    UserPlus,
    DollarSign,
    RefreshCw,
    UserX,
    Download,
    MessageCircle,
    XCircle,
} from 'lucide-react'
import { Pressable, useToast } from './components'
import './ActivityDetail.css'

// Enhanced mock activity data with customer info
const activityData = [
    {
        id: 1,
        type: 'new_subscriber',
        name: 'Sarah K.',
        email: 'sarah.k@email.com',
        amount: 10,
        time: '10:45 AM',
        tier: 'Supporter',
        date: 'Dec 10, 2025',
        transactionId: 'TXN_8X29D4K9',
        paymentMethod: { type: 'card', brand: 'Visa', last4: '4242' },
        subscription: { status: 'active', nextBilling: 'Jan 10, 2026', lifetimeValue: 10, monthsSubscribed: 1 }
    },
    {
        id: 2,
        type: 'payment',
        name: 'James T.',
        email: 'james.t@email.com',
        amount: 25,
        time: '9:30 AM',
        tier: 'VIP',
        date: 'Dec 10, 2025',
        transactionId: 'TXN_7Y38C3J8',
        paymentMethod: { type: 'card', brand: 'Mastercard', last4: '8888' },
        subscription: { status: 'active', nextBilling: 'Jan 10, 2026', lifetimeValue: 175, monthsSubscribed: 7 }
    },
    {
        id: 3,
        type: 'new_subscriber',
        name: 'Mike R.',
        email: 'mike.r@email.com',
        amount: 5,
        time: '8:15 AM',
        tier: 'Fan',
        date: 'Dec 10, 2025',
        transactionId: 'TXN_6Z47B2H7',
        paymentMethod: { type: 'card', brand: 'Visa', last4: '1234' },
        subscription: { status: 'active', nextBilling: 'Jan 10, 2026', lifetimeValue: 5, monthsSubscribed: 1 }
    },
    {
        id: 4,
        type: 'renewal',
        name: 'Lisa M.',
        email: 'lisa.m@email.com',
        amount: 10,
        time: '5:30 PM',
        tier: 'Supporter',
        date: 'Dec 9, 2025',
        transactionId: 'TXN_5A56A1G6',
        paymentMethod: { type: 'card', brand: 'Amex', last4: '9999' },
        subscription: { status: 'active', nextBilling: 'Jan 9, 2026', lifetimeValue: 120, monthsSubscribed: 12 }
    },
    {
        id: 5,
        type: 'cancelled',
        name: 'Tom H.',
        email: 'tom.h@email.com',
        amount: 5,
        time: '2:15 PM',
        tier: 'Fan',
        date: 'Dec 9, 2025',
        transactionId: 'TXN_4B65Z0F5',
        paymentMethod: { type: 'card', brand: 'Visa', last4: '5555' },
        subscription: { status: 'cancelled', lifetimeValue: 15, monthsSubscribed: 3 }
    },
]

const getActivityIcon = (type: string) => {
    switch (type) {
        case 'new_subscriber': return <UserPlus size={36} />
        case 'payment': return <DollarSign size={36} />
        case 'renewal': return <RefreshCw size={36} />
        case 'cancelled': return <UserX size={36} />
        default: return <DollarSign size={36} />
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

export default function ActivityDetail() {
    const navigate = useNavigate()
    const toast = useToast()
    const { id } = useParams()

    const activity = activityData.find(a => a.id === Number(id))

    const handleDownloadReceipt = () => {
        toast.info('Receipt download coming soon')
    }

    const handleMessage = () => {
        toast.info('Messaging coming soon')
    }

    const handleCancel = () => {
        toast.info('Cancel subscription coming soon')
    }

    if (!activity) {
        return (
            <div className="detail-page">
                <header className="detail-header">
                    <Pressable className="back-btn" onClick={() => navigate(-1)}>
                        <ChevronLeft size={24} />
                    </Pressable>
                </header>
                <div className="detail-empty">
                    <span>Activity not found</span>
                </div>
            </div>
        )
    }

    const isNegative = activity.type === 'cancelled'
    const isCancelled = activity.type === 'cancelled'

    return (
        <div className="detail-page">
            {/* Header */}
            <header className="detail-header">
                <Pressable className="back-btn" onClick={() => navigate(-1)}>
                    <ChevronLeft size={24} />
                </Pressable>
            </header>

            {/* Hero */}
            <div className="detail-hero">
                <div className={`detail-icon ${isNegative ? 'negative' : ''}`}>
                    {getActivityIcon(activity.type)}
                </div>
                <div className="detail-amount">
                    {isNegative ? '-' : '+'}${activity.amount}
                    <span className="cents">.00</span>
                </div>
                <span className="detail-badge">{getActivityTitle(activity.type)}</span>
            </div>

            <div className="detail-content">
                {/* Customer Card */}
                <div className="detail-card">
                    <div className="detail-card-title">Customer</div>
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
                        <span className="detail-value">${activity.amount}.00/mo</span>
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
                        <div className="detail-card-title">Subscription</div>
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
                            <span className="detail-label">Lifetime Value</span>
                            <span className="detail-value">${activity.subscription.lifetimeValue}</span>
                        </div>
                        <div className="detail-row">
                            <span className="detail-label">Months Subscribed</span>
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
