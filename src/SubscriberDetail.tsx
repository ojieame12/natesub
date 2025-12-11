import { useState } from 'react'
import { useParams } from 'react-router-dom'
import {
    ArrowLeft,
    Mail,
    MessageSquare,
    Send,
    Calendar,
    DollarSign,
    Clock,
    TrendingUp,
    MoreHorizontal,
    UserX,
    Gift,
    ChevronRight,
} from 'lucide-react'
import { Pressable } from './components'
import { useViewTransition } from './hooks'
import './SubscriberDetail.css'

// Mock subscriber data (would come from API)
const subscribersData: Record<string, {
    id: number
    name: string
    username: string
    email: string
    tier: string
    amount: number
    status: 'active' | 'cancelled'
    since: string
    nextBilling: string
    lifetimeValue: number
    totalPayments: number
    avatar: string | null
    payments: { id: number; date: string; amount: number; status: string }[]
}> = {
    '1': {
        id: 1,
        name: 'Sarah K.',
        username: 'sarahk',
        email: 'sarah.k@email.com',
        tier: 'Supporter',
        amount: 10,
        status: 'active',
        since: 'Jan 15, 2025',
        nextBilling: 'Feb 15, 2025',
        lifetimeValue: 30,
        totalPayments: 3,
        avatar: null,
        payments: [
            { id: 1, date: 'Jan 15, 2025', amount: 10, status: 'paid' },
            { id: 2, date: 'Dec 15, 2024', amount: 10, status: 'paid' },
            { id: 3, date: 'Nov 15, 2024', amount: 10, status: 'paid' },
        ],
    },
    '2': {
        id: 2,
        name: 'James T.',
        username: 'jamest',
        email: 'james.t@gmail.com',
        tier: 'VIP',
        amount: 25,
        status: 'active',
        since: 'Dec 1, 2024',
        nextBilling: 'Feb 1, 2025',
        lifetimeValue: 75,
        totalPayments: 3,
        avatar: null,
        payments: [
            { id: 1, date: 'Jan 1, 2025', amount: 25, status: 'paid' },
            { id: 2, date: 'Dec 1, 2024', amount: 25, status: 'paid' },
            { id: 3, date: 'Nov 1, 2024', amount: 25, status: 'paid' },
        ],
    },
    '3': {
        id: 3,
        name: 'Mike R.',
        username: 'miker',
        email: 'mike.r@work.com',
        tier: 'Fan',
        amount: 5,
        status: 'active',
        since: 'Feb 1, 2025',
        nextBilling: 'Mar 1, 2025',
        lifetimeValue: 5,
        totalPayments: 1,
        avatar: null,
        payments: [
            { id: 1, date: 'Feb 1, 2025', amount: 5, status: 'paid' },
        ],
    },
    '4': {
        id: 4,
        name: 'Lisa M.',
        username: 'lisam',
        email: 'lisa.m@email.com',
        tier: 'Supporter',
        amount: 10,
        status: 'cancelled',
        since: 'Nov 1, 2024',
        nextBilling: '-',
        lifetimeValue: 20,
        totalPayments: 2,
        avatar: null,
        payments: [
            { id: 1, date: 'Dec 1, 2024', amount: 10, status: 'paid' },
            { id: 2, date: 'Nov 1, 2024', amount: 10, status: 'paid' },
        ],
    },
    '5': {
        id: 5,
        name: 'Alex P.',
        username: 'alexp',
        email: 'alex.p@company.com',
        tier: 'VIP',
        amount: 25,
        status: 'active',
        since: 'Jan 10, 2025',
        nextBilling: 'Feb 10, 2025',
        lifetimeValue: 25,
        totalPayments: 1,
        avatar: null,
        payments: [
            { id: 1, date: 'Jan 10, 2025', amount: 25, status: 'paid' },
        ],
    },
    '6': {
        id: 6,
        name: 'Emma W.',
        username: 'emmaw',
        email: 'emma.w@email.com',
        tier: 'Fan',
        amount: 5,
        status: 'active',
        since: 'Mar 1, 2025',
        nextBilling: 'Apr 1, 2025',
        lifetimeValue: 5,
        totalPayments: 1,
        avatar: null,
        payments: [
            { id: 1, date: 'Mar 1, 2025', amount: 5, status: 'paid' },
        ],
    },
}


