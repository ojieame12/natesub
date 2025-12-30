import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, AlertCircle, Check } from 'lucide-react'
import { useToast } from '../components'
import { useCreateCheckout, useRecordPageView, useUpdatePageView } from '../api/hooks'
import { detectPayerCountry } from '../api/client'
import type { Profile } from '../api/client'
import { displayAmountToCents, formatCurrency } from '../utils/currency'
import { TERMS_URL, PRIVACY_URL } from '../utils/constants'
import { queryKeys } from '../api/queryKeys'

// Extracted components and hooks
import { SlideToPay } from './components'
import { usePricingCalculations, usePaymentVerification } from './hooks'

// Colors matching design system
const COLORS = {
    neutral50: '#FAFAF9',
    neutral100: '#F5F5F4',
    neutral200: '#E7E5E4',
    neutral400: '#A8A29E',
    neutral500: '#78716C',
    neutral600: '#57534E',
    neutral700: '#44403C',
    neutral900: '#1C1917',
    white: '#FFFFFF',
}

// Success overlay component
function SuccessOverlay({ email, onReset }: { email: string; onReset: () => void }) {
    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(255,255,255,0.98)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            animation: 'fadeIn 0.3s ease-out',
        }}>
            <div style={{
                width: 80,
                height: 80,
                background: '#10b981',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 24,
                color: 'white',
                boxShadow: '0 10px 30px rgba(16, 185, 129, 0.3)',
            }}>
                <Check size={40} strokeWidth={2.5} />
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: COLORS.neutral900, margin: 0 }}>
                Payment Complete
            </h2>
            <p style={{ fontSize: 15, color: COLORS.neutral500, marginTop: 8 }}>
                Receipt sent to {email || 'your email'}
            </p>
            <button
                onClick={onReset}
                style={{
                    marginTop: 32,
                    fontSize: 14,
                    color: COLORS.neutral500,
                    textDecoration: 'underline',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                }}
            >
                Start New
            </button>
            <img
                src="/logo.svg"
                alt="NatePay"
                style={{ height: 24, marginTop: 48, opacity: 0.6 }}
            />
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
            `}</style>
        </div>
    )
}

// Perk checkmark icon (badge style from landing/check.svg)
function PerkIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 37 37" fill="none">
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M24.0249 16.2756L17.7457 22.5579C17.5283 22.7753 17.2338 22.8971 16.9271 22.8971C16.6203 22.8971 16.3258 22.7753 16.11 22.5579L13.0622 19.5054C12.612 19.0522 12.612 18.3199 13.0637 17.8682C13.517 17.418 14.2477 17.4196 14.6994 17.8697L16.9286 20.1036L22.3892 14.6399C22.8409 14.1882 23.5732 14.1882 24.0249 14.6399C24.4766 15.0916 24.4766 15.8239 24.0249 16.2756ZM31.9182 15.548L30.8406 14.4703C30.3488 13.977 30.079 13.3202 30.079 12.6249V11.0833C30.079 8.78772 28.2105 6.92076 25.9165 6.92076H24.3718C23.6734 6.92076 23.0182 6.65097 22.5279 6.16072L21.4318 5.06613C19.8023 3.45047 17.1629 3.45817 15.5457 5.08309L14.4712 6.16072C13.9764 6.65251 13.3212 6.9223 12.6243 6.9223H11.0811C8.81333 6.92384 6.96334 8.74917 6.92171 11.0093C6.92015 11.0339 6.91863 11.0586 6.91863 11.0848V12.6218C6.91863 13.3187 6.64884 13.9739 6.15704 14.4657L5.06554 15.5588C5.064 15.5634 5.05938 15.5649 5.05629 15.568C3.44525 17.1991 3.45913 19.8384 5.0825 21.4464L6.16013 22.5271C6.65038 23.0189 6.92171 23.6726 6.92171 24.3694V25.9188C6.92171 28.2128 8.78713 30.0797 11.0811 30.0797H12.6213C13.3196 30.0813 13.9748 30.3511 14.4651 30.8398L15.5642 31.9359C16.3474 32.7144 17.3865 33.143 18.4918 33.143H18.5103C19.6219 33.1384 20.6641 32.7006 21.4441 31.9158L22.5248 30.8367C23.0105 30.3526 23.6826 30.0751 24.3687 30.0751H25.9196C28.209 30.0751 30.0759 28.2112 30.0805 25.9188V24.3725C30.0805 23.6772 30.3503 23.022 30.839 22.5302L31.9352 21.4341C33.5539 19.8061 33.5447 17.1652 31.9182 15.548Z"
                fill="black"
            />
        </svg>
    )
}

// --- MAIN COMPONENT ---
interface SubscribeBoundaryProps {
    profile: Profile
    canceled?: boolean
    isOwner?: boolean
}

export default function SubscribeBoundary({ profile, isOwner }: SubscribeBoundaryProps) {
    const navigate = useNavigate()
    const toast = useToast()
    const queryClient = useQueryClient()
    const [searchParams] = useSearchParams()

    // Use extracted hooks
    const pricing = usePricingCalculations(profile)
    const verification = usePaymentVerification(profile.username)

    // Determine if this is service mode (Retainer) vs support mode
    // Use displayMode from backend (authoritative) with purpose fallback for backwards compat
    const isServiceMode = profile.displayMode === 'retainer' || profile.purpose === 'service'
    const badgeText = isServiceMode ? 'Retainer' : 'Support'

    // Get enabled perks for service mode
    // Default enabled to true for legacy perks that don't have the field
    const perks = isServiceMode
        ? (profile.perks || []).filter(p => p.enabled !== false)
        : []

    // Invalidate profile cache on successful verification
    useEffect(() => {
        if (verification.isSuccess) {
            queryClient.invalidateQueries({ queryKey: queryKeys.publicProfile(profile.username) })
        }
    }, [verification.isSuccess, queryClient, profile.username])

    // State
    const [subscriberEmail, setSubscriberEmail] = useState('')
    const [emailFocused, setEmailFocused] = useState(true) // Start active so user knows what to do
    const [status, setStatus] = useState<'idle' | 'processing'>('idle')
    const [resetKey, setResetKey] = useState(0)
    const [payerCountry, setPayerCountry] = useState<string | null>(null)
    const [bgReady, setBgReady] = useState(false)
    const [cardRevealed, setCardRevealed] = useState(false)
    const [contentVisible, setContentVisible] = useState(false)
    const [actionVisible, setActionVisible] = useState(false)
    const viewIdRef = useRef<string | null>(null)
    const emailInputRef = useRef<HTMLInputElement>(null)

    // Multi-stage entrance animation:
    // 0. Background dither fades in
    // 1. Card appears faded at small height
    // 2. Card expands to full height (slow, premium feel)
    // 3. Content fades in
    // 4. Action section (email) reveals with slight delay, then auto-focus
    useEffect(() => {
        // Skip animations in test environment for faster tests
        // Check both Vite's import.meta.env and Node's process.env
        const isTest = import.meta.env.MODE === 'test' ||
            (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test')
        if (isTest) {
            setBgReady(true)
            setCardRevealed(true)
            setContentVisible(true)
            setActionVisible(true)
            return
        }

        // Stage 0: Background dither fades in immediately
        const bgTimer = requestAnimationFrame(() => setBgReady(true))
        // Stage 1: Trigger height expansion after brief delay for paint
        const revealTimer = setTimeout(() => setCardRevealed(true), 100)
        // Stage 2: Fade in content after height expansion completes (800ms animation)
        const contentTimer = setTimeout(() => setContentVisible(true), 950)
        // Stage 3: Reveal action section with stagger
        const actionTimer = setTimeout(() => setActionVisible(true), 1150)
        // Stage 4: Auto-focus email input for immediate typing
        const focusTimer = setTimeout(() => {
            emailInputRef.current?.focus()
        }, 1450)
        return () => {
            cancelAnimationFrame(bgTimer)
            clearTimeout(revealTimer)
            clearTimeout(contentTimer)
            clearTimeout(actionTimer)
            clearTimeout(focusTimer)
        }
    }, [])

    // Hooks for checkout
    const { mutateAsync: createCheckout } = useCreateCheckout()
    const { mutateAsync: recordPageView } = useRecordPageView()
    const { mutateAsync: updatePageView } = useUpdatePageView()

    // Email validation
    const isValidEmail = subscriberEmail.trim().length > 3 && subscriberEmail.includes('@')
    const hasEmailValue = subscriberEmail.trim().length > 0

    // Show verification errors via toast
    useEffect(() => {
        if (verification.error) {
            toast.error(verification.error)
        }
    }, [verification.error, toast])

    // Geo detection and page view tracking
    useEffect(() => {
        if (profile.id && !isOwner && !viewIdRef.current && !verification.isVerifying) {
            detectPayerCountry()
                .then(country => {
                    setPayerCountry(country)
                    return recordPageView({
                        profileId: profile.id,
                        referrer: document.referrer || undefined,
                        utmSource: searchParams.get('utm_source') || undefined,
                        utmMedium: searchParams.get('utm_medium') || undefined,
                        utmCampaign: searchParams.get('utm_campaign') || undefined,
                        country: country || undefined,
                    })
                })
                .then(res => {
                    viewIdRef.current = res.viewId
                    updatePageView({ viewId: res.viewId, data: { reachedPayment: true } }).catch(() => {})
                })
                .catch(err => {
                    console.warn('Country detection failed:', err)
                    recordPageView({
                        profileId: profile.id,
                        referrer: document.referrer || undefined,
                        utmSource: searchParams.get('utm_source') || undefined,
                        utmMedium: searchParams.get('utm_medium') || undefined,
                        utmCampaign: searchParams.get('utm_campaign') || undefined,
                    })
                        .then(res => {
                            viewIdRef.current = res.viewId
                            updatePageView({ viewId: res.viewId, data: { reachedPayment: true } }).catch(() => {})
                        })
                        .catch(console.error)
                })
        } else {
            detectPayerCountry().then(setPayerCountry).catch(() => {})
        }
    }, [profile.id, recordPageView, updatePageView, isOwner, searchParams, verification.isVerifying])

    // Handlers
    const handleShare = async () => {
        const url = `${window.location.origin}/${profile.username}`
        if (navigator.share) {
            await navigator.share({ title: `Subscribe to ${profile.displayName}`, url }).catch(() => {})
        } else {
            await navigator.clipboard.writeText(url)
            toast.success('Link copied')
        }
    }

    const handleSubscribe = async () => {
        setStatus('processing')
        try {
            let viewId = viewIdRef.current
            if (!viewId && profile.id && !isOwner) {
                try {
                    const res = await recordPageView({
                        profileId: profile.id,
                        referrer: document.referrer || undefined,
                        utmSource: searchParams.get('utm_source') || undefined,
                        utmMedium: searchParams.get('utm_medium') || undefined,
                        utmCampaign: searchParams.get('utm_campaign') || undefined,
                    })
                    viewId = res.viewId
                    viewIdRef.current = res.viewId
                } catch {
                    // Ignore analytics failures
                }
            }

            const amountInCents = displayAmountToCents(pricing.currentAmount, pricing.currency)
            const result = await createCheckout({
                creatorUsername: profile.username,
                amount: amountInCents,
                interval: 'month',
                subscriberEmail: subscriberEmail.trim(),
                payerCountry: payerCountry || undefined,
                viewId: viewId || undefined,
            })

            if (result.url) {
                if (viewId) {
                    updatePageView({ viewId, data: { startedCheckout: true } }).catch(() => {})
                }
                window.location.href = result.url
            } else {
                setStatus('idle')
                toast.error('Could not start checkout')
            }
        } catch (err: unknown) {
            console.error(err)
            setStatus('idle')
            setResetKey(prev => prev + 1)
            toast.error((err as Error)?.message || 'Payment failed')
        }
    }

    const handleReset = () => {
        navigate(0)
    }

    // Determine current state
    const isSuccess = verification.isSuccess
    const isProcessing = status === 'processing' || verification.isVerifying

    // Use AI-generated banner for service mode, fallback to avatar
    const bannerUrl = isServiceMode ? (profile.bannerUrl || profile.avatarUrl) : null

    return (
        <div style={{
            height: '100dvh',
            background: 'linear-gradient(180deg, #FFE7A0 0%, #FFF5D6 100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '14px 10px',
            fontFamily: 'var(--font-primary, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
            position: 'relative',
            overflow: 'hidden',
        }}>
            {/* Dither overlay - fades in */}
            <div style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: 'url("/Vector87.svg")',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                opacity: bgReady ? 1 : 0,
                transition: 'opacity 0.6s ease-out',
                pointerEvents: 'none',
            }} />

            {/* Edit button (owner only) */}
            {isOwner && (
                <div style={{
                    position: 'absolute',
                    top: 16,
                    right: 16,
                    zIndex: 10,
                }}>
                    <button
                        onClick={() => navigate('/edit-page')}
                        style={{
                            background: COLORS.white,
                            border: `1px solid ${COLORS.neutral200}`,
                            borderRadius: 20,
                            padding: '8px 14px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                            fontWeight: 600,
                            fontSize: 13,
                            cursor: 'pointer',
                            color: COLORS.neutral700,
                        }}
                    >
                        <Pencil size={14} /> Edit
                    </button>
                </div>
            )}

            {/* Main Card */}
            <div style={{
                width: '100%',
                maxWidth: 420,
                maxHeight: 'calc(100dvh - 28px)', // Fit within viewport with margin
                background: COLORS.white,
                borderRadius: 24,
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.08), 0 24px 64px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(0, 0, 0, 0.02)',
                padding: '20px',
                position: 'relative',
                zIndex: 1,
                overflow: 'hidden',
                // Height reveal animation - slow, premium feel
                opacity: cardRevealed ? 1 : 0.4,
                transform: cardRevealed ? 'scale(1)' : 'scale(0.98)',
                transition: 'opacity 0.6s ease-out, transform 0.8s cubic-bezier(0.22, 1, 0.36, 1)',
            }}>
                {/* Content wrapper for fade-in */}
                <div style={{
                    opacity: contentVisible ? 1 : 0,
                    transform: contentVisible ? 'translateY(0)' : 'translateY(8px)',
                    transition: 'opacity 0.5s ease-out, transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)',
                }}>
                {/* Header Section - Different for Service vs Support */}
                {isServiceMode ? (
                    /* SERVICE MODE: Banner Header - Full bleed to card edges */
                    <div style={{
                        margin: '-20px -20px 0 -20px', // Negative margin to break out of card padding
                        width: 'calc(100% + 40px)',
                    }}>
                        <div style={{
                            width: '100%',
                            height: 109,
                            borderRadius: '24px 24px 0 0', // Match card's top corners
                            overflow: 'hidden',
                            background: COLORS.neutral900,
                            position: 'relative',
                        }}>
                            {bannerUrl ? (
                                <img
                                    src={bannerUrl}
                                    alt=""
                                    loading="lazy"
                                    decoding="async"
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover',
                                        objectPosition: 'center top',
                                    }}
                                />
                            ) : (
                                <div style={{
                                    width: '100%',
                                    height: '100%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 64,
                                    fontWeight: 700,
                                    color: COLORS.white,
                                    opacity: 0.3,
                                }}>
                                    {(profile.displayName || profile.username || 'U').charAt(0).toUpperCase()}
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    /* SUPPORT MODE: Avatar + Badge Header */
                    <div style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        paddingTop: 12,
                    }}>
                        {/* Small Avatar */}
                        <div style={{
                            width: 64,
                            height: 64,
                            borderRadius: '50%',
                            overflow: 'hidden',
                            background: COLORS.neutral100,
                            flexShrink: 0,
                        }}>
                            {profile.avatarUrl ? (
                                <img
                                    src={profile.avatarUrl}
                                    alt=""
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'cover',
                                    }}
                                />
                            ) : (
                                <div style={{
                                    width: '100%',
                                    height: '100%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: 'linear-gradient(135deg, #FFD208 0%, #FF941A 100%)',
                                    fontSize: 24,
                                    fontWeight: 700,
                                    color: COLORS.white,
                                }}>
                                    {(profile.displayName || profile.username || 'U').charAt(0).toUpperCase()}
                                </div>
                            )}
                        </div>

                        {/* Badge */}
                        <div style={{
                            background: COLORS.neutral100,
                            padding: '6px 14px',
                            borderRadius: 20,
                            fontSize: 14,
                            fontWeight: 500,
                            color: COLORS.neutral700,
                        }}>
                            {badgeText}
                        </div>
                    </div>
                )}

                {/* Name, Price, Badge Row */}
                <div style={{
                    marginTop: isServiceMode ? 16 : 20,
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                }}>
                    <div>
                        {/* Creator Name */}
                        <div style={{
                            fontSize: 16,
                            color: COLORS.neutral500,
                            fontWeight: 400,
                        }}>
                            {profile.displayName || profile.username || 'Creator'}
                        </div>

                        {/* Price */}
                        <div style={{
                            fontSize: 36,
                            fontWeight: 700,
                            color: COLORS.neutral900,
                            letterSpacing: -1,
                            lineHeight: 1.1,
                            marginTop: 2,
                        }}>
                            {formatCurrency(pricing.currentAmount, pricing.currency)}
                            <span style={{
                                fontSize: 18,
                                fontWeight: 400,
                                color: COLORS.neutral700,
                            }}>/month</span>
                        </div>
                    </div>

                    {/* Badge (only for Service mode - Support mode shows in header) */}
                    {isServiceMode && (
                        <div style={{
                            background: COLORS.neutral100,
                            padding: '6px 14px',
                            borderRadius: 20,
                            fontSize: 14,
                            fontWeight: 500,
                            color: COLORS.neutral700,
                            marginTop: 4,
                        }}>
                            {badgeText}
                        </div>
                    )}
                </div>

                {/* Perks List (Service Mode Only) */}
                {isServiceMode && perks.length > 0 && (
                    <div style={{ marginTop: 35 }}>
                        {perks.map((perk, index) => (
                            <div key={perk.id}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 12,
                                    padding: '12px 0',
                                }}>
                                    <PerkIcon />
                                    <span style={{
                                        fontSize: 16,
                                        fontWeight: 500,
                                        color: COLORS.neutral600,
                                    }}>
                                        {perk.title}
                                    </span>
                                </div>
                                {index < perks.length - 1 && (
                                    <div style={{
                                        height: 1,
                                        background: COLORS.neutral200,
                                    }} />
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Spacer for Support mode (where perks would be) */}
                {!isServiceMode && (
                    <div style={{ flex: 1, minHeight: 24 }} />
                )}

                {/* Pricing Card */}
                <div style={{
                    marginTop: isServiceMode ? 20 : 0,
                    background: COLORS.neutral50,
                    borderRadius: 12,
                    padding: '16px',
                }}>
                    {/* Subscription Row */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}>
                        <span style={{ fontSize: 15, color: COLORS.neutral600 }}>
                            Subscription
                        </span>
                        <span style={{ fontSize: 15, color: COLORS.neutral700, fontWeight: 500 }}>
                            {formatCurrency(pricing.currentAmount, pricing.currency)}/month
                        </span>
                    </div>

                    {/* Dashed Separator */}
                    <div style={{
                        borderBottom: `1px dashed ${COLORS.neutral200}`,
                        margin: '10px 0',
                    }} />

                    {/* Fee Row */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}>
                        <span style={{ fontSize: 15, color: COLORS.neutral600 }}>
                            Secure payment Fee
                        </span>
                        <span style={{ fontSize: 15, color: COLORS.neutral700 }}>
                            +{formatCurrency(pricing.feePreview.serviceFee, pricing.currency)}
                        </span>
                    </div>

                    {/* Dashed Separator */}
                    <div style={{
                        borderBottom: `1px dashed ${COLORS.neutral200}`,
                        margin: '10px 0',
                    }} />

                    {/* Total Row */}
                    <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}>
                        <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.neutral900 }}>
                            Total
                        </span>
                        <span style={{ fontSize: 18, fontWeight: 700, color: COLORS.neutral900 }}>
                            {formatCurrency(pricing.total, pricing.currency)}/month
                        </span>
                    </div>
                </div>

                {/* Action Section - staggered reveal */}
                <div style={{
                    marginTop: 24,
                    paddingBottom: 16,
                    opacity: actionVisible ? 1 : 0,
                    transform: actionVisible ? 'translateY(0)' : 'translateY(12px)',
                    transition: 'opacity 0.4s ease-out, transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
                }}>
                    {isOwner ? (
                        /* Owner View: Share Button */
                        <button
                            onClick={handleShare}
                            style={{
                                width: '100%',
                                height: 56,
                                background: COLORS.neutral900,
                                color: COLORS.white,
                                border: 'none',
                                borderRadius: 28,
                                fontWeight: 600,
                                fontSize: 16,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            Share
                        </button>
                    ) : pricing.isReadyToPay ? (
                        /* Client View: Email + SlideToPay */
                        <>
                            {/* Email Input with Floating Label */}
                            <div style={{
                                position: 'relative',
                                marginBottom: 16,
                            }}>
                                <input
                                    ref={emailInputRef}
                                    type="email"
                                    value={subscriberEmail}
                                    onChange={e => setSubscriberEmail(e.target.value)}
                                    onFocus={() => setEmailFocused(true)}
                                    onBlur={() => setEmailFocused(false)}
                                    placeholder={emailFocused || hasEmailValue ? '' : 'Customer Email'}
                                    style={{
                                        width: '100%',
                                        height: 56,
                                        padding: hasEmailValue || emailFocused ? '24px 16px 8px' : '0 16px',
                                        background: COLORS.neutral100,
                                        border: emailFocused ? `2px solid ${COLORS.neutral900}` : `2px solid transparent`,
                                        borderRadius: 12,
                                        fontSize: 16,
                                        color: COLORS.neutral900,
                                        outline: 'none',
                                        transition: 'all 0.2s ease',
                                        boxSizing: 'border-box',
                                    }}
                                />
                                {/* Floating Label */}
                                {(hasEmailValue || emailFocused) && (
                                    <label style={{
                                        position: 'absolute',
                                        left: 16,
                                        top: 8,
                                        fontSize: 12,
                                        color: COLORS.neutral500,
                                        pointerEvents: 'none',
                                        transition: 'all 0.2s ease',
                                    }}>
                                        Customer Email
                                    </label>
                                )}
                            </div>

                            {/* Slide to Pay */}
                            <SlideToPay
                                key={resetKey}
                                onComplete={handleSubscribe}
                                disabled={!isValidEmail || isProcessing}
                            />
                        </>
                    ) : (
                        /* Payments Unavailable */
                        <div style={{
                            width: '100%',
                            height: 56,
                            background: COLORS.neutral100,
                            color: COLORS.neutral400,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 8,
                            fontSize: 15,
                            fontWeight: 500,
                            borderRadius: 28,
                        }}>
                            <AlertCircle size={18} /> Payments Unavailable
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    marginTop: 'auto',
                    paddingBottom: 12,
                    textAlign: 'center',
                }}>
                    <img
                        src="/logo.svg"
                        alt="NatePay"
                        style={{ height: 28 }}
                    />
                    <div style={{
                        marginTop: 12,
                        fontSize: 12,
                        color: COLORS.neutral400,
                    }}>
                        <a
                            href={TERMS_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: 'inherit', textDecoration: 'none', marginRight: 16 }}
                        >
                            Terms
                        </a>
                        <a
                            href={PRIVACY_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: 'inherit', textDecoration: 'none' }}
                        >
                            Privacy
                        </a>
                    </div>
                </div>
                </div>{/* End content wrapper */}
            </div>

            {/* Success Overlay */}
            {isSuccess && <SuccessOverlay email={subscriberEmail} onReset={handleReset} />}
        </div>
    )
}
