import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, Play, Pause, Banknote, Briefcase, X, ChevronLeft, Loader2, ArrowRight } from 'lucide-react'
import { Pressable } from '../components'
import { useCreateCheckout, useRecordPageView, useUpdatePageView } from '../api/hooks'
import type { Profile } from '../api/client'
import { getCurrencySymbol, formatCompactNumber, formatAmountWithSeparators, calculateFeePreview } from '../utils/currency'
import './template-one.css'

type ViewType = 'welcome' | 'impact' | 'perks' | 'tiers' | 'payment'

// TEMPORARY: Force all subscriptions to use Stripe until Paystack live keys are ready
// Set to true to re-enable Paystack for creators who have it configured
const PAYSTACK_ENABLED = false

interface SubscribeBoundaryProps {
    profile: Profile
    canceled?: boolean
}

export default function SubscribeBoundary({ profile, canceled }: SubscribeBoundaryProps) {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()

    // Only show back button if there's browser history (not a direct link)
    const canGoBack = typeof window !== 'undefined' && window.history.length > 1

    const { mutateAsync: createCheckout, isPending: isCheckoutLoading } = useCreateCheckout()
    const { mutateAsync: recordPageView } = useRecordPageView()
    const { mutateAsync: updatePageView } = useUpdatePageView()

    // Extract profile data
    const {
        id: profileId,
        username,
        displayName,
        bio,
        avatarUrl,
        voiceIntroUrl,
        purpose,
        pricingModel,
        singleAmount,
        tiers,
        perks: profilePerks,
        impactItems: profileImpactItems,
        currency,
        paymentProvider,
        paymentsReady,
        feeMode,
        crossBorder,
    } = profile

    // Determine if this is a service page vs personal
    const isService = purpose === 'service'
    const currencySymbol = getCurrencySymbol(currency)
    const isPaystack = PAYSTACK_ENABLED && paymentProvider === 'paystack'

    // State
    const [currentView, setCurrentView] = useState<ViewType>('welcome')
    const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null)
    const [isAnimating, setIsAnimating] = useState(false)
    const pendingViewRef = useRef<ViewType | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const [audioDuration, setAudioDuration] = useState(0)
    const [audioCurrentTime, setAudioCurrentTime] = useState(0)
    const audioRef = useRef<HTMLAudioElement>(null)
    const [showTerms, setShowTerms] = useState(false)
    const [subscriberEmail, setSubscriberEmail] = useState('')
    const [emailError, setEmailError] = useState<string | null>(null)
    const [isRedirecting, setIsRedirecting] = useState(false)

    // Tier selection state - default to popular tier or first tier
    // Show tier selection UI if there are multiple tiers, otherwise use single tier pricing
    const hasTiers = isService && pricingModel === 'tiers' && tiers && tiers.length > 1
    // For pricing, use tier amount if pricingModel is 'tiers' (even with 1 tier)
    const useTierPricing = pricingModel === 'tiers' && tiers && tiers.length >= 1
    const [selectedTierId, setSelectedTierId] = useState<string | null>(
        hasTiers ? (tiers.find(t => t.isPopular)?.id || tiers[0]?.id || null) : null
    )

    // Analytics tracking
    const viewIdRef = useRef<string | null>(null)
    const hasTrackedPayment = useRef(false)

    // Note: Success handling (success=true query param) is handled by UserPage,
    // which renders SubscriptionSuccess instead of this component.

    // Record page view on mount
    useEffect(() => {
        if (!profileId) return

        const trackView = async () => {
            try {
                const result = await recordPageView({
                    profileId,
                    referrer: document.referrer || undefined,
                    utmSource: searchParams.get('utm_source') || undefined,
                    utmMedium: searchParams.get('utm_medium') || undefined,
                    utmCampaign: searchParams.get('utm_campaign') || undefined,
                })
                viewIdRef.current = result.viewId
            } catch (err) {
                // Silently fail - analytics shouldn't break the page
                console.error('Failed to record page view:', err)
            }
        }

        trackView()
    }, [profileId, recordPageView, searchParams])

    // Track when user reaches payment screen
    useEffect(() => {
        if (currentView === 'payment' && viewIdRef.current && !hasTrackedPayment.current) {
            hasTrackedPayment.current = true
            updatePageView({
                viewId: viewIdRef.current,
                data: { reachedPayment: true },
            }).catch(() => {}) // Silently fail
        }
    }, [currentView])

    // Swipe handling
    const touchStartX = useRef<number>(0)
    const touchEndX = useRef<number>(0)

    const name = displayName || username || 'Someone'
    const selectedTier = hasTiers ? tiers?.find(t => t.id === selectedTierId) : null

    // Calculate amount - track if we have valid pricing
    // Use tier pricing if pricingModel is 'tiers' (even with just 1 tier)
    const hasValidPricing = useTierPricing
        ? (selectedTier?.amount != null || (tiers && tiers.length > 0 && tiers[0]?.amount != null))
        : (singleAmount != null && singleAmount > 0)

    const currentAmount = useTierPricing
        ? (selectedTier?.amount || tiers?.[0]?.amount || 0)
        : (singleAmount || 0)
    const validImpactItems = (profileImpactItems || []).filter(item => item.title.trim() !== '')
    const enabledPerks = (profilePerks || []).filter(perk => perk.enabled)

    // Fallback avatar
    const fallbackAvatar = 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=80'

    // View sequence - include tiers view for service accounts with multiple tiers
    const viewSequence: ViewType[] = ['welcome', 'impact']
    if (hasTiers) {
        viewSequence.push('tiers')
    } else {
        viewSequence.push('perks')
    }
    viewSequence.push('payment')
    const currentIndex = viewSequence.indexOf(currentView)

    const [checkoutError, setCheckoutError] = useState<string | null>(null)

    // Audio player controls - handles play() Promise properly
    const toggleAudio = async () => {
        if (!audioRef.current) return
        if (isPlaying) {
            audioRef.current.pause()
            setIsPlaying(false)
        } else {
            try {
                await audioRef.current.play()
                setIsPlaying(true)
            } catch (err) {
                console.error('Audio playback failed:', err)
                setIsPlaying(false)
            }
        }
    }

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = Math.floor(seconds % 60)
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    const handleSubscribe = async () => {
        setCheckoutError(null)
        setEmailError(null)

        // Check for network connection
        if (!navigator.onLine) {
            setCheckoutError("You're offline. Please check your internet connection and try again.")
            return
        }

        // Validate pricing is configured
        if (!hasValidPricing || currentAmount <= 0) {
            setCheckoutError('This subscription is not properly configured. Please contact the creator.')
            return
        }

        // Validate email for Paystack (required)
        if (isPaystack) {
            if (!subscriberEmail.trim()) {
                setEmailError('Email is required to proceed')
                return
            }
            // Basic email validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
            if (!emailRegex.test(subscriberEmail.trim())) {
                setEmailError('Please enter a valid email address')
                return
            }
        }

        // Track checkout start
        if (viewIdRef.current) {
            updatePageView({
                viewId: viewIdRef.current,
                data: { startedCheckout: true },
            }).catch(() => {}) // Silently fail
        }

        try {
            // Convert to cents for backend (currentAmount is in dollars from public profile)
            const amountInCents = Math.round(currentAmount * 100)
            const result = await createCheckout({
                creatorUsername: username,
                amount: amountInCents,
                interval: 'month',
                // Pass tierId for tier-based pricing (even with just 1 tier)
                ...(useTierPricing && tiers && tiers.length > 0 ? { tierId: selectedTierId || tiers[0].id } : {}),
                // Pass email for Paystack (required) or Stripe (optional)
                ...(subscriberEmail.trim() ? { subscriberEmail: subscriberEmail.trim() } : {}),
                // Analytics: pass viewId for accurate conversion tracking
                ...(viewIdRef.current ? { viewId: viewIdRef.current } : {}),
            })
            // Redirect to checkout (Stripe or Paystack based on creator's provider)
            if (result.url) {
                setIsRedirecting(true)
                window.location.href = result.url
            } else {
                setCheckoutError('Unable to create checkout session. Please try again.')
            }
        } catch (error: any) {
            console.error('Checkout failed:', error)
            // Ensure we always set a string, not an object
            const errorMsg = typeof error?.error === 'string'
                ? error.error
                : error?.message || 'Payment failed. Please try again.'
            setCheckoutError(errorMsg)
            // DO NOT grant access on failure
        }
    }

    // Animated view transition using animationend events for precise timing
    const changeView = (newView: ViewType, direction: 'left' | 'right') => {
        if (isAnimating || newView === currentView) return
        pendingViewRef.current = newView
        setSlideDirection(direction)
        setIsAnimating(true)
    }

    // Handle animation end on the content container
    const handleAnimationEnd = (e: React.AnimationEvent) => {
        // Only handle animations on the content div itself, not bubbled from children
        if (e.target !== e.currentTarget) return

        // If there's a pending view, switch to it (exit animation just finished)
        if (pendingViewRef.current) {
            setCurrentView(pendingViewRef.current)
            pendingViewRef.current = null
            // Keep isAnimating true - enter animation will now play
        } else {
            // Enter animation finished, reset state
            setIsAnimating(false)
            setSlideDirection(null)
        }
    }

    const handleDotClick = (index: number) => {
        const targetView = viewSequence[index]
        const targetIndex = viewSequence.indexOf(targetView)
        const direction = targetIndex > currentIndex ? 'left' : 'right'
        changeView(targetView, direction)
    }

    const handleNext = () => {
        if (currentIndex < viewSequence.length - 1) {
            changeView(viewSequence[currentIndex + 1], 'left')
        }
    }

    const handlePrev = () => {
        if (currentIndex > 0) {
            changeView(viewSequence[currentIndex - 1], 'right')
        }
    }

    // Swipe handlers
    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartX.current = e.touches[0].clientX
    }

    const handleTouchMove = (e: React.TouchEvent) => {
        touchEndX.current = e.touches[0].clientX
    }

    const handleTouchEnd = () => {
        const swipeThreshold = 50
        const diff = touchStartX.current - touchEndX.current

        if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0) {
                // Swiped left - go next
                handleNext()
            } else {
                // Swiped right - go prev
                handlePrev()
            }
        }
    }

    // Note: Success/verification states are handled by UserPage (shows SubscriptionSuccess component)

    // Payments not ready or pricing not configured - show coming soon state
    if (!paymentsReady || !hasValidPricing) {
        return (
            <div className="sub-page template-boundary">
                <div className="sub-header">
                    {canGoBack ? (
                        <Pressable className="sub-back-btn" onClick={() => navigate(-1)}>
                            <ChevronLeft size={20} />
                        </Pressable>
                    ) : (
                        <div className="sub-header-spacer" />
                    )}
                    <img src="/logo.svg" alt="nate" className="sub-logo-img" />
                    <div className="sub-header-spacer" />
                </div>

                <div className="sub-card">
                    <div className="sub-hero">
                        <div className="sub-hero-pattern" />
                        <div className="sub-hero-content">
                            <div className="sub-hero-left">
                                <div className="sub-hero-badge">
                                    {isService ? <Briefcase size={14} /> : <Banknote size={14} />}
                                    <span>{isService ? 'Service' : 'Tips'}</span>
                                </div>
                                <div className="sub-hero-name">{name}</div>
                            </div>
                            <div className="sub-hero-avatar">
                                <img
                                    src={avatarUrl || fallbackAvatar}
                                    alt={name}
                                    onError={(e) => {
                                        e.currentTarget.src = fallbackAvatar
                                    }}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="sub-content">
                        <div className="sub-view sub-view-welcome">
                            <div className="sub-welcome-content">
                                <h1 className="sub-welcome-title">
                                    <span className="sub-welcome-highlight">Coming Soon</span>
                                </h1>
                                <p className="sub-welcome-text">
                                    {name} is still setting up their subscription page. Check back soon!
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="sub-page template-boundary">
            {/* Header - back button only if there's history */}
            <div className="sub-header">
                {canGoBack ? (
                    <Pressable className="sub-back-btn" onClick={() => navigate(-1)}>
                        <ChevronLeft size={20} />
                    </Pressable>
                ) : (
                    <div className="sub-header-spacer" />
                )}
                <img src="/logo.svg" alt="nate" className="sub-logo-img" />
                <div className="sub-header-spacer" />
            </div>

            {/* Main Card */}
            <div className="sub-card">
                {/* Hero Section - Black card with avatar */}
                <div className="sub-hero">
                    <div className="sub-hero-pattern" />

                    <div className="sub-hero-content">
                        <div className="sub-hero-left">
                            <div className="sub-hero-badge">
                                {isService ? <Briefcase size={14} /> : <Banknote size={14} />}
                                <span>{isService ? 'Service' : 'Tips'}</span>
                            </div>
                            <div className="sub-hero-price">
                                <span className="sub-hero-currency">{currencySymbol}</span>
                                <span className="sub-hero-amount">{formatCompactNumber(currentAmount)}</span>
                            </div>
                            <div className="sub-hero-name">{name}</div>
                        </div>

                        <div className="sub-hero-avatar">
                            <img
                                src={avatarUrl || fallbackAvatar}
                                alt={name}
                                onError={(e) => {
                                    e.currentTarget.src = fallbackAvatar
                                }}
                            />
                        </div>
                    </div>
                </div>

                {/* Content Area - Swipeable */}
                <div
                    className={`sub-content ${isAnimating ? `sub-animating sub-slide-${slideDirection}` : ''}`}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    onAnimationEnd={handleAnimationEnd}
                >
                    {/* Welcome View */}
                    {currentView === 'welcome' && (
                        <div className="sub-view sub-view-welcome">
                            <div className="sub-welcome-content">
                                <h1 className="sub-welcome-title">
                                    {isService ? (
                                        <>Work with <span className="sub-welcome-highlight">{name.split(' ')[0]}</span></>
                                    ) : (
                                        <>Hello, <span className="sub-welcome-highlight">Loved one</span></>
                                    )}
                                </h1>
                                <p className="sub-welcome-text">
                                    {bio || (isService
                                        ? `Subscribe to get ongoing access to ${name}'s services and expertise.`
                                        : `Would love and appreciate your support with a simple subscription. That would mean the world to me!`
                                    )}
                                </p>

                                {/* Voice Message - only show if voiceIntroUrl exists */}
                                {voiceIntroUrl && (
                                    <div className="sub-voice-card-mini">
                                        <audio
                                            ref={audioRef}
                                            src={voiceIntroUrl}
                                            onLoadedMetadata={() => {
                                                if (audioRef.current) {
                                                    setAudioDuration(audioRef.current.duration)
                                                }
                                            }}
                                            onTimeUpdate={() => {
                                                if (audioRef.current) {
                                                    setAudioCurrentTime(audioRef.current.currentTime)
                                                }
                                            }}
                                            onEnded={() => setIsPlaying(false)}
                                            onError={(e) => {
                                                console.error('Audio load error:', e)
                                                setIsPlaying(false)
                                            }}
                                        />
                                        <Pressable
                                            className={`sub-voice-play ${isPlaying ? 'playing' : ''}`}
                                            onClick={toggleAudio}
                                        >
                                            {isPlaying ? <Pause size={16} /> : <Play size={16} fill="white" />}
                                        </Pressable>
                                        <div className="sub-voice-info">
                                            <span className="sub-voice-label-mini">Hear From {name.split(' ')[0]}</span>
                                            <span className="sub-voice-time">
                                                {formatTime(audioCurrentTime)} / {formatTime(audioDuration || 0)}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>

                        </div>
                    )}

                    {/* Impact View */}
                    {currentView === 'impact' && (
                        <div className="sub-view sub-view-impact">
                            <h2 className="sub-section-title">
                                {isService ? 'Why Work With Me' : 'How it would Help Me'}
                            </h2>

                            <div className="sub-items-free">
                                {validImpactItems.map((item, index) => (
                                    <div key={item.id || index} className="sub-item sub-item-numbered">
                                        <span className="sub-item-number">{index + 1}</span>
                                        <div className="sub-item-content">
                                            <span className="sub-item-title">{item.title}</span>
                                            {item.subtitle && <span className="sub-item-subtitle">{item.subtitle}</span>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Perks View */}
                    {currentView === 'perks' && (
                        <div className="sub-view sub-view-perks">
                            <h2 className="sub-section-title">
                                {isService ? "What's Included" : 'What You would Get'}
                            </h2>

                            <div className="sub-items-free">
                                {enabledPerks.length > 0 ? (
                                    enabledPerks.map((perk) => (
                                        <div key={perk.id} className="sub-item sub-item-checked">
                                            <img src="/check-badge.svg" alt="" className="sub-item-badge" />
                                            <div className="sub-item-content">
                                                <span className="sub-item-title">{perk.title}</span>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="sub-item sub-item-checked">
                                        <img src="/check-badge.svg" alt="" className="sub-item-badge" />
                                        <div className="sub-item-content">
                                            <span className="sub-item-title">Support {name}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Tiers View - For service accounts with multiple tiers */}
                    {currentView === 'tiers' && hasTiers && tiers && (
                        <div className="sub-view sub-view-tiers">
                            <h2 className="sub-section-title">Choose Your Plan</h2>

                            <div className="sub-tiers-list">
                                {tiers.map((tier) => {
                                    const isSelected = tier.id === selectedTierId
                                    return (
                                        <Pressable
                                            key={tier.id}
                                            className={`sub-tier-card ${isSelected ? 'selected' : ''}`}
                                            onClick={() => setSelectedTierId(tier.id)}
                                        >
                                            <div className="sub-tier-header">
                                                <div className="sub-tier-title-row">
                                                    <span className="sub-tier-name">{tier.name}</span>
                                                    {tier.isPopular && (
                                                        <span className="sub-tier-popular">Popular</span>
                                                    )}
                                                </div>
                                                {isSelected && (
                                                    <div className="sub-tier-selected-check">
                                                        <Check size={16} />
                                                    </div>
                                                )}
                                            </div>
                                            <div className="sub-tier-price">
                                                <span className="sub-tier-amount">{currencySymbol}{formatCompactNumber(tier.amount)}</span>
                                                <span className="sub-tier-period">/mo</span>
                                            </div>
                                            {tier.perks && tier.perks.length > 0 && (
                                                <div className="sub-tier-perks">
                                                    {tier.perks.map((perk, i) => (
                                                        <div key={i} className="sub-tier-perk">
                                                            <Check size={12} />
                                                            <span>{perk}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </Pressable>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    {/* Payment View */}
                    {currentView === 'payment' && (() => {
                        // Calculate fee preview for display (respects creator's feeMode)
                        const feePreview = calculateFeePreview(currentAmount, currency, purpose, feeMode)

                        return (
                        <div className="sub-view sub-view-payment">
                            <h2 className="sub-section-title">Complete Subscription</h2>

                            <div className="sub-payment-summary">
                                <div className="sub-payment-row">
                                    <span>{selectedTier ? selectedTier.name : 'Monthly subscription'}</span>
                                    <span className="sub-payment-amount">{formatAmountWithSeparators(currentAmount, currency)}</span>
                                </div>
                                <div className="sub-payment-row sub-payment-fee">
                                    <span>Service fee</span>
                                    <span className="sub-payment-amount">{formatAmountWithSeparators(feePreview.serviceFee, currency)}</span>
                                </div>
                                <div className="sub-payment-row sub-payment-total">
                                    <span>Total per month</span>
                                    <span className="sub-payment-amount">{formatAmountWithSeparators(feePreview.subscriberPays, currency)}</span>
                                </div>
                                <div className="sub-payment-row sub-payment-creator">
                                    <span>To {name}</span>
                                    <span className="sub-payment-to">{formatAmountWithSeparators(feePreview.creatorReceives, currency)}</span>
                                </div>
                                {crossBorder && (
                                    <div className="sub-payment-crossborder-note">
                                        Payments are processed in USD
                                    </div>
                                )}
                            </div>

                            {canceled && (
                                <div className="sub-canceled-notice">
                                    Payment was canceled. You can try again when you're ready.
                                </div>
                            )}

                            {checkoutError && (
                                <div className="sub-payment-error">
                                    {checkoutError}
                                </div>
                            )}

                            {/* Email input for Paystack (required) */}
                            {isPaystack && (
                                <div className="sub-email-input-wrapper">
                                    <input
                                        type="email"
                                        className={`sub-email-input ${emailError ? 'error' : ''}`}
                                        placeholder="Enter your email"
                                        value={subscriberEmail}
                                        onChange={(e) => {
                                            setSubscriberEmail(e.target.value)
                                            if (emailError) setEmailError(null)
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && subscriberEmail.trim() && !isCheckoutLoading && !isRedirecting) {
                                                e.preventDefault()
                                                handleSubscribe()
                                            }
                                        }}
                                    />
                                    {emailError && (
                                        <span className="sub-email-error">{emailError}</span>
                                    )}
                                </div>
                            )}

                            <div className="sub-payment-methods">
                                {isPaystack ? (
                                    <Pressable
                                        className="sub-payment-btn sub-payment-paystack"
                                        onClick={handleSubscribe}
                                        disabled={isCheckoutLoading || isRedirecting || !subscriberEmail.trim()}
                                    >
                                        {(isCheckoutLoading || isRedirecting) ? (
                                            <>
                                                <Loader2 size={18} className="spin" />
                                                <span>{isRedirecting ? 'Redirecting...' : 'Processing...'}</span>
                                            </>
                                        ) : (
                                            <span>Pay with Card or Bank</span>
                                        )}
                                    </Pressable>
                                ) : (
                                    <>
                                        <Pressable
                                            className="sub-payment-btn sub-payment-stripe"
                                            onClick={handleSubscribe}
                                            disabled={isCheckoutLoading || isRedirecting}
                                        >
                                            {(isCheckoutLoading || isRedirecting) ? (
                                                <>
                                                    <Loader2 size={18} className="spin" />
                                                    <span>{isRedirecting ? 'Redirecting...' : 'Processing...'}</span>
                                                </>
                                            ) : (
                                                <>
                                                    <img src="/stripe-logo.svg" alt="Stripe" className="sub-payment-logo" />
                                                    <span>Pay with Stripe</span>
                                                </>
                                            )}
                                        </Pressable>
                                    </>
                                )}
                            </div>

                            <p className="sub-payment-note">
                                You can cancel anytime. By subscribing you agree to our{' '}
                                <button className="sub-terms-link" onClick={() => setShowTerms(true)}>
                                    Terms & Conditions
                                </button>
                            </p>
                        </div>
                        )
                    })()}
                </div>

                {/* Swipe Indicator + Pagination Dots */}
                {currentView !== 'payment' && (
                    <div className="sub-pagination">
                        <div className="sub-swipe-indicator">
                            <div className="sub-swipe-arrows">
                                <ChevronLeft size={16} className="sub-swipe-chevron sub-swipe-chevron-1" />
                                <ChevronLeft size={16} className="sub-swipe-chevron sub-swipe-chevron-2" />
                                <ChevronLeft size={16} className="sub-swipe-chevron sub-swipe-chevron-3" />
                            </div>
                            <span className="sub-swipe-text">
                                {currentView === 'welcome' && (isService ? 'Why Work With Me' : 'How it would help Me')}
                                {currentView === 'impact' && (hasTiers ? 'Choose Plan' : (isService ? "What's Included" : 'What You would Get'))}
                                {currentView === 'perks' && 'Make Payment'}
                                {currentView === 'tiers' && 'Make Payment'}
                            </span>
                        </div>
                        <div className="sub-dots">
                            {viewSequence.filter(v => v !== 'payment').map((view, index) => (
                                <button
                                    key={view}
                                    className={`sub-dot ${currentView === view ? 'active' : ''}`}
                                    onClick={() => handleDotClick(index)}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Subscribe Button - Hidden on payment view */}
                {currentView !== 'payment' && (
                    <div className="sub-button-wrapper">
                        <Pressable
                            className="sub-subscribe-btn"
                            onClick={(currentView === 'perks' || currentView === 'tiers') ? () => setCurrentView('payment') : handleNext}
                        >
                            <span className="sub-btn-text">Subscribe Now</span>
                            <ArrowRight size={20} className="sub-btn-arrow" />
                        </Pressable>
                    </div>
                )}
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

            {/* Terms & Conditions Drawer */}
            <div className={`sub-terms-overlay ${showTerms ? 'open' : ''}`} onClick={() => setShowTerms(false)} />
            <div className={`sub-terms-drawer ${showTerms ? 'open' : ''}`}>
                <div className="sub-terms-header">
                    <h3 className="sub-terms-title">Terms & Conditions</h3>
                    <Pressable className="sub-terms-close" onClick={() => setShowTerms(false)}>
                        <X size={20} />
                    </Pressable>
                </div>
                <div className="sub-terms-content">
                    <h4>Subscription Agreement</h4>
                    <p>By subscribing, you agree to the following terms:</p>

                    <h4>1. Recurring Payments</h4>
                    <p>Your subscription will automatically renew each month. You will be charged the subscription amount on the same day each month until you cancel.</p>

                    <h4>2. Cancellation Policy</h4>
                    <p>You may cancel your subscription at any time. Cancellation will take effect at the end of your current billing period. No refunds will be provided for partial months.</p>

                    <h4>3. Payment Processing</h4>
                    <p>Payments are securely processed through {isPaystack ? 'Paystack' : 'Stripe'}. Your payment information is encrypted and never stored on our servers.</p>

                    <h4>4. Content & Benefits</h4>
                    <p>Subscription benefits are provided at the discretion of the person you are subscribing to. Benefits may change over time.</p>

                    <h4>5. Privacy</h4>
                    <p>Your personal information will be handled in accordance with our Privacy Policy. We do not sell your data to third parties.</p>

                    <h4>6. Contact</h4>
                    <p>For questions about your subscription, please contact <a href="mailto:support@natepay.com">support@natepay.com</a></p>
                </div>
            </div>
        </div>
    )
}
