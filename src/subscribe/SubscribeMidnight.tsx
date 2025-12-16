
import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Banknote, Briefcase, Pencil, Check, ChevronsRight, ArrowLeft, AlertCircle } from 'lucide-react'
import { useToast } from '../components'
import { useCreateCheckout, useRecordPageView, useUpdatePageView, useUpdateSettings } from '../api/hooks'
import * as api from '../api/client'
import type { Profile } from '../api/client'
import { calculateFeePreview, displayAmountToCents, formatCurrency } from '../utils/currency'

// --- SLIDE TO PAY (DARK VARIANT WITH SHIMMER) ---
function SlideToPayDark({ onComplete, disabled }: { onComplete: () => void, disabled?: boolean }) {
    const [dragWidth, setDragWidth] = useState(0)
    const [isDragging, setIsDragging] = useState(false)
    const [completed, setCompleted] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)
    const startX = useRef(0)

    const handleStart = (clientX: number) => {
        if (completed || disabled) return
        setIsDragging(true)
        startX.current = clientX
    }

    const handleMove = (clientX: number) => {
        if (!isDragging || !containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()
        const maxDrag = rect.width - 44
        const offsetX = clientX - startX.current
        const newWidth = Math.max(0, Math.min(offsetX, maxDrag))
        setDragWidth(newWidth)

        if (newWidth > maxDrag * 0.9) {
            setIsDragging(false)
            setCompleted(true)
            setDragWidth(maxDrag)
            onComplete()
        }
    }

    const handleEnd = () => {
        if (!isDragging) return
        setIsDragging(false)
        if (!completed) setDragWidth(0)
    }

    const onMouseDown = (e: React.MouseEvent) => handleStart(e.clientX)
    const onMouseMove = (e: React.MouseEvent) => handleMove(e.clientX)
    const onTouchStart = (e: React.TouchEvent) => handleStart(e.touches[0].clientX)
    const onTouchMove = (e: React.TouchEvent) => handleMove(e.touches[0].clientX)
    const onTouchEnd = () => handleEnd()

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mouseup', handleEnd)
            window.addEventListener('touchend', handleEnd)
        } else {
            window.removeEventListener('mouseup', handleEnd)
            window.removeEventListener('touchend', handleEnd)
        }
        return () => {
            window.removeEventListener('mouseup', handleEnd)
            window.removeEventListener('touchend', handleEnd)
        }
    }, [isDragging])

    return (
        <div
            ref={containerRef}
            style={{
                background: '#0d0d0f',
                height: 48,
                position: 'relative',
                overflow: 'hidden',
                userSelect: 'none',
                touchAction: 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                border: '1px solid #2a2a30',
                borderRadius: 4,
            }}
            onMouseMove={isDragging ? onMouseMove : undefined}
        >
            {/* SHIMMER OVERLAY */}
            <div style={{
                position: 'absolute',
                inset: 0,
                background: 'linear-gradient(90deg, transparent, rgba(255, 210, 8, 0.1), transparent)',
                animation: 'shimmer 2s infinite',
                pointerEvents: 'none',
            }} />

            {/* BRAND GRADIENT FILL */}
            <div style={{
                position: 'absolute',
                left: 0, top: 0, bottom: 0,
                width: dragWidth + 44,
                background: 'linear-gradient(135deg, #FFD208 0%, #FF941A 100%)',
                transition: isDragging ? 'none' : 'width 0.3s ease',
            }} />

            {/* Label */}
            <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: completed ? 'white' : '#888',
                fontWeight: 600, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase',
                pointerEvents: 'none',
                opacity: Math.max(0, 1 - (dragWidth / 100))
            }}>
                {completed ? 'PROCESSING' : 'SLIDE TO PAY'}
            </div>

            {/* Thumb - Dark */}
            <div
                onMouseDown={onMouseDown}
                onTouchStart={onTouchStart}
                onTouchMove={onTouchMove as any}
                onTouchEnd={onTouchEnd}
                style={{
                    height: 46, width: 44,
                    top: 0, left: 0, position: 'absolute',
                    background: completed ? '#FFD208' : '#1f1f24',
                    transform: `translateX(${dragWidth}px)`,
                    transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRight: '1px solid #2a2a30',
                    zIndex: 2, cursor: 'grab',
                    boxShadow: '4px 0 15px rgba(255, 210, 8, 0.3)'
                }}
            >
                <div style={{ animation: !completed ? 'slide-bounce 1.5s infinite' : 'none', display: 'flex', alignItems: 'center' }}>
                    {completed ? <Check size={20} color="#fff" /> : <ChevronsRight size={20} color="#FFD208" />}
                </div>
            </div>

            <style>{`
                @keyframes slide-bounce { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(3px); } }
                @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
            `}</style>
        </div>
    )
}

