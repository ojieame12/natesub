import { useState, useRef, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, Play, Pause, Banknote, Briefcase, Pencil, X, ChevronLeft, Loader2, ArrowRight } from 'lucide-react'
import { Pressable } from '../components'
import { useCreateCheckout, useRecordPageView, useUpdatePageView } from '../api/hooks'
import { useHaptics } from '../hooks/useHaptics'
import type { Profile } from '../api/client'
import { getCurrencySymbol, formatCompactNumber, formatAmountWithSeparators, calculateFeePreview, displayAmountToCents } from '../utils/currency'
import './template-one.css'

type ViewType = 'welcome' | 'tiers' | 'payment'

// Curated palette of "Premium" colors - defined outside component for stability
const ACCENT_COLORS = [
    '#FF5A5F', // Airbnb Red (Warm)
    '#00A699', // Teal (Calm)
    '#FC642D', // Orange (Energetic)
    '#FF941A', // Brand Orange (Primary)
    '#D97706', // Amber (Golden)
    '#F59E0B', // Yellow (Sunshine)
    '#FF2D55', // Pink (Vibrant)
    '#007AFF', // Blue (Trust)
    '#34C759', // Green (Growth)
    '#E11D48'  // Rose (Bold)
]

// Hash username to get a consistent accent color
function getSafeColor(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash)
    }
    return ACCENT_COLORS[Math.abs(hash) % ACCENT_COLORS.length]
}

interface SubscribeBoundaryProps {
    profile: Profile
    canceled?: boolean
    isOwner?: boolean
}

