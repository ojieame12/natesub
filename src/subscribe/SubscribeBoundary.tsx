
import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Banknote, Briefcase, Pencil, Check, ChevronsRight, ArrowLeft, AlertCircle } from 'lucide-react'
import { useToast } from '../components'
import { useCreateCheckout, useRecordPageView, useUpdatePageView, useUpdateSettings } from '../api/hooks'
import * as api from '../api/client'
import type { Profile } from '../api/client'
import { calculateFeePreview, displayAmountToCents, formatCurrency } from '../utils/currency'

// --- SLIDE BUTTON ---
function SlideToPay({ onComplete, disabled }: { onComplete: () => void, disabled?: boolean }) {
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
    // const onMouseUp = () => handleEnd() // Unused
    const onTouchStart = (e: React.TouchEvent) => handleStart(e.touches[0].clientX)
    const onTouchMove = (e: React.TouchEvent) => handleMove(e.touches[0].clientX)
    const onTouchEnd = () => handleEnd()

    useEffect(() => {
        if (isDragging) {
            window.addEventListener('mouseup', handleEnd); window.addEventListener('touchend', handleEnd)
        } else {
            window.removeEventListener('mouseup', handleEnd); window.removeEventListener('touchend', handleEnd)
        }
        return () => { window.removeEventListener('mouseup', handleEnd); window.removeEventListener('touchend', handleEnd) }
    }, [isDragging])

    return (
        <div
            ref={containerRef}
            style={{
                background: '#f1f1ee', height: 48, position: 'relative', overflow: 'hidden',
                userSelect: 'none', touchAction: 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1, border: '1px solid #e5e5e5',
            }}
            onMouseMove={isDragging ? onMouseMove : undefined}
        >
            <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, width: dragWidth + 44,
                background: 'linear-gradient(135deg, #FFD208 0%, #FF941A 100%)',
                transition: isDragging ? 'none' : 'width 0.3s ease',
            }} />
            <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: completed ? 'white' : '#666', fontWeight: 600, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase',
                pointerEvents: 'none', opacity: Math.max(0, 1 - (dragWidth / 100))
            }}>
                {completed ? 'PROCESSING' : 'SLIDE TO PAY'}
            </div>
            <div
                onMouseDown={onMouseDown} onTouchStart={onTouchStart} onTouchMove={onTouchMove as any} onTouchEnd={onTouchEnd}
                style={{
                    height: 46, width: 44, top: 0, left: 0, position: 'absolute',
                    background: completed ? 'white' : '#fff',
                    transform: `translateX(${dragWidth}px)`,
                    transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRight: '1px solid #e5e5e5', zIndex: 2, cursor: 'grab',
                    boxShadow: '4px 0 15px rgba(0,0,0,0.1)'
                }}
            >
                <div style={{ animation: !completed ? 'slide-bounce 1.5s infinite' : 'none', display: 'flex', alignItems: 'center' }}>
                    {completed ? <Check size={20} color="#10b981" /> : <ChevronsRight size={20} color="#333" />}
                </div>
            </div>
            <style>{`@keyframes slide-bounce { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(3px); } }`}</style>
        </div>
    )
}

// --- MAIN ENHANCED COMPONENT ---
interface SubscribeBoundaryProps {
    profile: Profile
    canceled?: boolean
    isOwner?: boolean
}

