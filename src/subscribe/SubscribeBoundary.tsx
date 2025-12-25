import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Banknote, Briefcase, Pencil, ArrowLeft, AlertCircle, Heart, Users, Star, Wallet } from 'lucide-react'
import { useToast } from '../components'
import { useCreateCheckout, useRecordPageView, useUpdatePageView } from '../api/hooks'
import { detectPayerCountry } from '../api/client'
import type { Profile } from '../api/client'
import { displayAmountToCents, formatCurrency } from '../utils/currency'
import { TERMS_URL, PRIVACY_URL } from '../utils/constants'

// Extracted components and hooks
import { SlideToPay } from './components'
import { usePricingCalculations, usePaymentVerification } from './hooks'

// Purpose display mapping
const PURPOSE_CONFIG: Record<string, { label: string; icon: typeof Banknote }> = {
    support: { label: 'SUPPORT', icon: Heart },
    tips: { label: 'TIPS', icon: Banknote },
    service: { label: 'SERVICE', icon: Briefcase },
    fan_club: { label: 'FAN CLUB', icon: Users },
    exclusive_content: { label: 'EXCLUSIVE', icon: Star },
    allowance: { label: 'ALLOWANCE', icon: Wallet },
    other: { label: 'SUPPORT', icon: Heart },
}