export default function SubscriberDetail() {
    const { navigate, goBack } = useViewTransition()
    const { id } = useParams()
    const [showActions, setShowActions] = useState(false)
    const [showCancelConfirm, setShowCancelConfirm] = useState(false)

    const subscriber = id ? subscribersData[id] : null

    if (!subscriber) {
        return (
            <div className="subscriber-detail-page">
                <header className="subscriber-detail-header">
                    <Pressable className="back-btn" onClick={() => goBack({ type: 'zoom-out' })}>
                        <ArrowLeft size={20} />
                    </Pressable>
                    <span className="subscriber-detail-title">Subscriber</span>
                    <div className="header-spacer" />
                </header>
                <div className="subscriber-empty">
                    <p>Subscriber not found</p>
                </div>
            </div>
        )
    }

    const isActive = subscriber.status === 'active'

    return (
        <div className="subscriber-detail-page">
            {/* Header */}
            <header className="subscriber-detail-header">
                <Pressable className="back-btn" onClick={() => goBack({ type: 'zoom-out' })}>
                    <ArrowLeft size={20} />
                </Pressable>
                <span className="subscriber-detail-title">Subscriber</span>
                <Pressable className="more-btn" onClick={() => setShowActions(true)}>
                    <MoreHorizontal size={20} />
                </Pressable>
            </header>

            <div className="subscriber-detail-content">
                {/* Profile Card */}
                <section className="subscriber-profile-card">
                    <div
                        className="subscriber-avatar-large"
                        style={{ viewTransitionName: `avatar-${id}` } as React.CSSProperties}
                    >
                        {subscriber.name.charAt(0)}
                    </div>
                    <h1 className="subscriber-name-large">{subscriber.name}</h1>
                    <span className="subscriber-username-large">@{subscriber.username}</span>

                    <div className="subscriber-status-row">
                        <span className={`subscriber-status-badge ${subscriber.status}`}>
                            {isActive ? 'Active' : 'Cancelled'}
                        </span>
                        <span className="subscriber-tier-badge">{subscriber.tier}</span>
                    </div>

                    {/* Quick Actions */}
                    <div className="subscriber-quick-actions">
                        <Pressable className="quick-action-btn">
                            <Mail size={18} />
                            <span>Email</span>
                        </Pressable>
                        <Pressable className="quick-action-btn">
                            <MessageSquare size={18} />
                            <span>Message</span>
                        </Pressable>
                        <Pressable
                            className="quick-action-btn"
                            onClick={() => navigate('/request/new')}
                        >
                            <Send size={18} />
                            <span>Request</span>
                        </Pressable>
                        <Pressable className="quick-action-btn">
                            <Gift size={18} />
                            <span>Gift</span>
                        </Pressable>
                    </div>
                </section>

                {/* Subscription Info */}
                <section className="subscriber-section">
                    <h3 className="section-title">Subscription</h3>
                    <div className="info-card">
                        <div className="info-row">
                            <div className="info-icon">
                                <DollarSign size={18} />
                            </div>
                            <div className="info-content">
                                <span className="info-label">Amount</span>
                                <span className="info-value">${subscriber.amount}/month</span>
                            </div>
                        </div>
                        <div className="info-row">
                            <div className="info-icon">
                                <Calendar size={18} />
                            </div>
                            <div className="info-content">
                                <span className="info-label">Subscribed since</span>
                                <span className="info-value">{subscriber.since}</span>
                            </div>
                        </div>
                        {isActive && (
                            <div className="info-row">
                                <div className="info-icon">
                                    <Clock size={18} />
                                </div>
                                <div className="info-content">
                                    <span className="info-label">Next billing</span>
                                    <span className="info-value">{subscriber.nextBilling}</span>
                                </div>
                            </div>
                        )}
                        <div className="info-row">
                            <div className="info-icon">
                                <TrendingUp size={18} />
                            </div>
                            <div className="info-content">
                                <span className="info-label">Lifetime value</span>
                                <span className="info-value highlight">${subscriber.lifetimeValue}</span>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Contact Info */}
                <section className="subscriber-section">
                    <h3 className="section-title">Contact</h3>
                    <div className="info-card">
                        <Pressable className="info-row clickable">
                            <div className="info-icon">
                                <Mail size={18} />
                            </div>
                            <div className="info-content">
                                <span className="info-label">Email</span>
                                <span className="info-value">{subscriber.email}</span>
                            </div>
                            <ChevronRight size={18} className="info-chevron" />
                        </Pressable>
                    </div>
                </section>

                {/* Payment History */}
                <section className="subscriber-section">
                    <h3 className="section-title">Payment History</h3>
                    <div className="info-card">
                        {subscriber.payments.map((payment, index) => (
                            <div key={payment.id} className={`payment-row ${index < subscriber.payments.length - 1 ? 'has-border' : ''}`}>
                                <div className="payment-info">
                                    <span className="payment-date">{payment.date}</span>
                                    <span className="payment-status">{payment.status}</span>
                                </div>
                                <span className="payment-amount">${payment.amount}</span>
                            </div>
                        ))}
                    </div>
                    <Pressable className="view-all-link">
                        View all {subscriber.totalPayments} payments
                    </Pressable>
                </section>

                {/* Danger Zone */}
                {isActive && (
                    <section className="subscriber-section">
                        <Pressable
                            className="cancel-btn"
                            onClick={() => setShowCancelConfirm(true)}
                        >
                            <UserX size={18} />
                            <span>Cancel Subscription</span>
                        </Pressable>
                    </section>
                )}
            </div>

            {/* Actions Bottom Sheet */}
            {showActions && (
                <>
                    <div className="modal-overlay" onClick={() => setShowActions(false)} />
                    <div className="actions-sheet">
                        <div className="sheet-handle" />
                        <Pressable className="sheet-action">
                            <Mail size={20} />
                            <span>Send Email</span>
                        </Pressable>
                        <Pressable className="sheet-action">
                            <MessageSquare size={20} />
                            <span>Send Message</span>
                        </Pressable>
                        <Pressable className="sheet-action" onClick={() => { setShowActions(false); navigate('/request/new'); }}>
                            <Send size={20} />
                            <span>Send Request</span>
                        </Pressable>
                        <Pressable className="sheet-action">
                            <Gift size={20} />
                            <span>Send Gift</span>
                        </Pressable>
                        {isActive && (
                            <Pressable
                                className="sheet-action danger"
                                onClick={() => { setShowActions(false); setShowCancelConfirm(true); }}
                            >
                                <UserX size={20} />
                                <span>Cancel Subscription</span>
                            </Pressable>
                        )}
                        <Pressable className="sheet-cancel" onClick={() => setShowActions(false)}>
                            Cancel
                        </Pressable>
                    </div>
                </>
            )}

            {/* Cancel Confirmation Modal */}
            {showCancelConfirm && (
                <>
                    <div className="modal-overlay" onClick={() => setShowCancelConfirm(false)} />
                    <div className="confirm-modal">
                        <h3 className="modal-title">Cancel Subscription?</h3>
                        <p className="modal-text">
                            This will cancel {subscriber.name}'s subscription immediately.
                            They will lose access to all subscriber perks.
                        </p>
                        <div className="modal-actions">
                            <Pressable
                                className="modal-btn secondary"
                                onClick={() => setShowCancelConfirm(false)}
                            >
                                Keep Active
                            </Pressable>
                            <Pressable className="modal-btn danger">
                                Cancel Subscription
                            </Pressable>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
