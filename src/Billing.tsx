import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CreditCard, Plus, ChevronRight, Check, Calendar, Receipt, AlertCircle, Sparkles } from 'lucide-react'
import { Pressable, useToast, Skeleton, SkeletonList } from './components'
import './Billing.css'

// Mock data
const subscriptionData = {
    status: 'trial', // 'trial' | 'active' | 'cancelled' | 'past_due'
    trialDaysRemaining: 23,
    planName: 'NatePay Pro',
    price: 5.00,
    nextBillingDate: 'Jan 15, 2025',
    startDate: 'Dec 15, 2024',
}

const paymentMethod = {
    type: 'card',
    brand: 'Visa',
    last4: '4242',
    expiry: '12/26',
}

const invoiceHistory = [
    { id: 1, date: 'Dec 1, 2024', amount: 5.00, status: 'paid', invoiceUrl: '#' },
    { id: 2, date: 'Nov 1, 2024', amount: 5.00, status: 'paid', invoiceUrl: '#' },
    { id: 3, date: 'Oct 1, 2024', amount: 5.00, status: 'paid', invoiceUrl: '#' },
]

export default function Billing() {
    const navigate = useNavigate()
    const toast = useToast()
    const [isLoading, setIsLoading] = useState(true)
    const [showCancelConfirm, setShowCancelConfirm] = useState(false)

    // Simulate initial data load
    useEffect(() => {
        const timer = setTimeout(() => setIsLoading(false), 500)
        return () => clearTimeout(timer)
    }, [])

    const isTrialActive = subscriptionData.status === 'trial'
    const isPastDue = subscriptionData.status === 'past_due'

    const handleUpdatePayment = () => {
        toast.info('Payment update coming soon')
    }

    const handleViewInvoice = () => {
        toast.info('Invoice download coming soon')
    }

    const handleViewAllInvoices = () => {
        toast.info('All invoices coming soon')
    }

    const handleConfirmCancel = () => {
        toast.success('Subscription cancelled')
        setShowCancelConfirm(false)
    }

    const getStatusBadge = () => {
        switch (subscriptionData.status) {
            case 'trial':
                return <span className="billing-status-badge trial">Free Trial</span>
            case 'active':
                return <span className="billing-status-badge active">Active</span>
            case 'cancelled':
                return <span className="billing-status-badge cancelled">Cancelled</span>
            case 'past_due':
                return <span className="billing-status-badge past-due">Past Due</span>
            default:
                return null
        }
    }

    return (
        <div className="billing-page">
            {/* Header */}
            <header className="billing-header">
                <Pressable className="back-btn" onClick={() => navigate(-1)}>
                    <ArrowLeft size={20} />
                </Pressable>
                <span className="billing-title">Billing</span>
                <div className="header-spacer" />
            </header>

            <div className="billing-content">
                {isLoading ? (
                    <>
                        <section className="plan-card">
                            <div className="plan-header">
                                <div className="plan-info">
                                    <Skeleton width={120} height={20} />
                                    <Skeleton width={80} height={32} style={{ marginTop: 8 }} />
                                </div>
                            </div>
                            <Skeleton width="100%" height={40} style={{ marginTop: 16 }} />
                        </section>
                        <section className="billing-section">
                            <Skeleton width={140} height={16} style={{ marginBottom: 12 }} />
                            <SkeletonList count={1} />
                        </section>
                        <section className="billing-section">
                            <Skeleton width={120} height={16} style={{ marginBottom: 12 }} />
                            <SkeletonList count={3} />
                        </section>
                    </>
                ) : (
                    <>
                {/* Plan Status Card */}
                <section className="plan-card">
                    <div className="plan-header">
                        <div className="plan-info">
                            <div className="plan-name-row">
                                <span className="plan-name">{subscriptionData.planName}</span>
                                {getStatusBadge()}
                            </div>
                            <span className="plan-price">
                                ${subscriptionData.price.toFixed(2)}<span className="plan-period">/month</span>
                            </span>
                        </div>
                        <div className="plan-icon">
                            <Sparkles size={24} />
                        </div>
                    </div>

                    {isTrialActive && (
                        <div className="trial-banner">
                            <div className="trial-progress">
                                <div
                                    className="trial-progress-bar"
                                    style={{ width: `${((30 - subscriptionData.trialDaysRemaining) / 30) * 100}%` }}
                                />
                            </div>
                            <span className="trial-text">
                                {subscriptionData.trialDaysRemaining} days left in your free trial
                            </span>
                        </div>
                    )}

                    {isPastDue && (
                        <div className="past-due-banner">
                            <AlertCircle size={18} />
                            <span>Payment failed. Please update your payment method.</span>
                        </div>
                    )}

                    <div className="plan-details">
                        <div className="plan-detail-row">
                            <Calendar size={16} />
                            <span className="plan-detail-label">
                                {isTrialActive ? 'Trial ends' : 'Next billing date'}
                            </span>
                            <span className="plan-detail-value">{subscriptionData.nextBillingDate}</span>
                        </div>
                    </div>

                    <div className="plan-features">
                        <div className="plan-feature">
                            <Check size={16} />
                            <span>Unlimited subscribers</span>
                        </div>
                        <div className="plan-feature">
                            <Check size={16} />
                            <span>Custom subscription page</span>
                        </div>
                        <div className="plan-feature">
                            <Check size={16} />
                            <span>Voice note requests</span>
                        </div>
                        <div className="plan-feature">
                            <Check size={16} />
                            <span>Analytics dashboard</span>
                        </div>
                    </div>
                </section>

                {/* Payment Method */}
                <section className="billing-section">
                    <h3 className="section-title">Payment Method</h3>
                    <p className="section-subtitle">For your NatePay subscription</p>

                    {paymentMethod ? (
                        <div className="payment-card">
                            <Pressable className="payment-method-row">
                                <div className="payment-method-icon">
                                    <CreditCard size={20} />
                                </div>
                                <div className="payment-method-info">
                                    <span className="payment-method-name">
                                        {paymentMethod.brand} ••••{paymentMethod.last4}
                                    </span>
                                    <span className="payment-method-expiry">
                                        Expires {paymentMethod.expiry}
                                    </span>
                                </div>
                                <ChevronRight size={18} className="payment-chevron" />
                            </Pressable>
                        </div>
                    ) : (
                        <Pressable className="add-payment-btn">
                            <Plus size={18} />
                            <span>Add Payment Method</span>
                        </Pressable>
                    )}

                    <Pressable className="update-payment-link" onClick={handleUpdatePayment}>
                        Update payment method
                    </Pressable>
                </section>

                {/* Invoice History */}
                <section className="billing-section">
                    <h3 className="section-title">Invoice History</h3>
                    <div className="invoice-card">
                        {invoiceHistory.map((invoice) => (
                            <Pressable key={invoice.id} className="invoice-row" onClick={handleViewInvoice}>
                                <div className="invoice-icon">
                                    <Receipt size={18} />
                                </div>
                                <div className="invoice-info">
                                    <span className="invoice-date">{invoice.date}</span>
                                    <span className="invoice-amount">${invoice.amount.toFixed(2)}</span>
                                </div>
                                <span className={`invoice-status ${invoice.status}`}>
                                    {invoice.status === 'paid' ? 'Paid' : 'Pending'}
                                </span>
                                <ChevronRight size={18} className="invoice-chevron" />
                            </Pressable>
                        ))}
                    </div>
                    <Pressable className="view-all-invoices" onClick={handleViewAllInvoices}>
                        View all invoices
                    </Pressable>
                </section>

                {/* Cancel Subscription */}
                <section className="billing-section">
                    <h3 className="section-title">Manage Subscription</h3>
                    <div className="manage-card">
                        <Pressable
                            className="cancel-subscription-btn"
                            onClick={() => setShowCancelConfirm(true)}
                        >
                            <span>Cancel Subscription</span>
                        </Pressable>
                        <p className="cancel-note">
                            You can cancel anytime. Your page will remain active until the end of your billing period.
                        </p>
                    </div>
                </section>

                {/* Fee Breakdown */}
                <section className="fee-info">
                    <h4 className="fee-title">How NatePay works</h4>
                    <div className="fee-row">
                        <span>Platform fee</span>
                        <span>$5/month</span>
                    </div>
                    <div className="fee-row">
                        <span>Transaction fee</span>
                        <span>6% + Stripe 2%</span>
                    </div>
                    <p className="fee-note">
                        You keep 92% of every payment from your subscribers.
                    </p>
                </section>
                    </>
                )}
            </div>

            {/* Cancel Confirmation Modal */}
            {showCancelConfirm && (
                <>
                    <div className="modal-overlay" onClick={() => setShowCancelConfirm(false)} />
                    <div className="cancel-modal">
                        <h3 className="modal-title">Cancel Subscription?</h3>
                        <p className="modal-text">
                            Your subscription will remain active until {subscriptionData.nextBillingDate}.
                            After that, you won't be able to receive new subscribers.
                        </p>
                        <div className="modal-actions">
                            <Pressable
                                className="modal-btn secondary"
                                onClick={() => setShowCancelConfirm(false)}
                            >
                                Keep Subscription
                            </Pressable>
                            <Pressable className="modal-btn danger" onClick={handleConfirmCancel}>
                                Yes, Cancel
                            </Pressable>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
