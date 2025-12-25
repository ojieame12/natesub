import { useParams } from 'react-router-dom'
import { useEffect, useRef } from 'react'
import { useSafeBack } from './hooks'
import {
    ArrowLeft,
    Download,
    MoreHorizontal,
    Clock,
    CheckCircle,
    Building2,
    XCircle,
    Check,
    AlertTriangle,
    RotateCcw,
    UserPlus,
    UserX,
    DollarSign,
    RefreshCw,
    Send,
    Banknote,
    ShieldAlert,
    ShieldCheck,
    ShieldX,
    Loader2,
    type LucideIcon,
} from 'lucide-react'
import { Pressable, useToast, Skeleton, ErrorState } from './components'
import { useActivityDetail, useCurrentUser } from './api/hooks'
import { centsToDisplayAmount, getCurrencySymbol, formatCompactNumber } from './utils/currency'
import './ActivityDetail.css'

// Payment provider configuration
// Note: Stripe default is T+2 for most accounts (funds available 2 business days after payment)
// Actual timing may vary based on account settings - see Payment Settings for exact schedule
const PROVIDER_CONFIG = {
    stripe: {
        name: 'Stripe',
        color: '#635BFF',
        payoutDays: { min: 2, max: 3 },  // T+2 is typical, T+3 max for most
        payoutText: '2-3 business days',
    },
    paystack: {
        name: 'Paystack',
        color: '#00C3F7',
        payoutDays: { min: 1, max: 1 },
        payoutText: 'Next business day',
    },
}

// Use PayoutInfoResponse from API client
import type { PayoutInfoResponse } from './api/client'

// Payout status steps for timeline
const PAYOUT_STEPS = [
    { key: 'paid', label: 'Paid' },
    { key: 'processing', label: 'Processing' },
    { key: 'deposited', label: 'Deposited' },
]

// Get payout status - use real data when available, estimate otherwise
const getPayoutInfo = (
    provider: string | undefined,
    createdAt: string,
    realPayoutInfo?: PayoutInfoResponse | null
) => {
    // If we have real payout status from Stripe webhooks, use it
    if (realPayoutInfo?.status) {
        switch (realPayoutInfo.status) {
            case 'paid':
                return { status: 'completed', step: 2, label: 'In your bank', icon: CheckCircle }
            case 'in_transit':
                return { status: 'in_transit', step: 1, label: 'On the way', icon: Building2 }
            case 'pending':
                return { status: 'processing', step: 0, label: 'Processing', icon: Clock }
            case 'failed':
                return { status: 'failed', step: -1, label: 'Failed', icon: XCircle }
            default:
                break
        }
    }

    // Fallback: estimate based on payment date and provider payout windows
    const config = PROVIDER_CONFIG[provider as keyof typeof PROVIDER_CONFIG] || PROVIDER_CONFIG.stripe
    const paymentDate = new Date(createdAt)
    const now = new Date()

    // Calculate estimated payout date (add business days)
    const estimatedDate = new Date(paymentDate)
    let daysAdded = 0
    const targetDays = config.payoutDays.max
    while (daysAdded < targetDays) {
        estimatedDate.setDate(estimatedDate.getDate() + 1)
        const dayOfWeek = estimatedDate.getDay()
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            daysAdded++
        }
    }

    // Determine status from estimate
    if (now >= estimatedDate) {
        return { status: 'completed', step: 2, label: 'In your bank', icon: CheckCircle }
    } else if (now.getTime() - paymentDate.getTime() > 24 * 60 * 60 * 1000) {
        return { status: 'in_transit', step: 1, label: 'On the way', icon: Building2 }
    } else {
        return { status: 'processing', step: 0, label: 'Processing', icon: Clock }
    }
}

// Estimate payout date
const formatEstimatedPayoutDate = (provider: string | undefined, createdAt: string) => {
    const config = PROVIDER_CONFIG[provider as keyof typeof PROVIDER_CONFIG] || PROVIDER_CONFIG.stripe
    const paymentDate = new Date(createdAt)

    const estimatedDate = new Date(paymentDate)
    let daysAdded = 0
    const targetDays = config.payoutDays.max
    while (daysAdded < targetDays) {
        estimatedDate.setDate(estimatedDate.getDate() + 1)
        const dayOfWeek = estimatedDate.getDay()
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            daysAdded++
        }
    }

    return estimatedDate.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
    })
}

