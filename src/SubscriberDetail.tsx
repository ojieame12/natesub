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
import { Pressable, Skeleton, ErrorState, useToast } from './components'
import { useAuthState, useViewTransition } from './hooks'
import { useSubscription, useCancelSubscription } from './api/hooks'
import { centsToDisplayAmount, getCurrencySymbol, formatCompactNumber } from './utils/currency'
import './SubscriberDetail.css'

// Format date
const formatDate = (date: string | null) => {
    if (!date) return '-'
    return new Date(date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })
}

export default function SubscriberDetail() {
    const { navigate, goBack } = useViewTransition()
    const { id } = useParams()
    const toast = useToast()
    const [showActions, setShowActions] = useState(false)
    const [showCancelConfirm, setShowCancelConfirm] = useState(false)
    const { user } = useAuthState()
    const isService = user?.profile?.purpose === 'service'
    const personLabel = isService ? 'client' : 'subscriber'

    // Fetch subscription from API
    const { data, isLoading, isError, refetch } = useSubscription(id || '')
    const { mutateAsync: cancelSubscription, isPending: isCancelling } = useCancelSubscription()

    const subscription = data?.subscription
    const payments = subscription?.payments || []

    const handleCancel = async () => {
        try {
            await cancelSubscription({ id: id || '', immediate: true })
            toast.success('Subscription cancelled')
            setShowCancelConfirm(false)
            setShowActions(false)
        } catch (err) {
            toast.error('Failed to cancel subscription')
            console.error(err)
        }
    }

    // Map API data to UI format
    const subscriber = subscription ? {
        id: subscription.id,
        name: subscription.subscriber?.displayName || subscription.subscriber?.email || 'Unknown',
        username: subscription.subscriber?.email?.split('@')[0] || '',
        email: subscription.subscriber?.email || '',
        tier: subscription.tierName || 'Supporter',
        amount: subscription.amount || 0, // Backend sends dollars
        currency: subscription.currency || 'USD',
        status: subscription.status as 'active' | 'cancelled',
        since: formatDate(subscription.startedAt),
        nextBilling: formatDate(subscription.currentPeriodEnd),
        lifetimeValue: centsToDisplayAmount(subscription.ltvCents || 0, subscription.currency || 'USD'),
        totalPayments: payments.length,
        avatar: subscription.subscriber?.avatarUrl || null,
    } : null

    // Loading state
    if (isLoading) {
        return (
            <div className="subscriber-detail-page">
                <header className="subscriber-detail-header">
                    <Pressable className="back-btn" onClick={() => goBack()}>
                        <ArrowLeft size={20} />
                    </Pressable>
                    <img src="/logo.svg" alt="NatePay" className="header-logo" />
                    <div className="header-spacer" />
                </header>
                <div className="subscriber-detail-content">
                    <section className="subscriber-profile-card">
                        <Skeleton width={80} height={80} borderRadius="50%" />
                        <Skeleton width={120} height={24} style={{ marginTop: 16 }} />
                        <Skeleton width={80} height={16} style={{ marginTop: 8 }} />
                    </section>
                </div>
            </div>
        )
    }

    // Error state
    if (isError) {
        return (
            <div className="subscriber-detail-page">
                <header className="subscriber-detail-header">
                    <Pressable className="back-btn" onClick={() => goBack()}>
                        <ArrowLeft size={20} />
                    </Pressable>
                    <img src="/logo.svg" alt="NatePay" className="header-logo" />
                    <div className="header-spacer" />
                </header>
                <ErrorState
                    title={`Couldn't load ${personLabel}`}
                    message={`We had trouble loading this ${personLabel}'s details.`}
                    onRetry={() => refetch()}
                />
            </div>
        )
    }

    // Not found
    if (!subscriber) {
        return (
            <div className="subscriber-detail-page">
                <header className="subscriber-detail-header">
                    <Pressable className="back-btn" onClick={() => goBack()}>
                        <ArrowLeft size={20} />
                    </Pressable>
                    <img src="/logo.svg" alt="NatePay" className="header-logo" />
                    <div className="header-spacer" />
                </header>
                <div className="subscriber-empty">
                    <p>{isService ? 'Client' : 'Subscriber'} not found</p>
                </div>
            </div>
        )
    }

    const isActive = subscriber.status === 'active'
    const currencySymbol = getCurrencySymbol(subscriber.currency || 'USD')

    return (
        <div className="subscriber-detail-page">
            {/* Header */}
            <header className="subscriber-detail-header">
                <Pressable className="back-btn" onClick={() => goBack()}>
                    <ArrowLeft size={20} />
                </Pressable>
                <img src="/logo.svg" alt="NatePay" className="header-logo" />
                <Pressable className="more-btn" onClick={() => setShowActions(true)}>
                    <MoreHorizontal size={20} />
                </Pressable>
            </header>

            <div className="subscriber-detail-content">
                {/* Profile Card */}
                <section className="subscriber-profile-card">
                    <div
                        className="subscriber-avatar-large"
                        style={{ viewTransitionName: 'avatar-morph' } as React.CSSProperties}
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
                            onClick={() => navigate('/new-request')}
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
                                <span className="info-value">{currencySymbol}{formatCompactNumber(subscriber.amount)}/month</span>
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
                                <span className="info-value highlight">{currencySymbol}{formatCompactNumber(subscriber.lifetimeValue || 0)}</span>
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
                        {payments.length === 0 ? (
                            <div className="payment-row">
                                <span className="payment-info">No payments yet</span>
                            </div>
                        ) : (
                            payments.slice(0, 5).map((payment: any, index: number) => (
                                <div key={payment.id} className={`payment-row ${index < Math.min(payments.length, 5) - 1 ? 'has-border' : ''}`}>
                                    <div className="payment-info">
                                        {/* Backend returns occurredAt (not createdAt) */}
                                        <span className="payment-date">{formatDate(payment.occurredAt)}</span>
                                        <span className="payment-status">{payment.status}</span>
                                    </div>
                                    {/* Backend returns amount already in dollars */}
                                    <span className="payment-amount">{currencySymbol}{formatCompactNumber(payment.amount || 0)}</span>
                                </div>
                            ))
                        )}
                    </div>
                    {payments.length > 5 && (
                        <Pressable className="view-all-link">
                            View all {payments.length} payments
                        </Pressable>
                    )}
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
                        <Pressable className="sheet-action" onClick={() => { setShowActions(false); navigate('/new-request'); }}>
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
                    <div className="modal-overlay" onClick={() => !isCancelling && setShowCancelConfirm(false)} />
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
                                disabled={isCancelling}
                            >
                                Keep Active
                            </Pressable>
                            <Pressable
                                className="modal-btn danger"
                                onClick={handleCancel}
                                disabled={isCancelling}
                            >
                                {isCancelling ? 'Cancelling...' : 'Cancel Subscription'}
                            </Pressable>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