export default function SubscribeBoundary({ profile, isOwner }: SubscribeBoundaryProps) {
    const navigate = useNavigate()
    const toast = useToast()
    const [searchParams] = useSearchParams()

    // Check for success param (Stripe Return)
    const isSuccessReturn = searchParams.get('success') === 'true'

    // Derived State for ResetKey (To reset slider on error)
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

    // Use single amount only (tiers removed from the flow)
    const currentAmount = profile.singleAmount || 0

    const currency = profile.currency || 'USD'

    // Validation Guards
    const paymentsReady = profile.payoutStatus === 'active' || profile.paymentsReady // Ensure backend flag is favored
    const isReadyToPay = paymentsReady && currentAmount > 0
    const isValidEmail = subscriberEmail.trim().length > 3 && subscriberEmail.includes('@')

    // Fee Calculations (Parity with Display Component)
    const feePreview = calculateFeePreview(currentAmount, currency, profile.purpose, feeMode)

    // Derived Visuals
    const subscriberPaysFee = feeMode === 'pass_to_subscriber'
    const feeToDisplay = subscriberPaysFee ? feePreview.serviceFee : 0
    const total = currentAmount + feeToDisplay

    useEffect(() => {
        setMount(true)

        // Handle Session Verification
        if (isSuccessReturn) {
            const sessionId = searchParams.get('session_id')
            if (sessionId) {
                api.checkout.verifySession(sessionId)
                    .then(result => {
                        if (result.verified) {
                            setStatus('success')
                            // Clear query params to prevent re-verification on refresh
                            // navigate(location.pathname, { replace: true }) 
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
                // Fallback for legacy/spoofed URLs without session_id
                // For security, we should PROBABLY reject these, but for transition we might show error
                setStatus('idle')
                toast.error('Invalid payment session')
            }
        } else if (profile.id) {
            recordPageView({ profileId: profile.id, referrer: document.referrer || undefined })
                .then(res => viewIdRef.current = res.viewId)
                .catch(console.error)
        }
    }, [profile.id, recordPageView, isSuccessReturn, searchParams, navigate, toast])

    // Handlers
    const handleFeeToggle = async () => {
        if (!isOwner) return
        const newMode = feeMode === 'absorb' ? 'pass_to_subscriber' : 'absorb'
        setFeeMode(newMode) // Optimistic
        try {
            await updateSettings({ feeMode: newMode })
            toast.success('Fee preference updated')
        } catch {
            setFeeMode(feeMode) // Revert
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
        setStatus('processing') // Lock UI
        try {
            if (viewIdRef.current) {
                updatePageView({ viewId: viewIdRef.current, data: { reachedPayment: true, startedCheckout: true } }).catch(() => { })
            }

            const amountInCents = displayAmountToCents(currentAmount, currency)
            const result = await createCheckout({
                creatorUsername: profile.username,
                amount: amountInCents,
                interval: 'month',
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
            setResetKey(prev => prev + 1) // Reset slider
            toast.error(err?.message || 'Payment failed')
        }
    }

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
        maskImage: `radial-gradient(circle at 10px calc(100% + 5px), transparent 12px, black 13px)`,
        WebkitMaskImage: `radial-gradient(circle at 10px calc(100% + 5px), transparent 12px, black 13px)`,
        WebkitMaskSize: '20px 100%', WebkitMaskPosition: '-10px 0', WebkitMaskRepeat: 'repeat-x',
        padding: '30px 24px 50px',
        boxShadow: '0 8px 16px -4px rgba(0, 0, 0, 0.15), 0 35px 60px -15px rgba(0, 0, 0, 0.35), 0 60px 120px -25px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(0, 0, 0, 0.03)',
        transform: mount ? 'translateY(0)' : 'translateY(50px)',
        opacity: mount ? 1 : 0, transition: 'all 0.6s ease-out'
    }

    // Success Animation Override
    if (status === 'success') {
        receiptStyle.transform = 'translateY(150%) rotate(2deg)'
        receiptStyle.opacity = 0
        receiptStyle.transition = 'all 0.6s ease-in'
    }

    const canGoBack = typeof window !== 'undefined' && window.history.length > 1 && document.referrer.includes(window.location.host)

    return (
        <div style={containerStyle}>
            {/* Noise & Back Button */}
            <div style={{ position: 'fixed', inset: 0, opacity: 0.03, pointerEvents: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }} />

            <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10 }}>
                {(isOwner || canGoBack) && (
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
                )}
            </div>

            {/* Edit Button for Owner */}
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
                        <div style={{
                            width: '100%', height: '100%', borderRadius: '50%',
                            backgroundImage: `url(${profile.avatarUrl})`, backgroundSize: 'cover',
                            filter: 'grayscale(100%) contrast(110%)', border: '1px solid #e5e5e5',
                            boxShadow: '0 4px 10px rgba(0,0,0,0.1)'
                        }} />
                    </div>

                    <div style={{ fontSize: 11, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase', color: '#999' }}>PAID TO</div>
                    <div style={{ fontSize: 22, fontWeight: 'bold', marginTop: 4 }}>{(profile.displayName || profile.username || 'User').toUpperCase()}</div>

                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
                        <div style={{
                            background: '#000', color: 'white', padding: '3px 8px', borderRadius: 4,
                            fontSize: 10, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 4, letterSpacing: 0.5
                        }}>
                            {isService ? <Briefcase size={10} /> : <Banknote size={10} />}
                            {isService ? 'SERVICE' : 'TIPS'}
                        </div>
                    </div>
                </div>

                {/* Breakdown */}
                <div style={{ fontSize: 13, marginBottom: 25 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
                        <span>Subscription</span>
                        <span>{formatCurrency(currentAmount, currency)}/mo</span>
                    </div>

                    {/* Fee Row: Hidden if Owner absorbs, OR visible if Owner is viewing to show context */}
                    {(subscriberPaysFee || isOwner) && (
                        <div style={{
                            display: 'flex', justifyContent: 'space-between', marginBottom: 8,
                            opacity: subscriberPaysFee ? 0.7 : 0.4,
                            textDecoration: !subscriberPaysFee ? 'line-through' : 'none'
                        }}>
                            <span>Service Fee {!subscriberPaysFee && '(Absorbed)'}</span>
                            <span>+{formatCurrency(feePreview.serviceFee, currency)}</span>
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 15 }}>
                        <span style={{ fontWeight: 'bold', fontSize: 14, textTransform: 'uppercase' }}>Total Due</span>
                        <div style={{ fontWeight: 'bold', fontSize: 24, letterSpacing: -1 }}>{formatCurrency(total, currency)}</div>
                    </div>

                    {/* OWNER CONTROLS: Fee Toggle */}
                    {isOwner && (
                        <div style={{ marginTop: 15, padding: 10, background: '#f5f5f5', borderRadius: 8, fontSize: 11 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>Fee Mode:</span>
                                <button
                                    onClick={handleFeeToggle} disabled={isSettingsLoading}
                                    style={{
                                        border: 'none', background: 'white', padding: '4px 8px', borderRadius: 4,
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)', cursor: 'pointer', fontWeight: 'bold'
                                    }}
                                >
                                    {feeMode === 'absorb' ? 'I Absorb' : 'User Pays'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div style={{ borderBottom: '1px dashed #ccc', marginBottom: 25 }} />

                {/* Email Input (If not owner) */}
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
                            type="email" placeholder="user@example.com" value={subscriberEmail}
                            onChange={e => setSubscriberEmail(e.target.value)}
                            onFocus={() => setEmailFocused(true)} onBlur={() => setEmailFocused(false)}
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

                {/* Slider (If not owner) vs Share (If owner) */}
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
                    ) : (
                        isReadyToPay ? (
                            <SlideToPay
                                key={resetKey} // Force remount on error
                                onComplete={handleSubscribe}
                                disabled={!isValidEmail || status === 'processing'}
                            />
                        ) : (
                            <div style={{
                                width: '100%', height: 48, background: '#f3f4f6', color: '#9ca3af',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                fontSize: 13, fontWeight: 500, borderRadius: 0, border: '1px solid #e5e7eb'
                            }}>
                                <AlertCircle size={16} /> Payments Unavailable
                            </div>
                        )
                    )}
                </div>

                {/* Footer */}
                <div style={{ marginTop: 20, textAlign: 'center', opacity: 0.8 }}>
                    <div style={{ fontSize: 9, marginBottom: 12, letterSpacing: 1.5, textTransform: 'uppercase' }}>Powered By</div>
                    <img src="/logo.svg" alt="NatePay" style={{ height: 28 }} />
                    <div style={{ marginTop: 15, fontSize: 9, opacity: 0.6 }}>
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
                    <h2 style={{ fontSize: 24, fontWeight: 'bold' }}>Payment Complete</h2>
                    <p style={{ opacity: 0.6, marginTop: 10 }}>Receipt sent to {subscriberEmail || 'your email'}</p>
                    <button
                        onClick={() => { setStatus('idle'); setMount(false); setTimeout(() => setMount(true), 100); navigate(0); }}
                        style={{ marginTop: 30, textDecoration: 'underline', opacity: 0.6, border: 'none', background: 'transparent', cursor: 'pointer' }}
                    >
                        Start New
                    </button>
                    <div style={{ marginTop: 40, opacity: 0.5 }}>
                        <img src="/logo.svg" alt="NatePay" style={{ height: 24 }} />
                    </div>
                </div>
            )}
        </div>
    )
}