// Format date
const formatDate = (date: string | null) => {
    if (!date) return '-'
    return new Date(date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })
}

// Format short date
const formatShortDate = (date: string | null) => {
    if (!date) return '-'
    return new Date(date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
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

// Activity configuration type
type ActivityConfig = {
    title: string
    icon: LucideIcon
    isPositive: boolean   // Green - money in
    isNegative: boolean   // Red - money out (refunds, disputes lost)
    isWarning: boolean    // Amber - attention needed
    showAmount: boolean
}

// Get comprehensive activity display info
const getActivityConfig = (type: string, isService: boolean): ActivityConfig => {
    switch (type) {
        // === POSITIVE PAYMENT EVENTS ===
        case 'subscription_created':
        case 'new_subscriber':
            return { title: isService ? 'New Client' : 'New Subscriber', icon: UserPlus, isPositive: true, isNegative: false, isWarning: false, showAmount: true }
        case 'payment_received':
        case 'payment':
            return { title: isService ? 'Invoice Paid' : 'Payment Received', icon: DollarSign, isPositive: true, isNegative: false, isWarning: false, showAmount: true }
        case 'renewal':
            return { title: isService ? 'Retainer Renewed' : 'Renewed', icon: RefreshCw, isPositive: true, isNegative: false, isWarning: false, showAmount: true }
        case 'request_accepted':
            return { title: isService ? 'Invoice Accepted' : 'Request Accepted', icon: Check, isPositive: true, isNegative: false, isWarning: false, showAmount: true }
        case 'dispute_won':
            return { title: 'Dispute Won', icon: ShieldCheck, isPositive: true, isNegative: false, isWarning: false, showAmount: true }
        case 'payout_completed':
            return { title: 'Payout Received', icon: CheckCircle, isPositive: true, isNegative: false, isWarning: false, showAmount: true }

        // === NEGATIVE EVENTS (money out) ===
        case 'payment_refunded':
            return { title: 'Refund Issued', icon: RotateCcw, isPositive: false, isNegative: true, isWarning: false, showAmount: true }
        case 'dispute_lost':
            return { title: 'Dispute Lost', icon: ShieldX, isPositive: false, isNegative: true, isWarning: false, showAmount: true }

        // === WARNING EVENTS (attention needed) ===
        case 'payment_failed':
            return { title: 'Payment Failed', icon: XCircle, isPositive: false, isNegative: false, isWarning: true, showAmount: true }
        case 'dispute_created':
            return { title: 'Dispute Opened', icon: ShieldAlert, isPositive: false, isNegative: false, isWarning: true, showAmount: true }
        case 'payout_failed':
            return { title: 'Payout Failed', icon: AlertTriangle, isPositive: false, isNegative: false, isWarning: true, showAmount: true }

        // === NEUTRAL/INFO EVENTS ===
        case 'subscription_canceled':
        case 'cancelled':
        case 'subscription_auto_canceled':
            return { title: isService ? 'Client Left' : 'Cancelled', icon: UserX, isPositive: false, isNegative: false, isWarning: false, showAmount: false }
        case 'request_sent':
            return { title: isService ? 'Invoice Sent' : 'Request Sent', icon: Send, isPositive: false, isNegative: false, isWarning: false, showAmount: true }
        case 'request_declined':
            return { title: isService ? 'Invoice Declined' : 'Request Declined', icon: XCircle, isPositive: false, isNegative: false, isWarning: false, showAmount: false }
        case 'payout_initiated':
            return { title: 'Payout Started', icon: Banknote, isPositive: false, isNegative: false, isWarning: false, showAmount: true }

        // === DEFAULT ===
        default:
            return { title: 'Activity', icon: DollarSign, isPositive: false, isNegative: false, isWarning: false, showAmount: true }
    }
}

export default function ActivityDetail() {
    const goBack = useSafeBack('/activity')
    const toast = useToast()
    const { id } = useParams()
    const { data: userData } = useCurrentUser()
    const isService = userData?.profile?.purpose === 'service'

    // Fetch activity from API (now includes payoutInfo from backend)
    const { data, isLoading, isError, refetch } = useActivityDetail(id || '')

    const activityData = data?.activity
    const realPayoutInfo = data?.payoutInfo
    const fxData = data?.fxData
    const fxPending = data?.fxPending ?? false
    const payload = activityData?.payload || {}

    // Auto-refresh when FX data is pending (backfill in progress)
    // Retry at 2.5s and 7.5s to handle varying transfer delays
    const retryCount = useRef(0)
    const lastActivityId = useRef(id)

    useEffect(() => {
        // Reset retry count when activity ID changes
        if (id !== lastActivityId.current) {
            retryCount.current = 0
            lastActivityId.current = id
        }

        // Reset when FX data arrives
        if (!fxPending || fxData) {
            retryCount.current = 0
            return
        }

        // Max 2 retries: 2.5s then 7.5s
        if (retryCount.current >= 2) return

        const delay = retryCount.current === 0 ? 2500 : 7500
        const timer = setTimeout(() => {
            retryCount.current++
            refetch()
        }, delay)

        return () => clearTimeout(timer)
    }, [id, fxPending, fxData, refetch])
    const currencyCode = (payload.currency || userData?.profile?.currency || 'USD').toUpperCase()
    const currencySymbol = getCurrencySymbol(currencyCode)

    // Map API data to UI format
    const rawName = payload.subscriberName || payload.recipientName || payload.subscriberEmail || ''
    const displayName = rawName && rawName.trim() ? rawName.trim() : 'Unknown'

    // Detect provider from payload or guess from currency
    const provider = payload.provider || (currencyCode === 'NGN' || currencyCode === 'GHS' || currencyCode === 'KES' ? 'paystack' : 'stripe')

    // Check if this is a payment-related activity (for showing payout status)
    const paymentActivityTypes = [
        'payment_received', 'payment', 'renewal', 'subscription_created',
        'new_subscriber', 'request_accepted'
    ]
    const isPaymentActivity = paymentActivityTypes.includes(activityData?.type || '')

    // FIX: payload.amount IS the net amount (what creator receives)
    // payload.grossAmount is the gross (what subscriber paid) - only in some webhooks
    // If no grossAmount, calculate: gross = net + fees
    const netCents = payload.amount ?? 0
    const feeCents = payload.feeCents ?? 0
    const grossCents = payload.grossAmount ?? (netCents + feeCents)

    const activity = activityData ? {
        id: activityData.id,
        type: activityData.type,
        name: displayName,
        email: payload.subscriberEmail || payload.recipientEmail || '',
        // Display amount - use net for positive events, gross for refunds/disputes
        amount: centsToDisplayAmount(netCents, currencyCode),
        grossCents,
        feeCents,
        netCents,
        time: formatTime(activityData.createdAt),
        tier: payload.tierName || (isService ? 'Client' : 'Supporter'),
        date: formatDate(activityData.createdAt),
        shortDate: formatShortDate(activityData.createdAt),
        createdAt: activityData.createdAt,
        transactionId: payload.transactionId || payload.paymentId || activityData.id,
        paymentMethod: payload.paymentMethod || null,
        subscription: payload.subscription || null,
        provider,
        // For failure messages
        failureMessage: payload.failureMessage || payload.reason || null,
    } : null

    const handleDownloadReceipt = () => {
        toast.info('Receipt download coming soon')
    }

    const handleMore = () => {
        toast.info('More options coming soon')
    }

    // Loading state
    if (isLoading) {
        return (
            <div className="activity-detail-page">
                <header className="activity-detail-header">
                    <Pressable className="header-btn" onClick={() => goBack()}>
                        <ArrowLeft size={20} />
                    </Pressable>
                    <img src="/logo.svg" alt="NatePay" className="header-logo" />
                    <div className="header-spacer" />
                </header>
                <div className="receipt-hero">
                    <Skeleton width={64} height={64} borderRadius="50%" />
                    <Skeleton width={140} height={48} style={{ marginTop: 20 }} />
                    <Skeleton width={100} height={24} style={{ marginTop: 8 }} />
                </div>
            </div>
        )
    }

    // Error state
    if (isError) {
        return (
            <div className="activity-detail-page">
                <header className="activity-detail-header">
                    <Pressable className="header-btn" onClick={() => goBack()}>
                        <ArrowLeft size={20} />
                    </Pressable>
                    <img src="/logo.svg" alt="NatePay" className="header-logo" />
                    <div className="header-spacer" />
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
            <div className="activity-detail-page">
                <header className="activity-detail-header">
                    <Pressable className="header-btn" onClick={() => goBack()}>
                        <ArrowLeft size={20} />
                    </Pressable>
                    <img src="/logo.svg" alt="NatePay" className="header-logo" />
                    <div className="header-spacer" />
                </header>
                <div className="activity-detail-empty">
                    <span>Activity not found</span>
                </div>
            </div>
        )
    }

    const config = getActivityConfig(activity.type, isService)
    const payoutInfo = isPaymentActivity ? getPayoutInfo(activity.provider, activity.createdAt, realPayoutInfo) : null
    const providerConfig = PROVIDER_CONFIG[activity.provider as keyof typeof PROVIDER_CONFIG] || PROVIDER_CONFIG.stripe
    const ActivityIcon = config.icon

    // Determine hero status class
    const heroStatusClass = config.isPositive ? 'success' : config.isNegative ? 'negative' : config.isWarning ? 'warning' : 'neutral'

    return (
        <div className="activity-detail-page">
            {/* Header */}
            <header className="activity-detail-header">
                <Pressable className="header-btn" onClick={() => goBack()}>
                    <ArrowLeft size={20} />
                </Pressable>
                <img src="/logo.svg" alt="NatePay" className="header-logo" />
                <Pressable className="header-btn" onClick={handleMore}>
                    <MoreHorizontal size={20} />
                </Pressable>
            </header>

            {/* Receipt Hero */}
            <div className="receipt-hero">
                {/* Status Icon */}
                <div className={`receipt-status-icon ${heroStatusClass}`}>
                    {config.isPositive ? (
                        <svg className="checkmark" viewBox="0 0 52 52">
                            <circle className="checkmark-circle" cx="26" cy="26" r="25" fill="none" />
                            <path className="checkmark-check" fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
                        </svg>
                    ) : (
                        <ActivityIcon size={32} />
                    )}
                </div>

                {/* Amount */}
                {config.showAmount && activity.netCents > 0 && (
                    <div className="receipt-amount">
                        <span className={`receipt-amount-value ${heroStatusClass}`}>
                            {config.isPositive ? '+' : config.isNegative ? '-' : ''}{currencySymbol}{formatCompactNumber(activity.amount)}
                        </span>
                    </div>
                )}

                {/* Badge */}
                <span className={`receipt-badge ${heroStatusClass}`}>
                    {config.title}
                </span>

                {/* Failure message for failed/warning events */}
                {activity.failureMessage && (config.isWarning || config.isNegative) && (
                    <p className="receipt-failure-message">{activity.failureMessage}</p>
                )}
            </div>

            {/* Content */}
            <div className="receipt-content">
                {/* From Card */}
                <div className="receipt-card stagger-1">
                    <div className="receipt-card-label">FROM</div>
                    <div className="from-row">
                        <div className="from-avatar">{activity.name?.[0] || '?'}</div>
                        <div className="from-info">
                            <span className="from-name">{activity.name}</span>
                            <span className="from-email">{activity.email}</span>
                        </div>
                    </div>
                </div>

                {/* Payout Status - Only for payment activities */}
                {isPaymentActivity && payoutInfo && payoutInfo.step >= 0 && (
                    <div className="receipt-card stagger-2">
                        <div className="receipt-card-label">PAYOUT STATUS</div>

                        {/* Progress Timeline */}
                        <div className="payout-timeline">
                            {PAYOUT_STEPS.map((step, index) => (
                                <div key={step.key} className="payout-step">
                                    <div className={`payout-dot ${index <= payoutInfo.step ? 'active' : ''} ${index === payoutInfo.step ? 'current' : ''}`}>
                                        {index < payoutInfo.step && <Check size={12} />}
                                    </div>
                                    <span className={`payout-step-label ${index <= payoutInfo.step ? 'active' : ''}`}>
                                        {step.label}
                                    </span>
                                    {index < PAYOUT_STEPS.length - 1 && (
                                        <div className={`payout-line ${index < payoutInfo.step ? 'active' : ''}`} />
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Expected Date */}
                        <div className="payout-expected">
                            {payoutInfo.status === 'completed'
                                ? realPayoutInfo?.date
                                    ? `Deposited ${formatShortDate(realPayoutInfo.date)}`
                                    : 'Deposited to your bank'
                                : payoutInfo.status === 'in_transit'
                                    ? `Expected by ${realPayoutInfo?.date ? formatShortDate(realPayoutInfo.date) : formatEstimatedPayoutDate(activity.provider, activity.createdAt)}`
                                    : `Usually ${providerConfig.payoutText}`
                            }
                        </div>
                    </div>
                )}

                {/* Breakdown - Only show for activities with amounts */}
                {config.showAmount && activity.netCents > 0 && (
                    <div className="receipt-card stagger-3">
                        <div className="receipt-card-label">BREAKDOWN</div>

                        <div className="breakdown-rows">
                            {/* Show gross first if we have fees */}
                            {activity.feeCents > 0 ? (
                                <>
                                    <div className="breakdown-row">
                                        <span className="breakdown-label">Gross amount</span>
                                        <span className="breakdown-value">{currencySymbol}{centsToDisplayAmount(activity.grossCents, currencyCode)}</span>
                                    </div>
                                    <div className="breakdown-row">
                                        <span className="breakdown-label">Fees</span>
                                        <span className="breakdown-value muted">-{currencySymbol}{centsToDisplayAmount(activity.feeCents, currencyCode)}</span>
                                    </div>
                                    <div className="breakdown-divider" />
                                    <div className="breakdown-row total">
                                        <span className="breakdown-label">You receive</span>
                                        <span className="breakdown-value highlight">{currencySymbol}{centsToDisplayAmount(activity.netCents, currencyCode)}</span>
                                    </div>
                                </>
                            ) : (
                                <div className="breakdown-row">
                                    <span className="breakdown-label">Amount</span>
                                    <span className="breakdown-value">{currencySymbol}{centsToDisplayAmount(activity.netCents, currencyCode)}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* FX Conversion - Show for cross-border payments */}
                {fxData && fxData.originalCurrency !== fxData.payoutCurrency && (
                    <div className="receipt-card stagger-3">
                        <div className="receipt-card-label">CONVERSION</div>

                        <div className="breakdown-rows">
                            <div className="breakdown-row">
                                <span className="breakdown-label">Amount paid</span>
                                <span className="breakdown-value">
                                    {getCurrencySymbol(fxData.originalCurrency)}{centsToDisplayAmount(fxData.originalAmountCents, fxData.originalCurrency)} {fxData.originalCurrency}
                                </span>
                            </div>
                            <div className="breakdown-row">
                                <span className="breakdown-label">Exchange rate</span>
                                <span className="breakdown-value fx-rate">
                                    1 {fxData.originalCurrency} = {getCurrencySymbol(fxData.payoutCurrency)}{fxData.exchangeRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                            </div>
                            <div className="breakdown-divider" />
                            <div className="breakdown-row total">
                                <span className="breakdown-label">Deposited</span>
                                <span className="breakdown-value highlight">
                                    {getCurrencySymbol(fxData.payoutCurrency)}{centsToDisplayAmount(fxData.payoutAmountCents, fxData.payoutCurrency)} {fxData.payoutCurrency}
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* FX Pending - Show loading state while fetching exchange rate */}
                {!fxData && fxPending && (
                    <div className="receipt-card stagger-3 fx-pending">
                        <div className="receipt-card-label">CONVERSION</div>
                        <div className="fx-pending-content">
                            <Loader2 size={16} className="spin" />
                            <span>Fetching exchange rate...</span>
                        </div>
                    </div>
                )}

                {/* Details */}
                <div className="receipt-card stagger-4">
                    <div className="receipt-card-label">DETAILS</div>

                    <div className="details-rows">
                        <div className="details-row">
                            <span className="details-label">Tier</span>
                            <span className="details-value">{activity.tier}</span>
                        </div>
                        <div className="details-row">
                            <span className="details-label">Date</span>
                            <span className="details-value">{activity.date}</span>
                        </div>
                        <div className="details-row">
                            <span className="details-label">Time</span>
                            <span className="details-value">{activity.time}</span>
                        </div>
                        <div className="details-row">
                            <span className="details-label">Provider</span>
                            <span className="details-value">
                                <span className="provider-chip" style={{ background: `${providerConfig.color}15`, color: providerConfig.color }}>
                                    {providerConfig.name}
                                </span>
                            </span>
                        </div>
                        <div className="details-row">
                            <span className="details-label">Transaction ID</span>
                            <span className="details-value mono">#{String(activity.transactionId).slice(0, 8)}</span>
                        </div>
                        {activity.paymentMethod && (
                            <div className="details-row">
                                <span className="details-label">Payment</span>
                                <span className="details-value">{activity.paymentMethod.brand} ****{activity.paymentMethod.last4}</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Actions */}
            <div className="receipt-actions stagger-5">
                <Pressable className="receipt-btn primary" onClick={handleDownloadReceipt}>
                    <Download size={18} />
                    <span>Download Receipt</span>
                </Pressable>
            </div>
        </div>
    )
}
