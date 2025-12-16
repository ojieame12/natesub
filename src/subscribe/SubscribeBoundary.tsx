import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Banknote, Briefcase, Pencil, Share, ChevronLeft, Loader2, ArrowRight } from 'lucide-react'
import { Pressable, useToast } from '../components'
import { useCreateCheckout, useRecordPageView, useUpdatePageView, useUpdateSettings } from '../api/hooks'
import type { Profile } from '../api/client'
import { calculateFeePreview, displayAmountToCents } from '../utils/currency'
import PaymentBreakdown from './PaymentBreakdown'
import FeeModeToggle from './FeeModeToggle'
import './template-one.css'

interface SubscribeBoundaryProps {
    profile: Profile
    canceled?: boolean
    isOwner?: boolean
}

export default function SubscribeBoundary({ profile, isOwner }: SubscribeBoundaryProps) {
    const navigate = useNavigate()
    const toast = useToast()

    // --- API Hooks ---
    const { mutateAsync: createCheckout, isPending: isCheckoutLoading } = useCreateCheckout()
    const { mutateAsync: recordPageView } = useRecordPageView()
    const { mutateAsync: updatePageView } = useUpdatePageView()
    const { mutateAsync: updateSettings, isPending: isSettingsLoading } = useUpdateSettings()

    // Only show back button when this page was reached via in-app navigation.
    // `history.length` is unreliable on shared links (it can be > 1 even on a direct entry).
    const canGoBack = (() => {
        if (typeof window === 'undefined') return false
        const idx = (window.history.state as any)?.idx
        if (typeof idx === 'number') return idx > 0
        try {
            if (!document.referrer) return false
            return new URL(document.referrer).origin === window.location.origin
        } catch {
            return false
        }
    })()

    // --- Profile Data ---
    const {
        id: profileId,
        username,
        displayName,
        avatarUrl,
        purpose,
        pricingModel,
        singleAmount,
        tiers,
        currency,
        paymentsReady,
        feeMode: initialFeeMode,
    } = profile

    const isService = purpose === 'service'
    const name = displayName || username || 'Someone'

    // --- Local State ---
    const [feeMode, setFeeMode] = useState<'absorb' | 'pass_to_subscriber'>(initialFeeMode || 'pass_to_subscriber')
    const [subscriberEmail, setSubscriberEmail] = useState('')
    const [emailError, setEmailError] = useState<string | null>(null)
    const [checkoutError, setCheckoutError] = useState<string | null>(null)
    const [isRedirecting, setIsRedirecting] = useState(false)

    // Default fallback avatar
    const fallbackAvatar = 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=80'

    // --- Pricing Logic ---
    // Use tier pricing if model is 'tiers', defaulting to first tier if specific popular one isn't marked logic is handled by pre-selection
    const hasTiers = isService && pricingModel === 'tiers' && tiers && tiers.length > 0
    // Simplify: Just default to the first amount for now in this unified view
    const currentAmount = hasTiers ? (tiers[0].amount) : (singleAmount || 0)
    const hasValidPricing = currentAmount > 0

    // --- Analytics ---
    const viewIdRef = useRef<string | null>(null)

    useEffect(() => {
        if (!profileId) return
        const trackView = async () => {
            try {
                const result = await recordPageView({
                    profileId,
                    referrer: document.referrer || undefined,
                })
                viewIdRef.current = result.viewId
            } catch (err) {
                console.error('Analytics error:', err)
            }
        }
        trackView()
    }, [profileId, recordPageView])

    // --- Handlers ---

    // Toggle Fee Mode (Owner Only)
    const handleFeeToggle = async (newMode: 'absorb' | 'pass_to_subscriber') => {
        // Optimistic update
        setFeeMode(newMode)
        try {
            await updateSettings({ feeMode: newMode })
            toast.success('Fee preference updated')
        } catch (err) {
            toast.error('Failed to save preference')
            setFeeMode(initialFeeMode || 'pass_to_subscriber') // Revert
        }
    }

    // Share Page (Owner Only)
    const handleShare = async () => {
        const url = `https://natepay.co/${username}`
        if (navigator.share) {
            try {
                await navigator.share({
                    title: `Subscribe to ${name}`,
                    text: `Check out my page on Nate`,
                    url
                })
            } catch (err) {
                // User canceled or failed
            }
        } else {
            // Fallback to clipboard
            await navigator.clipboard.writeText(url)
            toast.success('Link copied to clipboard')
        }
    }

    // Subscribe (User)
    const handleSubscribe = async () => {
        setCheckoutError(null)
        setEmailError(null)

        if (!subscriberEmail.trim()) {
            setEmailError('Email is required')
            return
        }

        if (!navigator.onLine) {
            setCheckoutError("You're offline. Please check your connection.")
            return
        }

        try {
            const viewId = viewIdRef.current
            if (viewId) {
                updatePageView({ viewId, data: { reachedPayment: true, startedCheckout: true } }).catch(() => {})
            }

            const amountInCents = displayAmountToCents(currentAmount, currency)
            const result = await createCheckout({
                creatorUsername: username,
                amount: amountInCents,
                interval: 'month',
                tierId: hasTiers ? tiers[0].id : undefined,
                subscriberEmail: subscriberEmail.trim(),
                viewId: viewIdRef.current || undefined,
            })

            if (result.url) {
                setIsRedirecting(true)
                window.location.href = result.url
            } else {
                setCheckoutError('Unable to start checkout')
            }
        } catch (error: any) {
            console.error('Checkout failed:', error)
            setCheckoutError(error?.error || error?.message || 'Payment failed')
        }
    }

    // --- Render ---

    // Fee Preview Calculation
    const feePreview = calculateFeePreview(currentAmount, currency, purpose, feeMode)

    if (!paymentsReady || !hasValidPricing) {
        return (
            <div className="sub-page template-boundary">
                <div className="sub-card">
                    <div className="sub-hero">
                        <div className="sub-hero-content">
                            <div className="sub-hero-avatar">
                                <img src={avatarUrl || fallbackAvatar} alt={name} />
                            </div>
                            <div className="sub-hero-name">{name}</div>
                            <div className="sub-hero-badge">
                                <span>Coming Soon</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="sub-page template-boundary">
            {/* Header (Back + Logo + Edit) */}
            <div className="sub-header">
                {canGoBack ? (
                    <Pressable className="sub-back-btn" onClick={() => navigate(-1)}>
                        <ChevronLeft size={20} />
                    </Pressable>
                ) : (
                    <div className="sub-header-spacer" />
                )}
                <img src="/logo.svg" alt="nate" className="sub-logo-img" />
                {isOwner ? (
                    <Pressable className="sub-back-btn" onClick={() => navigate('/edit-page')}>
                        <Pencil size={18} />
                    </Pressable>
                ) : <div className="sub-header-spacer" />}
            </div>

            <div className="sub-card">
                {/* Hero Section */}
                <div className="sub-hero">
                    <div className="sub-hero-pattern" />
                    <div className="sub-hero-content">
                        <div className="sub-hero-badge">
                            {isService ? <Briefcase size={12} /> : <Banknote size={12} />}
                            <span>{isService ? 'Service' : 'Tips'}</span>
                        </div>

                        <div className="sub-hero-avatar">
                            <img
                                src={avatarUrl || fallbackAvatar}
                                alt={name}
                                onError={(e) => { e.currentTarget.src = fallbackAvatar }}
                            />
                        </div>

                        <div className="sub-hero-name">{name}</div>

                        <div className="sub-hero-desc">
                            {isService
                                ? "Monthly subscription for ongoing access and services."
                                : "Monthly support subscription."
                            }
                        </div>
                    </div>
                </div>

                {/* Body Content */}
                <div className="sub-content">
                    {/* Owner Fee Toggle */}
                    {isOwner && (
                        <FeeModeToggle
                            mode={feeMode}
                            onToggle={handleFeeToggle}
                            disabled={isSettingsLoading}
                        />
                    )}

                    {/* Breakdown Table */}
                    <PaymentBreakdown
                        amount={currentAmount}
                        currency={currency}
                        feePreview={feePreview}
                        isOwner={!!isOwner}
                    />

                    {/* Email Input (Subscriber only) */}
                    {!isOwner && (
                        <div className="sub-email-input-wrapper">
                            <input
                                type="email"
                                className={`sub-email-input ${emailError ? 'error' : ''}`}
                                placeholder="Enter your email"
                                value={subscriberEmail}
                                onChange={(e) => {
                                    setSubscriberEmail(e.target.value)
                                    setEmailError(null)
                                }}
                            />
                            {emailError && (
                                <div className="sub-email-error">{emailError}</div>
                            )}
                        </div>
                    )}

                    {checkoutError && (
                        <div className="sub-checkout-error">{checkoutError}</div>
                    )}
                </div>

                {/* Actions */}
                <div className="sub-button-wrapper">
                    {isOwner ? (
                        <Pressable
                            className="sub-subscribe-btn"
                            onClick={handleShare}
                            disabled={isSettingsLoading}
                        >
                            <span className="sub-btn-text">Share Page</span>
                            <Share size={18} className="sub-btn-arrow" />
                        </Pressable>
                    ) : (
                        <Pressable
                            className="sub-subscribe-btn"
                            onClick={handleSubscribe}
                            disabled={isCheckoutLoading || isRedirecting}
                        >
                            <span className="sub-btn-text">Subscribe Now</span>
                            {isCheckoutLoading ? (
                                <Loader2 size={18} className="spin sub-btn-arrow" />
                            ) : (
                                <ArrowRight size={20} className="sub-btn-arrow" />
                            )}
                        </Pressable>
                    )}
                </div>
            </div>

            {/* Redirect Loading Overlay */}
            {isRedirecting && (
                <div className="sub-redirect-overlay">
                    <div className="sub-redirect-content">
                        <Loader2 size={32} className="spin" />
                        <p>Redirecting to payment...</p>
                    </div>
                </div>
            )}
        </div>
    )
}