export default function SubscriptionLiquid({ profile, canceled, isOwner }: SubscribeBoundaryProps) {
    // Memoize accent color and derived values to prevent recalculation on every render
    const accentColor = useMemo(() => getSafeColor(profile.username || 'default'), [profile.username])
    const contentGlow = useMemo(() => `radial-gradient(circle at 50% -20%, ${accentColor}15 0%, transparent 60%)`, [accentColor])
    const buttonGlow = useMemo(() => `0 8px 20px -6px ${accentColor}60`, [accentColor])

    const navigate = useNavigate()
    const [searchParams] = useSearchParams()

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

    const { mutateAsync: createCheckout, isPending: isCheckoutLoading } = useCreateCheckout()
    const { mutateAsync: recordPageView } = useRecordPageView()
    const { mutateAsync: updatePageView } = useUpdatePageView()
    const { impact } = useHaptics()

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

        currency,
        paymentProvider,
        paymentsReady,
        crossBorder,
    } = profile

    // Determine if this is a service page vs personal
    const isService = purpose === 'service'
    const currencySymbol = getCurrencySymbol(currency)
    const isPaystack = paymentProvider === 'paystack'

    // State
    const [currentView, setCurrentView] = useState<ViewType>('welcome')
    const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null)
    const [entryDirection, setEntryDirection] = useState<'left' | 'right' | null>(null) // Direction new view enters from
    const [isAnimating, setIsAnimating] = useState(false)
    const animationTimeoutRef = useRef<number | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const [audioDuration, setAudioDuration] = useState(0)
    const [audioCurrentTime, setAudioCurrentTime] = useState(0)
    const audioRef = useRef<HTMLAudioElement>(null)
    const [showTerms, setShowTerms] = useState(false)
    const [subscriberEmail, setSubscriberEmail] = useState('')
    const [emailError, setEmailError] = useState<string | null>(null)
    const [isRedirecting, setIsRedirecting] = useState(false)
    const [payerCountry, setPayerCountry] = useState<string | null>(null) // For geo-based provider selection

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

    // Detect payer country via IP for geo-based provider selection
    // Uses sessionStorage cache to reduce API calls (ipapi.co has rate limits)
    useEffect(() => {
        const CACHE_KEY = 'natepay_payer_country'
        const cached = sessionStorage.getItem(CACHE_KEY)

        if (cached && /^[A-Z]{2}$/.test(cached)) {
            setPayerCountry(cached)
            return
        }

        fetch('https://ipapi.co/country/')
            .then(r => r.text())
            .then(code => {
                const cleaned = code.trim().toUpperCase()
                // Only accept valid 2-letter ISO country codes
                if (/^[A-Z]{2}$/.test(cleaned)) {
                    sessionStorage.setItem(CACHE_KEY, cleaned)
                    setPayerCountry(cleaned)
                }
                // Invalid response → payerCountry stays null → backend uses creator default
            })
            .catch(() => { }) // Silent fail - backend uses creator default
    }, [])

    // Track when user reaches payment screen
    useEffect(() => {
        if (currentView === 'payment' && viewIdRef.current && !hasTrackedPayment.current) {
            hasTrackedPayment.current = true
            updatePageView({
                viewId: viewIdRef.current,
                data: { reachedPayment: true },
            }).catch(() => { }) // Silently fail
        }
    }, [currentView])

    // Swipe handling
    const touchStartX = useRef<number>(0)
    const touchEndX = useRef<number>(0)
    const touchStartY = useRef<number>(0)
    const touchEndY = useRef<number>(0)
    const ignoreSwipeRef = useRef(false)

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


    // Fallback avatar
    const fallbackAvatar = 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=80'

    // View sequence - include tiers view for service accounts with multiple tiers
    const viewSequence: ViewType[] = ['welcome']
    if (hasTiers) {
        viewSequence.push('tiers')
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

        if (isOwner) {
            setCheckoutError('You cannot subscribe to your own page.')
            return
        }

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

        // Validate email (required for everyone)
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

        // Track checkout start
        if (viewIdRef.current) {
            updatePageView({
                viewId: viewIdRef.current,
                data: { startedCheckout: true },
            }).catch(() => { }) // Silently fail
        }

        try {
            // Convert to smallest unit for backend (handles zero-decimal currencies)
            const amountInCents = displayAmountToCents(currentAmount, currency)
            const result = await createCheckout({
                creatorUsername: username,
                amount: amountInCents,
                interval: 'month',
                // Pass tierId for tier-based pricing (even with just 1 tier)
                ...(useTierPricing && tiers && tiers.length > 0 ? { tierId: selectedTierId || tiers[0].id } : {}),
                // Pass email for Paystack (required) or Stripe (optional)
                ...(subscriberEmail.trim() ? { subscriberEmail: subscriberEmail.trim() } : {}),
                // Pass payer country for geo-based provider selection
                ...(payerCountry ? { payerCountry } : {}),
                // Analytics: pass viewId for accurate conversion tracking
                ...(viewIdRef.current ? { viewId: viewIdRef.current } : {}),
            })
            // Redirect to checkout (Stripe or Paystack based on creator's provider)
            if (result.url) {
                setIsRedirecting(true)
                window.location.assign(result.url)
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

    // === SLIDE TO PAY ===
    const [slideOffset, setSlideOffset] = useState(0)
    const [isDragging, setIsDragging] = useState(false)
    const slideTrackRef = useRef<HTMLDivElement>(null)
    const slideStartX = useRef(0)
    const SLIDE_TRIGGER_THRESHOLD = 0.7

    // Unified pointer handlers for both touch and mouse (desktop support)
    const handleSlideStart = (e: React.TouchEvent | React.MouseEvent) => {
        e.stopPropagation()
        if (!('touches' in e)) e.preventDefault()
        if (isCheckoutLoading || isRedirecting) return
        if (isPaystack && !subscriberEmail.trim()) return // Disable if email missing

        setIsDragging(true)
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
        slideStartX.current = clientX
    }

    const handleSlideMove = (e: React.TouchEvent | React.MouseEvent) => {
        e.stopPropagation()
        if (!('touches' in e)) e.preventDefault()
        if (!isDragging || !slideTrackRef.current) return

        const trackWidth = slideTrackRef.current.offsetWidth
        const handleWidth = 50 // roughly the handle size
        const maxSlide = trackWidth - handleWidth

        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
        const diff = clientX - slideStartX.current

        // Calculate percentage (0 to 1)
        // We add a little resistance
        const rawOffset = Math.max(0, Math.min(diff, maxSlide))
        const percentage = rawOffset / maxSlide

        setSlideOffset(percentage)
    }

    const handleSlideEnd = (e?: React.TouchEvent | React.MouseEvent) => {
        e?.stopPropagation()
        if (e && !('touches' in e)) e.preventDefault()
        if (!isDragging) return
        setIsDragging(false)

        if (slideOffset > SLIDE_TRIGGER_THRESHOLD) {
            // Snap to end and trigger action
            setSlideOffset(1)
            // Haptic feedback using Capacitor (works on native, gracefully no-ops on web)
            impact('medium')
            handleSubscribe()
        } else {
            // Snap back
            setSlideOffset(0)
        }
    }

    // Reset all slide state if checkout fails
    useEffect(() => {
        if (checkoutError) {
            setSlideOffset(0)
            setIsDragging(false)
            setIsRedirecting(false)
        }
    }, [checkoutError])

    // Animated view transition
    const changeView = (newView: ViewType, direction: 'left' | 'right') => {
        if (isAnimating || newView === currentView) return

        if (animationTimeoutRef.current) {
            window.clearTimeout(animationTimeoutRef.current)
            animationTimeoutRef.current = null
        }

        // Swiping left (next) means the new view enters from the right.
        const incoming = direction === 'left' ? 'right' : 'left'
        setEntryDirection(incoming)
        setCurrentView(newView)
        setSlideDirection(direction)
        setIsAnimating(true)

        // Match CSS: view enter animation is 0.5s
        animationTimeoutRef.current = window.setTimeout(() => {
            setIsAnimating(false)
            setSlideDirection(null)
            setEntryDirection(null)
            animationTimeoutRef.current = null
        }, 550)
    }

    useEffect(() => {
        return () => {
            if (animationTimeoutRef.current) {
                window.clearTimeout(animationTimeoutRef.current)
            }
        }
    }, [])

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

    // Helper to get view class with entry animation
    const getViewClass = (baseClass: string) => {
        const classes = ['sub-view', baseClass]
        if (entryDirection) {
            classes.push(`slide-from-${entryDirection}`)
        }
        return classes.join(' ')
    }

    // Content ref for touch handling
    const contentRef = useRef<HTMLDivElement>(null)

    // Swipe handlers
    const handleTouchStart = (e: React.TouchEvent) => {
        const target = e.target as HTMLElement | null
        // Don't let swipe navigation interfere with buttons/inputs (especially during checkout interactions)
        if (target?.closest('input, textarea, select, button, a, [role="button"], .sub-slide-container')) {
            ignoreSwipeRef.current = true
            return
        }
        ignoreSwipeRef.current = false
        touchStartX.current = e.touches[0].clientX
        touchEndX.current = touchStartX.current
        touchStartY.current = e.touches[0].clientY
        touchEndY.current = touchStartY.current
    }

    const handleTouchMove = (e: React.TouchEvent) => {
        if (ignoreSwipeRef.current) return
        touchEndX.current = e.touches[0].clientX
        touchEndY.current = e.touches[0].clientY
    }

    const handleTouchEnd = () => {
        if (ignoreSwipeRef.current) {
            ignoreSwipeRef.current = false
            return
        }
        const swipeThreshold = 50
        const diffX = touchStartX.current - touchEndX.current
        const diffY = touchStartY.current - touchEndY.current

        // Only treat as a swipe if horizontal movement dominates (prevents accidental swipes while scrolling)
        if (Math.abs(diffX) > swipeThreshold && Math.abs(diffX) > Math.abs(diffY)) {
            if (diffX > 0) {
                // Swiped left - go next
                handleNext()
            } else {
                // Swiped right - go prev
                handlePrev()
            }
        }
    }

    const handleTouchCancel = () => {
        ignoreSwipeRef.current = false
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
                    {isOwner ? (
                        <Pressable className="sub-back-btn" onClick={() => navigate('/edit-page')}>
                            <Pencil size={18} />
                        </Pressable>
                    ) : (
                        <div className="sub-header-spacer" />
                    )}
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
                                    {isOwner
                                        ? "Your page isn't ready for subscribers yet. Finish setup to start accepting payments."
                                        : `${name} is still setting up their subscription page. Check back soon!`}
                                </p>
                            </div>
                        </div>
                    </div>
                    {isOwner && (
                        <div className="sub-button-wrapper">
                            <Pressable className="sub-subscribe-btn" onClick={() => navigate('/edit-page')}>
                                <span className="sub-btn-text">Edit Page</span>
                                <ArrowRight size={20} className="sub-btn-arrow" />
                            </Pressable>
                        </div>
                    )}
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
                {isOwner ? (
                    <Pressable className="sub-back-btn" onClick={() => navigate('/edit-page')}>
                        <Pencil size={18} />
                    </Pressable>
                ) : (
                    <div className="sub-header-spacer" />
                )}
            </div>

            {/* Main Card with Ambient Glow */}
            <div
                className="sub-card"
                style={{
                    '--glow-bg': contentGlow
                } as React.CSSProperties}
            >
                {/* Background Glow Element */}
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: '500px',
                    background: contentGlow,
                    pointerEvents: 'none',
                    zIndex: 0,
                    borderTopLeftRadius: '28px',
                    borderTopRightRadius: '28px',
                }} />
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

                {/* Content Area - Swipeable & Fluid Height */}
                <div
                    ref={contentRef}
                    className={`sub-content ${isAnimating ? `sub-slide-${slideDirection}` : ''}`}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    onTouchCancel={handleTouchCancel}
                >
                    {/* Welcome View */}
                    {currentView === 'welcome' && (
                        <div className={getViewClass('sub-view-welcome')}>
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





                    {/* Tiers View - For service accounts with multiple tiers */}
                    {currentView === 'tiers' && hasTiers && tiers && (
                        <div className={getViewClass('sub-view-tiers')}>
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
                        // Calculate fee preview using split model (4% subscriber + 4% creator)
                        const feePreview = calculateFeePreview(currentAmount, currency, purpose)

                        return (
                            <div className={getViewClass('sub-view-payment')}>
                                <h2 className="sub-section-title">Complete Subscription</h2>

                                <div className="sub-payment-summary">
                                    <div className="sub-payment-row">
                                        <span>{selectedTier ? selectedTier.name : 'Monthly subscription'}</span>
                                        <span className="sub-payment-amount">{formatAmountWithSeparators(currentAmount, currency)}</span>
                                    </div>
                                    <div className="sub-payment-row sub-payment-fee">
                                        <span>Secure payment</span>
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

                                {/* Email input - required for all */}
                                {!isOwner && (
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
                                    {isOwner ? (
                                        <>
                                            <div className="sub-owner-notice">
                                                You're viewing your own page. Subscribers will complete checkout here.
                                            </div>
                                            <Pressable
                                                className="sub-payment-btn sub-payment-stripe"
                                                onClick={() => navigate('/edit-page')}
                                            >
                                                <Pencil size={18} />
                                                <span>Edit Page</span>
                                            </Pressable>
                                            <Pressable
                                                className="sub-payment-btn sub-payment-stripe"
                                                onClick={() => navigate('/settings/payments')}
                                            >
                                                <span>Payment Settings</span>
                                            </Pressable>
                                        </>
                                    ) : (
                                        <>
                                            {/* Slide to Subscribe - Same experience for both Stripe & Paystack */}
                                            <div
                                                className={`sub-slide-container ${isCheckoutLoading ? 'loading' : ''} ${isDragging ? 'dragging' : ''}`}
                                                ref={slideTrackRef}
                                                style={{
                                                    position: 'relative',
                                                    height: '56px',
                                                    borderRadius: '28px',
                                                    background: '#F3F4F6', // neutral-100
                                                    overflow: 'hidden',
                                                    marginTop: '24px',
                                                    transition: 'transform 0.1s ease',
                                                    transform: isDragging ? 'scale(0.98)' : 'scale(1)',
                                                    // Disable if Paystack and no email entered
                                                    ...(isPaystack && !subscriberEmail.trim() ? { opacity: 0.5, pointerEvents: 'none' } : {})
                                                }}
                                                // Touch events (mobile)
                                                onTouchStart={handleSlideStart}
                                                onTouchMove={handleSlideMove}
                                                onTouchEnd={handleSlideEnd}
                                                onTouchCancel={handleSlideEnd}
                                                // Mouse events (desktop)
                                                onMouseDown={handleSlideStart}
                                                onMouseMove={isDragging ? handleSlideMove : undefined}
                                                onMouseUp={handleSlideEnd}
                                                onMouseLeave={isDragging ? handleSlideEnd : undefined}
                                            >
                                                {/* Background Track Text */}
                                                <div style={{
                                                    position: 'absolute',
                                                    top: 0,
                                                    left: 0,
                                                    width: '100%',
                                                    height: '100%',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    zIndex: 1,
                                                    opacity: Math.max(0, 1 - slideOffset * 1.5), // Fade out as we slide
                                                    transition: 'opacity 0.2s ease',
                                                }}>
                                                    <span style={{
                                                        fontSize: '16px',
                                                        fontWeight: 600,
                                                        color: '#6B7280', // text-secondary
                                                        letterSpacing: '-0.2px'
                                                    }}>
                                                        Slide to Subscribe
                                                    </span>
                                                    <div style={{ marginLeft: 8, opacity: 0.5 }}>
                                                        <ChevronLeft size={16} style={{ transform: 'rotate(180deg)' }} />
                                                    </div>
                                                </div>

                                                {/* Active Fill (Colored Track) */}
                                                <div style={{
                                                    position: 'absolute',
                                                    top: 0,
                                                    left: 0,
                                                    height: '100%',
                                                    width: `${slideOffset * 100}%`,
                                                    background: `${accentColor}20`, // 10-20% opacity of accent
                                                    zIndex: 0,
                                                    transition: isDragging ? 'none' : 'width 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)'
                                                }} />

                                                {/* Draggable Handle */}
                                                <div style={{
                                                    position: 'absolute',
                                                    top: '4px',
                                                    height: '48px',
                                                    width: '48px',
                                                    borderRadius: '50%',
                                                    background: accentColor,
                                                    boxShadow: isDragging ? '0 4px 12px rgba(0,0,0,0.2)' : buttonGlow,
                                                    zIndex: 2,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    color: 'white',
                                                    // Use calculated left position for the slide
                                                    left: `calc(4px + ${slideOffset} * (100% - 56px))`,
                                                    transition: isDragging ? 'none' : 'left 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)'
                                                }}>
                                                    {isCheckoutLoading ? (
                                                        <Loader2 size={24} className="spin" />
                                                    ) : (
                                                        <ArrowRight size={24} className="sub-slide-arrow" />
                                                    )}
                                                </div>
                                            </div>

                                            {/* Provider badge - subtle indicator */}
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                gap: '6px',
                                                marginTop: '12px',
                                                opacity: 0.5,
                                                fontSize: '12px',
                                                color: '#6B7280'
                                            }}>
                                                <span>Secured by</span>
                                                {isPaystack ? (
                                                    <span style={{ fontWeight: 600 }}>Paystack</span>
                                                ) : (
                                                    <img src="/stripe-logo.svg" alt="Stripe" style={{ height: '14px' }} />
                                                )}
                                            </div>
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
                                {currentView === 'welcome' && (hasTiers ? 'Choose Plan' : 'Make Payment')}
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
                            onClick={(currentView === 'tiers') ? () => setCurrentView('payment') : handleNext}
                        >
                            <span className="sub-btn-text">{isOwner ? 'Next' : 'Subscribe Now'}</span>
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
                    <p>For questions about your subscription, please contact <a href="mailto:support@natepay.co">support@natepay.co</a></p>
                </div>
            </div>
        </div>
    )
}