// --- MAIN DARK MODE COMPONENT ---
interface SubscribeMidnightProps {
    profile: Profile
    canceled?: boolean
    isOwner?: boolean
}

export default function SubscribeMidnight({ profile, isOwner }: SubscribeMidnightProps) {
    const navigate = useNavigate()
    const toast = useToast()
    const [searchParams] = useSearchParams()

    const isSuccessReturn = searchParams.get('success') === 'true'
    const [resetKey, setResetKey] = useState(0)

    // Hooks
    const { mutateAsync: createCheckout } = useCreateCheckout()
    const { mutateAsync: recordPageView } = useRecordPageView()
    const { mutateAsync: updatePageView } = useUpdatePageView()
    const { mutateAsync: updateSettings, isPending: isSettingsLoading } = useUpdateSettings()

    // State
    const [mount, setMount] = useState(false)
    const [feeMode, setFeeMode] = useState<'absorb' | 'pass_to_subscriber'>(profile.feeMode || 'pass_to_subscriber')
    const [subscriberEmail, setSubscriberEmail] = useState('')
    const [emailFocused, setEmailFocused] = useState(false)
    const [status, setStatus] = useState<'idle' | 'processing' | 'verifying' | 'success'>(isSuccessReturn ? 'verifying' : 'idle')
    const viewIdRef = useRef<string | null>(null)

    // Data
    const isService = profile.purpose === 'service'
    const hasTiers = isService && profile.pricingModel === 'tiers' && !!profile.tiers && profile.tiers.length > 0
    const [selectedTierId, setSelectedTierId] = useState<string | undefined>(hasTiers && profile.tiers ? profile.tiers[0].id : undefined)

    // Calculate Amount
    let currentAmount = (profile.singleAmount || 0)
    if (hasTiers && profile.tiers && selectedTierId) {
        const tier = profile.tiers.find(t => t.id === selectedTierId)
        if (tier) currentAmount = tier.amount
    }

    const currency = profile.currency || 'USD'
    const paymentsReady = profile.payoutStatus === 'active' || profile.paymentsReady
    const isReadyToPay = paymentsReady && currentAmount > 0
    const isValidEmail = subscriberEmail.trim().length > 3 && subscriberEmail.includes('@')

    // Fee Calculations
    const feePreview = calculateFeePreview(currentAmount, currency, profile.purpose, feeMode)
    const subscriberPaysFee = feeMode === 'pass_to_subscriber'
    const feeToDisplay = subscriberPaysFee ? feePreview.serviceFee : 0
    const total = currentAmount + feeToDisplay

    useEffect(() => {
        setMount(true)

        if (isSuccessReturn) {
            const sessionId = searchParams.get('session_id')
            if (sessionId) {
                api.checkout.verifySession(sessionId)
                    .then(result => {
                        if (result.verified) {
                            setStatus('success')
                        } else {
                            setStatus('idle')
                            toast.error('Payment verification failed')
                        }
                    })
                    .catch(() => {
                        setStatus('idle')
                        toast.error('Could not verify payment')
                    })
            } else {
                setStatus('idle')
                toast.error('Invalid payment session')
            }
        } else if (profile.id) {
            recordPageView({ profileId: profile.id, referrer: document.referrer || undefined })
                .then(res => viewIdRef.current = res.viewId)
                .catch(console.error)
        }
    }, [profile.id, recordPageView, isSuccessReturn, searchParams, toast])

    // Handlers
    const handleFeeToggle = async () => {
        if (!isOwner) return
        const newMode = feeMode === 'absorb' ? 'pass_to_subscriber' : 'absorb'
        setFeeMode(newMode)
        try {
            await updateSettings({ feeMode: newMode })
            toast.success('Fee preference updated')
        } catch {
            setFeeMode(feeMode)
            toast.error('Failed to update')
        }
    }

    const handleShare = async () => {
        const url = `${window.location.origin}/${profile.username}`
        if (navigator.share) {
            await navigator.share({ title: `Subscribe to ${profile.displayName}`, url }).catch(() => { })
        } else {
            await navigator.clipboard.writeText(url)
            toast.success('Link copied')
        }
    }

    const handleSubscribe = async () => {
        setStatus('processing')
        try {
            if (viewIdRef.current) {
                updatePageView({ viewId: viewIdRef.current, data: { reachedPayment: true, startedCheckout: true } }).catch(() => { })
            }

            const amountInCents = displayAmountToCents(currentAmount, currency)
            const result = await createCheckout({
                creatorUsername: profile.username,
                amount: amountInCents,
                interval: 'month',
                tierId: hasTiers && profile.tiers ? profile.tiers[0].id : undefined,
                subscriberEmail: subscriberEmail.trim(),
                viewId: viewIdRef.current || undefined,
            })

            if (result.url) {
                window.location.href = result.url
            } else {
                setStatus('idle')
                toast.error('Could not start checkout')
            }
        } catch (err: any) {
            console.error(err)
            setStatus('idle')
            setResetKey(prev => prev + 1)
            toast.error(err?.message || 'Payment failed')
        }
    }

    // --- DARK MODE STYLES ---
    const containerStyle: React.CSSProperties = {
        minHeight: '100vh',
        background: '#0c0c0e',
        backgroundImage: `
            radial-gradient(at 80% 0%, rgba(255, 210, 8, 0.15) 0px, transparent 50%),
            radial-gradient(at 0% 50%, rgba(255, 148, 26, 0.12) 0px, transparent 50%),
            radial-gradient(at 80% 100%, rgba(255, 210, 8, 0.1) 0px, transparent 50%)
        `,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '20px', position: 'relative', overflow: 'hidden',
        fontFamily: 'var(--font-primary)',
        color: '#f0f0f0',
    }

    const receiptStyle: React.CSSProperties = {
        width: '100%', maxWidth: 350,
        background: 'linear-gradient(135deg, #1a1a1f 0%, #121215 100%)',
        border: '1px solid rgba(255, 210, 8, 0.2)',
        borderRadius: 16,
        padding: '30px 24px 40px',
        boxShadow: `
            0 0 0 1px rgba(255, 255, 255, 0.05),
            inset 0 1px 0 rgba(255, 255, 255, 0.03),
            0 20px 50px -10px rgba(0, 0, 0, 0.8),
            0 0 60px -20px rgba(255, 210, 8, 0.3)
        `,
        transform: mount ? 'translateY(0)' : 'translateY(50px)',
        opacity: mount ? 1 : 0,
        transition: 'all 0.6s ease-out',
        position: 'relative',
        overflow: 'hidden',
    }

    if (status === 'success') {
        receiptStyle.transform = 'translateY(150%) rotate(2deg)'
        receiptStyle.opacity = 0
        receiptStyle.transition = 'all 0.6s ease-in'
    }

    const canGoBack = typeof window !== 'undefined' && window.history.length > 1 && document.referrer.includes(window.location.host)

    return (
        <div style={containerStyle}>
            {/* Noise Texture */}
            <div style={{ position: 'fixed', inset: 0, opacity: 0.04, pointerEvents: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }} />

            {/* Back Button */}
            <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10 }}>
                {canGoBack && (
                    <button
                        onClick={() => navigate(-1)}
                        style={{
                            background: 'rgba(30, 30, 35, 0.8)', backdropFilter: 'blur(10px)',
                            border: '1px solid rgba(255,255,255,0.1)', borderRadius: '50%',
                            width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
                        }}
                    >
                        <ArrowLeft size={20} color="#aaa" />
                    </button>
                )}
            </div>

            {/* Edit Button for Owner */}
            {isOwner && (
                <div style={{ position: 'absolute', top: 20, right: 20, zIndex: 10 }}>
                    <button
                        onClick={() => navigate('/edit-page')}
                        style={{
                            background: '#1f1f24', border: '1px solid rgba(255, 210, 8, 0.3)', borderRadius: 20,
                            padding: '10px 15px', display: 'flex', alignItems: 'center', gap: 6,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.3)', fontWeight: 600, fontSize: 13, cursor: 'pointer',
                            color: '#f0f0f0'
                        }}
                    >
                        <Pencil size={14} /> Edit Page
                    </button>
                </div>
            )}

            {/* RECEIPT CARD */}
            <div style={receiptStyle}>
                {/* SHIMMER OVERLAY ON CARD */}
                <div style={{
                    position: 'absolute', inset: 0, borderRadius: 16,
                    background: 'linear-gradient(90deg, transparent, rgba(255, 210, 8, 0.05), transparent)',
                    animation: 'shimmer 3s infinite',
                    pointerEvents: 'none',
                }} />

                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: 30, position: 'relative', zIndex: 1 }}>
                    <div style={{ position: 'relative', width: 72, height: 72, margin: '0 auto 20px' }}>
                        {/* Avatar with Brand Yellow Ring */}
                        <div style={{
                            width: '100%', height: '100%', borderRadius: '50%',
                            backgroundImage: `url(${profile.avatarUrl})`, backgroundSize: 'cover',
                            border: '2px solid #FFD208',
                            boxShadow: '0 0 20px rgba(255, 210, 8, 0.4), 0 4px 10px rgba(0,0,0,0.3)'
                        }} />
                    </div>

                    <div style={{ fontSize: 11, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase', color: '#888' }}>PAID TO</div>
                    <div style={{ fontSize: 22, fontWeight: 'bold', marginTop: 4, color: '#f0f0f0' }}>{(profile.displayName || profile.username || 'User').toUpperCase()}</div>

                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
                        <div style={{
                            background: 'linear-gradient(135deg, #FFD208, #FF941A)', color: 'white', padding: '3px 8px', borderRadius: 4,
                            fontSize: 10, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 4, letterSpacing: 0.5
                        }}>
                            {isService ? <Briefcase size={10} /> : <Banknote size={10} />}
                            {isService ? 'SERVICE' : 'TIPS'}
                        </div>
                    </div>
                </div>

                {/* Divider */}
                <div style={{ borderBottom: '1px dashed #3a3a40', marginBottom: 25 }} />

                {/* Breakdown */}
                <div style={{ fontSize: 13, marginBottom: 25, position: 'relative', zIndex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
                        <span style={{ color: '#aaa' }}>Subscription</span>
                        {hasTiers && profile.tiers ? (
                            <select
                                value={selectedTierId}
                                onChange={e => setSelectedTierId(e.target.value)}
                                disabled={status === 'processing' || !isReadyToPay}
                                style={{
                                    appearance: 'none', background: '#2a2a30', border: '1px solid #3a3a40', color: '#f0f0f0',
                                    borderRadius: 4, padding: '2px 20px 2px 8px', fontSize: 13, fontWeight: 'bold',
                                    cursor: 'pointer', fontFamily: 'inherit'
                                }}
                            >
                                {profile.tiers.map(t => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                ))}
                            </select>
                        ) : (
                            <span style={{ color: '#f0f0f0' }}>{formatCurrency(currentAmount, currency)}/mo</span>
                        )}
                        {hasTiers && <span style={{ color: '#f0f0f0' }}>{formatCurrency(currentAmount, currency)}/mo</span>}
                    </div>

                    {(subscriberPaysFee || isOwner) && (
                        <div style={{
                            display: 'flex', justifyContent: 'space-between', marginBottom: 8,
                            opacity: subscriberPaysFee ? 0.7 : 0.4,
                            textDecoration: !subscriberPaysFee ? 'line-through' : 'none',
                            color: '#888'
                        }}>
                            <span>Service Fee {!subscriberPaysFee && '(Absorbed)'}</span>
                            <span>+{formatCurrency(feePreview.serviceFee, currency)}</span>
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 15 }}>
                        <span style={{ fontWeight: 'bold', fontSize: 14, textTransform: 'uppercase', color: '#aaa' }}>Total Due</span>
                        <div style={{ fontWeight: 'bold', fontSize: 24, letterSpacing: -1, color: '#f0f0f0' }}>{formatCurrency(total, currency)}</div>
                    </div>

                    {/* OWNER CONTROLS */}
                    {isOwner && (
                        <div style={{ marginTop: 15, padding: 10, background: '#1f1f24', borderRadius: 8, fontSize: 11, border: '1px solid #2a2a30' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ color: '#888' }}>Fee Mode:</span>
                                <button
                                    onClick={handleFeeToggle} disabled={isSettingsLoading}
                                    style={{
                                        border: '1px solid #3a3a40', background: '#2a2a30', padding: '4px 8px', borderRadius: 4,
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)', cursor: 'pointer', fontWeight: 'bold', color: '#f0f0f0'
                                    }}
                                >
                                    {feeMode === 'absorb' ? 'I Absorb' : 'User Pays'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div style={{ borderBottom: '1px dashed #3a3a40', marginBottom: 25 }} />

                {/* Email Input */}
                {!isOwner && (
                    <div style={{ marginBottom: 30, position: 'relative', zIndex: 1 }}>
                        <label style={{
                            fontSize: 10, textTransform: 'uppercase', display: 'block', marginBottom: 8,
                            opacity: emailFocused ? 1 : 0.6,
                            color: emailFocused ? '#FFD208' : '#888',
                            transition: 'all 0.2s ease', fontWeight: 'bold'
                        }}>
                            Customer Email
                        </label>
                        <input
                            type="email" placeholder="user@example.com" value={subscriberEmail}
                            onChange={e => setSubscriberEmail(e.target.value)}
                            onFocus={() => setEmailFocused(true)} onBlur={() => setEmailFocused(false)}
                            style={{
                                width: '100%',
                                border: emailFocused ? '1px solid #FFD208' : '1px solid #2a2a30',
                                padding: '14px', background: emailFocused ? '#1f1f24' : '#0d0d0f',
                                fontFamily: 'inherit', fontSize: 14, outline: 'none', color: '#f0f0f0', borderRadius: 4,
                                boxShadow: emailFocused ? '0 0 0 4px rgba(255, 210, 8, 0.15)' : 'none',
                                transition: 'all 0.2s ease'
                            }}
                        />
                    </div>
                )}

                {/* Slider / Share */}
                <div style={{ marginBottom: 35, position: 'relative', zIndex: 1 }}>
                    {isOwner ? (
                        <button
                            onClick={handleShare}
                            style={{
                                width: '100%', height: 48, background: 'linear-gradient(135deg, #FFD208, #FF941A)', color: 'white', border: 'none',
                                fontWeight: 'bold', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                borderRadius: 4
                            }}
                        >
                            Share Page
                        </button>
                    ) : (
                        isReadyToPay ? (
                            <SlideToPayDark
                                key={resetKey}
                                onComplete={handleSubscribe}
                                disabled={!isValidEmail || status === 'processing'}
                            />
                        ) : (
                            <div style={{
                                width: '100%', height: 48, background: '#1f1f24', color: '#666',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                fontSize: 13, fontWeight: 500, borderRadius: 4, border: '1px solid #2a2a30'
                            }}>
                                <AlertCircle size={16} /> Payments Unavailable
                            </div>
                        )
                    )}
                </div>

                {/* Footer */}
                <div style={{ marginTop: 20, textAlign: 'center', opacity: 0.6, position: 'relative', zIndex: 1 }}>
                    <div style={{ fontSize: 9, marginBottom: 12, letterSpacing: 1.5, textTransform: 'uppercase', color: '#666' }}>Powered By</div>
                    <img src="/logo.svg" alt="NatePay" style={{ height: 28, filter: 'brightness(0) invert(1)' }} />
                    <div style={{ marginTop: 15, fontSize: 9, color: '#666' }}>
                        <a href="/terms" style={{ color: 'inherit', textDecoration: 'none', marginRight: 10 }}>Terms</a>
                        <a href="/privacy" style={{ color: 'inherit', textDecoration: 'none' }}>Privacy</a>
                    </div>
                </div>
            </div>

            {/* Success Reveal */}
            {status === 'success' && (
                <div style={{
                    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                    textAlign: 'center', animation: 'lg-fadeInUp 0.5s ease-out 0.3s both'
                }}>
                    <div style={{
                        width: 80, height: 80, background: '#10b981', borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 20px', color: 'white', boxShadow: '0 10px 30px rgba(16, 185, 129, 0.4)'
                    }}>
                        <Check size={40} />
                    </div>
                    <h2 style={{ fontSize: 24, fontWeight: 'bold', color: '#f0f0f0' }}>Payment Complete</h2>
                    <p style={{ opacity: 0.6, marginTop: 10, color: '#888' }}>Receipt sent to {subscriberEmail || 'your email'}</p>
                    <button
                        onClick={() => { setStatus('idle'); setMount(false); setTimeout(() => setMount(true), 100); navigate(0); }}
                        style={{ marginTop: 30, textDecoration: 'underline', opacity: 0.6, border: 'none', background: 'transparent', cursor: 'pointer', color: '#888' }}
                    >
                        Start New
                    </button>
                    <div style={{ marginTop: 40, opacity: 0.5 }}>
                        <img src="/logo.svg" alt="NatePay" style={{ height: 24, filter: 'brightness(0) invert(1)' }} />
                    </div>
                </div>
            )}

            {/* Global Keyframes */}
            <style>{`
                @keyframes lg-fadeInUp {
                    from { opacity: 0; transform: translate(-50%, -40%); }
                    to { opacity: 1; transform: translate(-50%, -50%); }
                }
            `}</style>
        </div>
    )
}
