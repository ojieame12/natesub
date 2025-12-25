import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Check, Crown, Sparkles, Zap, AlertCircle } from 'lucide-react'
import { Pressable, useToast, LoadingButton } from './components'
import { useBillingStatus, useCreateBillingCheckout, useCreateBillingPortal } from './api/hooks'
import './Billing.css'

// Calculate days remaining in trial
function getDaysRemaining(trialEndsAt: string | null): number {
    if (!trialEndsAt) return 0
    const now = new Date()
    const end = new Date(trialEndsAt)
    const diff = end.getTime() - now.getTime()
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

// Format trial end date
function formatTrialEnd(trialEndsAt: string | null): string {
    if (!trialEndsAt) return ''
    return new Date(trialEndsAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
    })
}

export default function Billing() {
    const navigate = useNavigate()
    const [searchParams, setSearchParams] = useSearchParams()
    const toast = useToast()
    const { data: billingData, isLoading, isError, refetch } = useBillingStatus()
    const { mutate: createCheckout, isPending: isCheckoutLoading } = useCreateBillingCheckout()
    const { mutate: createPortal, isPending: isPortalLoading } = useCreateBillingPortal()

    // Handle success redirect from Stripe checkout
    useEffect(() => {
        if (searchParams.get('success') === 'true') {
            toast.success('Your free trial has started!')
            // Remove query param and refetch status
            setSearchParams({})
            refetch()
        }
    }, [searchParams, setSearchParams, toast, refetch])

    const isService = billingData?.plan === 'service'
    const subscription = billingData?.subscription
    const status = subscription?.status
    const isTrialing = status === 'trialing'
    const isActive = status === 'active'
    const isPastDue = status === 'past_due'
    const hasSubscription = subscription?.subscriptionId != null

    const daysRemaining = getDaysRemaining(subscription?.trialEndsAt || null)
    const trialProgress = isTrialing ? Math.max(0, Math.min(100, ((60 - daysRemaining) / 60) * 100)) : 0

    const handleStartTrial = () => {
        createCheckout()
    }

    const handleManageSubscription = () => {
        createPortal()
    }

    if (isLoading) {
        return (
            <div className="billing-page">
                <header className="billing-header">
                    <Pressable className="back-btn" onClick={() => navigate(-1)}>
                        <ArrowLeft size={20} />
                    </Pressable>
                    <img src="/logo.svg" alt="NatePay" className="header-logo" />
                    <div className="header-spacer" />
                </header>
                <div className="billing-content">
                    <div className="billing-loading">Loading...</div>
                </div>
            </div>
        )
    }

    if (isError) {
        return (
            <div className="billing-page">
                <header className="billing-header">
                    <Pressable className="back-btn" onClick={() => navigate(-1)}>
                        <ArrowLeft size={20} />
                    </Pressable>
                    <img src="/logo.svg" alt="NatePay" className="header-logo" />
                    <div className="header-spacer" />
                </header>
                <div className="billing-content">
                    <div className="billing-error">
                        <AlertCircle size={32} />
                        <h2>Unable to load billing</h2>
                        <p>Please check your connection and try again.</p>
                        <Pressable className="billing-retry-btn" onClick={() => refetch()}>
                            Try Again
                        </Pressable>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="billing-page">
            {/* Header */}
            <header className="billing-header">
                <Pressable className="back-btn" onClick={() => navigate(-1)}>
                    <ArrowLeft size={20} />
                </Pressable>
                <img src="/logo.svg" alt="NatePay" className="header-logo" />
                <div className="header-spacer" />
            </header>

            <div className="billing-content">
                {isService ? (
                    // SERVICE BRANCH - $5/mo subscription
                    <>
                        {/* Current Status Card */}
                        <div className={`billing-status-card ${isTrialing ? 'trialing' : isActive ? 'active' : isPastDue ? 'past-due' : ''}`}>
                            {isTrialing ? (
                                <>
                                    <div className="billing-status-icon trialing">
                                        <Sparkles size={24} />
                                    </div>
                                    <div className="billing-status-info">
                                        <span className="billing-status-label">Free Trial</span>
                                        <span className="billing-status-detail">
                                            {daysRemaining} days left · Ends {formatTrialEnd(subscription?.trialEndsAt || null)}
                                        </span>
                                    </div>
                                    <div className="trial-progress-ring">
                                        <svg viewBox="0 0 36 36">
                                            <path
                                                className="trial-progress-bg"
                                                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                            />
                                            <path
                                                className="trial-progress-fill"
                                                strokeDasharray={`${trialProgress}, 100`}
                                                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                                            />
                                        </svg>
                                        <span className="trial-days">{daysRemaining}</span>
                                    </div>
                                </>
                            ) : isActive ? (
                                <>
                                    <div className="billing-status-icon active">
                                        <Crown size={24} />
                                    </div>
                                    <div className="billing-status-info">
                                        <span className="billing-status-label">Service Plan</span>
                                        <span className="billing-status-detail">
                                            $5/month · {subscription?.cancelAtPeriodEnd ? 'Cancels' : 'Renews'} {subscription?.currentPeriodEnd
                                                ? new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                                : 'soon'}
                                        </span>
                                    </div>
                                    <div className="billing-status-badge active">Active</div>
                                </>
                            ) : isPastDue ? (
                                <>
                                    <div className="billing-status-icon past-due">
                                        <AlertCircle size={24} />
                                    </div>
                                    <div className="billing-status-info">
                                        <span className="billing-status-label">Payment Failed</span>
                                        <span className="billing-status-detail">Update your payment method</span>
                                    </div>
                                    <div className="billing-status-badge past-due">Past Due</div>
                                </>
                            ) : !hasSubscription ? (
                                <>
                                    <div className="billing-status-icon inactive">
                                        <Sparkles size={24} />
                                    </div>
                                    <div className="billing-status-info">
                                        <span className="billing-status-label">Start Your Free Trial</span>
                                        <span className="billing-status-detail">First 2 months free, then $5/month</span>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="billing-status-icon inactive">
                                        <Sparkles size={24} />
                                    </div>
                                    <div className="billing-status-info">
                                        <span className="billing-status-label">Subscription Ended</span>
                                        <span className="billing-status-detail">Resubscribe to access pro features</span>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Trial Banner for trialing users */}
                        {isTrialing && (
                            <div className="trial-banner">
                                <div className="trial-progress">
                                    <div className="trial-progress-bar" style={{ width: `${trialProgress}%` }} />
                                </div>
                                <p className="trial-text">
                                    Enjoying your trial? Your card won't be charged until {formatTrialEnd(subscription?.trialEndsAt || null)}.
                                </p>
                            </div>
                        )}

                        {/* Past Due Warning */}
                        {isPastDue && (
                            <div className="past-due-banner">
                                <AlertCircle size={18} />
                                <span>Update your payment method to continue using Service features.</span>
                            </div>
                        )}

                        {/* Plan Card */}
                        <div className="billing-plan-card service">
                            <div className="billing-plan-header">
                                <div className="billing-plan-badge">
                                    <Sparkles size={14} />
                                    <span>Service Plan</span>
                                </div>
                                {!hasSubscription && (
                                    <span className="billing-trial-badge">First 2 months free</span>
                                )}
                            </div>
                            <div className="billing-plan-price">
                                <span className="billing-price-amount">$5</span>
                                <span className="billing-price-period">/month</span>
                            </div>
                            <p className="billing-plan-desc">
                                Professional tools for service providers
                            </p>
                        </div>

                        {/* What's Included - Service */}
                        <section className="billing-section">
                            <h3 className="section-title">What's Included</h3>
                            <div className="plan-features">
                                <div className="plan-feature">
                                    <Check size={16} />
                                    <span>AI-generated page content</span>
                                </div>
                                <div className="plan-feature">
                                    <Check size={16} />
                                    <span>Payroll documents with PDF</span>
                                </div>
                                <div className="plan-feature">
                                    <Check size={16} />
                                    <span>Income verification for loans</span>
                                </div>
                                <div className="plan-feature">
                                    <Check size={16} />
                                    <span>Professional client management</span>
                                </div>
                            </div>
                        </section>

                        {/* Action Button */}
                        {!hasSubscription ? (
                            <LoadingButton
                                className="billing-cta-btn"
                                onClick={handleStartTrial}
                                loading={isCheckoutLoading}
                                fullWidth
                            >
                                Start Free Trial
                            </LoadingButton>
                        ) : (
                            <LoadingButton
                                className="billing-manage-btn"
                                onClick={handleManageSubscription}
                                loading={isPortalLoading}
                                variant="secondary"
                                fullWidth
                            >
                                Manage Subscription
                            </LoadingButton>
                        )}

                        <p className="billing-footer-note">
                            {!hasSubscription
                                ? 'You won\'t be charged until your trial ends. Cancel anytime.'
                                : 'Cancel anytime. Your subscription helps us build better tools for service providers.'}
                        </p>
                    </>
                ) : (
                    // PERSONAL BRANCH - Free
                    <>
                        <div className="billing-plan-card personal">
                            <div className="billing-plan-badge free">
                                <Zap size={14} />
                                <span>Free Plan</span>
                            </div>
                            <div className="billing-plan-price">
                                <span className="billing-price-amount">$0</span>
                                <span className="billing-price-period">/month</span>
                            </div>
                            <p className="billing-plan-desc">
                                No monthly fee. Pay only when you earn.
                            </p>
                        </div>

                        {/* What's Included - Personal */}
                        <section className="billing-section">
                            <h3 className="section-title">What's Included</h3>
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
                                    <span>Payment processing</span>
                                </div>
                                <div className="plan-feature">
                                    <Check size={16} />
                                    <span>Activity tracking</span>
                                </div>
                            </div>
                        </section>
                    </>
                )}
            </div>
        </div>
    )
}