// Success overlay component
function SuccessOverlay({ email, onReset }: { email: string; onReset: () => void }) {
    return (
        <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            textAlign: 'center', animation: 'lg-fadeInUp 0.5s ease-out 0.3s both'
        }}>
            <div style={{
                width: 80, height: 80, background: '#10b981', borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 20px', color: 'white', boxShadow: '0 10px 30px rgba(16, 185, 129, 0.4)'
            }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12" />
                </svg>
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 'bold' }}>Payment Complete</h2>
            <p style={{ opacity: 0.6, marginTop: 10 }}>Receipt sent to {email || 'your email'}</p>
            <button
                onClick={onReset}
                style={{ marginTop: 30, textDecoration: 'underline', opacity: 0.6, border: 'none', background: 'transparent', cursor: 'pointer' }}
            >
                Start New
            </button>
            <div style={{ marginTop: 40, opacity: 0.5 }}>
                <img src="/logo.svg" alt="NatePay" style={{ height: 24 }} />
            </div>
        </div>
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
    const [searchParams] = useSearchParams()

    // Use extracted hooks
    const pricing = usePricingCalculations(profile)
    const verification = usePaymentVerification(profile.username)

    // State
    const [mount, setMount] = useState(false)
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

    // Show verification errors via toast
    useEffect(() => {
        if (verification.error) {
            toast.error(verification.error)
        }
    }, [verification.error, toast])

    // Mount animation and geo detection
    useEffect(() => {
        const timer = setTimeout(() => setMount(true), 50)
        detectPayerCountry().then(setPayerCountry).catch(() => {})

        // Record page view (not for owners)
        if (profile.id && !isOwner && !viewIdRef.current && !verification.isVerifying) {
            recordPageView({
                profileId: profile.id,
                referrer: document.referrer || undefined,
                utmSource: searchParams.get('utm_source') || undefined,
                utmMedium: searchParams.get('utm_medium') || undefined,
                utmCampaign: searchParams.get('utm_campaign') || undefined,
            })
                .then(res => { viewIdRef.current = res.viewId })
                .catch(console.error)
        }

        return () => clearTimeout(timer)
    }, [profile.id, recordPageView, isOwner, searchParams, verification.isVerifying])

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
            // Ensure we have a viewId for conversion attribution
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

            if (viewId) {
                updatePageView({ viewId, data: { reachedPayment: true, startedCheckout: true } }).catch(() => {})
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
        setMount(false)
        setTimeout(() => setMount(true), 100)
        navigate(0)
    }

    // Determine current state
    const isSuccess = verification.isSuccess
    const isProcessing = status === 'processing' || verification.isVerifying

    // --- STYLES ---
    const containerStyle: React.CSSProperties = {
        minHeight: '100vh',
        background: '#fffcf8',
        backgroundImage: `
            radial-gradient(at 80% 0%, rgba(255, 210, 8, 0.15) 0px, transparent 50%),
            radial-gradient(at 0% 50%, rgba(255, 148, 26, 0.12) 0px, transparent 50%),
            radial-gradient(at 80% 100%, rgba(255, 210, 8, 0.1) 0px, transparent 50%)
        `,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '20px', position: 'relative', overflow: 'hidden',
        fontFamily: 'var(--font-primary)'
    }

    const receiptStyle: React.CSSProperties = {
        width: '100%', maxWidth: 350,
        backgroundColor: '#ffffff',
        borderRadius: '16px 16px 0 0',
        maskImage: `radial-gradient(circle at 10px calc(100% + 5px), transparent 12px, black 13px)`,
        WebkitMaskImage: `radial-gradient(circle at 10px calc(100% + 5px), transparent 12px, black 13px)`,
        WebkitMaskSize: '20px 100%', WebkitMaskPosition: '-10px 0', WebkitMaskRepeat: 'repeat-x',
        padding: '30px 24px 50px',
        boxShadow: '0 8px 16px -4px rgba(0, 0, 0, 0.15), 0 35px 60px -15px rgba(0, 0, 0, 0.35), 0 60px 120px -25px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.03)',
        transform: mount ? 'translateY(0) scale(1)' : 'translateY(-20px) scale(0.98)',
        clipPath: mount ? 'inset(-100px -300px -300px -300px)' : 'inset(0 0 100% 0)',
        opacity: mount ? 1 : 0,
        transition: 'clip-path 1s cubic-bezier(0.16, 1, 0.3, 1), transform 1s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.8s ease-out',
        ...(isSuccess && { transform: 'translateY(150%) rotate(2deg)', opacity: 0, transition: 'all 0.6s ease-in' })
    }

    const canGoBack = typeof window !== 'undefined' && window.history.length > 1 && document.referrer.includes(window.location.host)

    return (
        <div style={containerStyle}>
            {/* Noise texture */}
            <div style={{ position: 'fixed', inset: 0, opacity: 0.03, pointerEvents: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }} />

            {/* Back button */}
            {(isOwner || canGoBack) && (
                <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10 }}>
                    <button
                        onClick={() => isOwner ? navigate('/dashboard') : navigate(-1)}
                        style={{
                            background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(10px)',
                            border: '1px solid rgba(0,0,0,0.05)', borderRadius: '50%',
                            width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
                        }}
                    >
                        <ArrowLeft size={20} color="#444" />
                    </button>
                </div>
            )}

            {/* Edit button (owner only) */}
            {isOwner && (
                <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 10 }}>
                    <button
                        onClick={() => navigate('/edit-page')}
                        style={{
                            background: 'white', border: 'none', borderRadius: 20,
                            padding: '10px 15px', display: 'flex', alignItems: 'center', gap: 6,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontWeight: 600, fontSize: 13, cursor: 'pointer'
                        }}
                    >
                        <Pencil size={14} /> Edit Page
                    </button>
                </div>
            )}

            {/* RECEIPT CARD */}
            <div style={receiptStyle}>
                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: 30 }}>
                    <div style={{ position: 'relative', width: 72, height: 72, margin: '0 auto 20px' }}>
                        {profile.avatarUrl ? (
                            <div style={{
                                width: '100%', height: '100%', borderRadius: '50%',
                                backgroundImage: `url(${profile.avatarUrl})`, backgroundSize: 'cover',
                                filter: 'grayscale(100%) contrast(110%)', border: '1px solid #e5e5e5',
                                boxShadow: '0 4px 10px rgba(0,0,0,0.1)'
                            }} />
                        ) : (
                            <div style={{
                                width: '100%', height: '100%', borderRadius: '50%',
                                background: 'linear-gradient(135deg, #FFD208 0%, #FF941A 100%)',
                                border: '1px solid #e5e5e5', boxShadow: '0 4px 10px rgba(0,0,0,0.1)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 28, fontWeight: 700, color: 'white'
                            }}>
                                {(profile.displayName || profile.username || 'U').charAt(0).toUpperCase()}
                            </div>
                        )}
                    </div>

                    <div style={{ fontSize: 11, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase', color: '#999' }}>PAID TO</div>
                    <div style={{ fontSize: 22, fontWeight: 'bold', marginTop: 4 }}>{(profile.displayName || profile.username || 'User').toUpperCase()}</div>

                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
                        {(() => {
                            const config = PURPOSE_CONFIG[profile.purpose || 'support'] || PURPOSE_CONFIG.support
                            const Icon = config.icon
                            return (
                                <div style={{
                                    background: '#000', color: 'white', padding: '3px 8px', borderRadius: 4,
                                    fontSize: 10, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 4, letterSpacing: 0.5
                                }}>
                                    <Icon size={10} />
                                    {config.label}
                                </div>
                            )
                        })()}
                    </div>
                </div>

                {/* Pricing breakdown */}
                <div style={{ fontSize: 13, marginBottom: 25 }}>
                    {isOwner ? (
                        <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, alignItems: 'center' }}>
                                <span>Subscription price</span>
                                <span style={{ fontWeight: 600 }}>{formatCurrency(pricing.currentAmount, pricing.currency)}/mo</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTop: '1px solid #eee' }}>
                                <span style={{ fontWeight: 'bold', fontSize: 14 }}>You receive</span>
                                <div style={{ fontWeight: 'bold', fontSize: 24, letterSpacing: -1 }}>{formatCurrency(pricing.feePreview.creatorReceives, pricing.currency)}</div>
                            </div>
                            <div style={{ fontSize: 11, color: '#888', marginTop: 8, textAlign: 'right' }}>after 4% platform fee</div>
                        </>
                    ) : (
                        <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
                                <span>Subscription</span>
                                <span>{formatCurrency(pricing.currentAmount, pricing.currency)}/mo</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, opacity: 0.7 }}>
                                <span>Secure payment</span>
                                <span>+{formatCurrency(pricing.feePreview.serviceFee, pricing.currency)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 15 }}>
                                <span style={{ fontWeight: 'bold', fontSize: 14, textTransform: 'uppercase' }}>Total Due</span>
                                <div style={{ fontWeight: 'bold', fontSize: 24, letterSpacing: -1 }}>{formatCurrency(pricing.total, pricing.currency)}</div>
                            </div>
                        </>
                    )}
                </div>

                <div style={{ borderBottom: '1px dashed #ccc', marginBottom: 25 }} />

                {/* Email input (subscribers only) */}
                {!isOwner && (
                    <div style={{ marginBottom: 30 }}>
                        <label style={{
                            fontSize: 10, textTransform: 'uppercase', display: 'block', marginBottom: 8,
                            opacity: emailFocused ? 1 : 0.6,
                            color: emailFocused ? '#FF941A' : '#222',
                            transition: 'all 0.2s ease', fontWeight: 'bold'
                        }}>
                            Customer Email
                        </label>
                        <input
                            type="email"
                            placeholder="user@example.com"
                            value={subscriberEmail}
                            onChange={e => setSubscriberEmail(e.target.value)}
                            onFocus={() => setEmailFocused(true)}
                            onBlur={() => setEmailFocused(false)}
                            style={{
                                width: '100%',
                                border: emailFocused ? '1px solid #000' : '1px solid #e0e0e0',
                                padding: '14px', background: emailFocused ? '#fff' : '#f9f9f9',
                                fontFamily: 'inherit', fontSize: 14, outline: 'none', color: '#222', borderRadius: 0,
                                boxShadow: emailFocused ? '0 0 0 4px rgba(255, 148, 26, 0.1)' : 'inset 0 1px 3px rgba(0,0,0,0.02)',
                                transition: 'all 0.2s ease'
                            }}
                        />
                    </div>
                )}

                {/* Action button */}
                <div style={{ marginBottom: 35 }}>
                    {isOwner ? (
                        <button
                            onClick={handleShare}
                            style={{
                                width: '100%', height: 48, background: 'black', color: 'white', border: 'none',
                                fontWeight: 'bold', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                            }}
                        >
                            Share Page
                        </button>
                    ) : pricing.isReadyToPay ? (
                        <SlideToPay
                            key={resetKey}
                            onComplete={handleSubscribe}
                            disabled={!isValidEmail || isProcessing}
                        />
                    ) : (
                        <div style={{
                            width: '100%', height: 48, background: '#f3f4f6', color: '#9ca3af',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                            fontSize: 13, fontWeight: 500, borderRadius: 0, border: '1px solid #e5e7eb'
                        }}>
                            <AlertCircle size={16} /> Payments Unavailable
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{ marginTop: 20, textAlign: 'center', opacity: 0.8 }}>
                    <div style={{ fontSize: 9, marginBottom: 12, letterSpacing: 1.5, textTransform: 'uppercase' }}>Powered By</div>
                    <img src="/logo.svg" alt="NatePay" style={{ height: 28 }} />
                    <div style={{ marginTop: 15, fontSize: 9, opacity: 0.6 }}>
                        <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none', marginRight: 10 }}>Terms</a>
                        <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>Privacy</a>
                    </div>
                </div>
            </div>

            {/* Success overlay */}
            {isSuccess && <SuccessOverlay email={subscriberEmail} onReset={handleReset} />}
        </div>
    )
}
