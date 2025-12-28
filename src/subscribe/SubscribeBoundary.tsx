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

// Perk checkmark icon (shield style)
function PerkIcon() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path
                d="M12 2L4 5.5V11.5C4 16.19 7.4 20.55 12 22C16.6 20.55 20 16.19 20 11.5V5.5L12 2Z"
                fill={COLORS.neutral900}
            />
            <path
                d="M10 14.2L7.5 11.7L8.91 10.29L10 11.38L14.59 6.79L16 8.2L10 14.2Z"
                fill="white"
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
    const isServiceMode = profile.purpose === 'service'
    const badgeText = isServiceMode ? 'Retainer' : 'Support'

    // Get enabled perks for service mode
    const perks = isServiceMode
        ? (profile.perks || []).filter(p => p.enabled)
        : []

    // Invalidate profile cache on successful verification
    useEffect(() => {
        if (verification.isSuccess) {
            queryClient.invalidateQueries({ queryKey: queryKeys.publicProfile(profile.username) })
        }
    }, [verification.isSuccess, queryClient, profile.username])

    // State
    const [subscriberEmail, setSubscriberEmail] = useState('')
    const [emailFocused, setEmailFocused] = useState(false)
    const [status, setStatus] = useState<'idle' | 'processing'>('idle')
    const [resetKey, setResetKey] = useState(0)
    const [payerCountry, setPayerCountry] = useState<string | null>(null)
    const viewIdRef = useRef<string | null>(null)

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

    // Generate banner URL from avatar for service mode
    // In production, this would be a separate bannerUrl field
    const bannerUrl = isServiceMode ? profile.avatarUrl : null

    return (
        <div style={{
            minHeight: '100dvh',
            background: 'linear-gradient(180deg, #FFE7A0 0%, #FFF5D6 100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px 16px',
            fontFamily: 'var(--font-primary, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
            position: 'relative',
            overflow: 'hidden',
        }}>
            {/* Dither Texture Overlay */}
            <div style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: 'url("/dither-2.png")',
                backgroundRepeat: 'repeat',
                opacity: 0.15,
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
                background: COLORS.white,
                borderRadius: 24,
                boxShadow: '0 4px 24px rgba(0, 0, 0, 0.08), 0 12px 48px rgba(0, 0, 0, 0.04)',
                padding: '24px',
                position: 'relative',
                zIndex: 1,
            }}>
                {/* Header Section - Different for Service vs Support */}
                {isServiceMode ? (
                    /* SERVICE MODE: Banner Header */
                    <div style={{ paddingTop: 16 }}>
                        <div style={{
                            width: '100%',
                            height: 180,
                            borderRadius: 12,
                            overflow: 'hidden',
                            background: COLORS.neutral900,
                            position: 'relative',
                        }}>
                            {bannerUrl ? (
                                <img
                                    src={bannerUrl}
                                    alt=""
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
                        paddingTop: 24,
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
                    marginTop: isServiceMode ? 20 : 24,
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
                    <div style={{ marginTop: 28 }}>
                        {perks.map((perk, index) => (
                            <div key={perk.id}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 12,
                                    padding: '16px 0',
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
                    <div style={{ flex: 1, minHeight: 40 }} />
                )}

                {/* Pricing Card */}
                <div style={{
                    marginTop: isServiceMode ? 28 : 0,
                    background: COLORS.neutral50,
                    borderRadius: 12,
                    padding: '20px',
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
                        margin: '14px 0',
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
                        margin: '14px 0',
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

                {/* Action Section */}
                <div style={{ marginTop: 24, paddingBottom: 24 }}>
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
                    paddingBottom: 24,
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
            </div>

            {/* Success Overlay */}
            {isSuccess && <SuccessOverlay email={subscriberEmail} onReset={handleReset} />}
        </div>
    )
}
