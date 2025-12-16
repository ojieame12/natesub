
import { useState, useEffect, useRef } from 'react'
import { ArrowLeft, Check, ChevronsRight, Banknote, Briefcase } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

// Mock Profile Data
// "Launch my page" setup includes: Name, Avatar, Purpose, Price, Fee Mode (Absorb/Pass), Tiers
const PROFILE = {
    name: 'Jason K.',
    avatar: 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?w=200&q=80',
    amount: 5.50,
    type: 'personal', // 'personal' or 'service'
    currency: 'USD',
    // Added from "Launch" setup:
    feeMode: 'pass_to_subscriber' as 'absorb' | 'pass_to_subscriber',
    tierName: 'Supporter' // If Tiers are used
}

// Fee Constants
const FEE_RATES = {
    personal: 0.10,
    service: 0.08
}

// --- SLIDE BUTTON COMPONENT ---
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

    // Event Wrappers
    const onMouseDown = (e: React.MouseEvent) => handleStart(e.clientX)
    const onMouseMove = (e: React.MouseEvent) => handleMove(e.clientX)
    const onMouseUp = () => handleEnd()
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
            className="slide-track"
            style={{
                background: '#f1f1ee', // Neutral Light
                height: 48,
                position: 'relative',
                overflow: 'hidden',
                userSelect: 'none',
                touchAction: 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                border: '1px solid #e5e5e5',
            }}
            onMouseMove={isDragging ? onMouseMove : undefined}
        >
            {/* BRAND YELLOW FILL */}
            <div style={{
                position: 'absolute',
                left: 0, top: 0, bottom: 0,
                width: dragWidth + 44,
                background: 'linear-gradient(135deg, #FFD208 0%, #FF941A 100%)', // Brand Soft Gradient
                transition: isDragging ? 'none' : 'width 0.3s ease',
            }} />

            {/* Label */}
            <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: completed ? 'white' : '#666',
                fontWeight: 600, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase',
                pointerEvents: 'none',
                opacity: Math.max(0, 1 - (dragWidth / 100))
            }}>
                {completed ? 'AUTHORIZED' : 'SLIDE TO PAY'}
            </div>

            {/* Thumb - Sharp square */}
            <div
                onMouseDown={onMouseDown} onTouchStart={onTouchStart} onTouchMove={onTouchMove as any} onTouchEnd={onTouchEnd}
                style={{
                    height: 46, width: 44,
                    top: 0, left: 0, position: 'absolute',
                    background: completed ? 'white' : '#fff',
                    transform: `translateX(${dragWidth}px)`,
                    transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRight: '1px solid #e5e5e5',
                    zIndex: 2, cursor: 'grab',
                    // TRIGGER SHADOW (Deep)
                    boxShadow: '4px 0 15px rgba(0,0,0,0.1)'
                }}
            >
                {/* ANIMATED ICON */}
                <div style={{
                    animation: !completed ? 'slide-bounce 1.5s infinite' : 'none',
                    display: 'flex', alignItems: 'center'
                }}>
                    {completed ? <Check size={20} color="#10b981" /> : <ChevronsRight size={20} color="#333" />}
                </div>
            </div>

            <style>{`
                @keyframes slide-bounce {
                    0%, 100% { transform: translateX(0); }
                    50% { transform: translateX(3px); }
                }
            `}</style>
        </div>
    )
}

// --- MAIN COMPONENT ---
export default function ReceiptDesign() {
    const navigate = useNavigate()
    const [email, setEmail] = useState('')
    const [emailFocused, setEmailFocused] = useState(false)
    const [status, setStatus] = useState<'idle' | 'success'>('idle')
    const [mount, setMount] = useState(false)

    useEffect(() => { setMount(true) }, [])

    // Calculations based on Fee Mode logic from Launch Setup
    const rate = PROFILE.type === 'service' ? FEE_RATES.service : FEE_RATES.personal
    const rawFee = PROFILE.amount * rate

    // Fee Logic Parity:
    // If 'pass_to_subscriber': Subscriber pays Amount + Fee
    // If 'absorb': Subscriber pays Amount (Creator pays fee from that)
    const subscriberPaysFee = PROFILE.feeMode === 'pass_to_subscriber'
    const feeToDisplay = subscriberPaysFee ? rawFee : 0
    const total = PROFILE.amount + feeToDisplay

    // Styles
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

        // Jagged edge at bottom
        maskImage: `radial-gradient(circle at 10px calc(100% + 5px), transparent 12px, black 13px)`,
        WebkitMaskImage: `radial-gradient(circle at 10px calc(100% + 5px), transparent 12px, black 13px)`,
        WebkitMaskSize: '20px 100%', WebkitMaskPosition: '-10px 0', WebkitMaskRepeat: 'repeat-x',

        padding: '30px 24px 50px',

        // DEEP SHADOW (User requested "more shadow around the receipt" / "floaty")
        boxShadow: '0 30px 60px -15px rgba(0, 0, 0, 0.3)',

        // Animation
        transform: mount ? 'translateY(0)' : 'translateY(50px)',
        opacity: mount ? 1 : 0, transition: 'all 0.6s ease-out'
    }

    if (status === 'success') {
        receiptStyle.transform = 'translateY(150%) rotate(2deg)'
        receiptStyle.opacity = 0
        receiptStyle.transition = 'all 0.6s ease-in'
    }

    return (
        <div style={containerStyle}>
            {/* Noise Texture */}
            <div style={{ position: 'fixed', inset: 0, opacity: 0.03, pointerEvents: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }} />

            {/* Back Btn */}
            <div style={{ position: 'absolute', top: 20, left: 20, zIndex: 10 }}>
                <button
                    onClick={() => navigate('/payroll')}
                    style={{
                        background: 'rgba(255,255,255,0.8)', backdropFilter: 'blur(10px)',
                        border: '1px solid rgba(0,0,0,0.05)', borderRadius: '50%',
                        width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer'
                    }}
                >
                    <ArrowLeft size={20} color="#444" />
                </button>
            </div>

            {/* RECEIPT */}
            <div style={receiptStyle}>
                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: 30 }}>
                    <div style={{
                        position: 'relative', width: 72, height: 72, margin: '0 auto 20px'
                    }}>
                        <div style={{
                            width: '100%', height: '100%',
                            borderRadius: '50%',
                            backgroundImage: `url(${PROFILE.avatar})`, backgroundSize: 'cover',
                            filter: 'grayscale(100%) contrast(110%)', border: '1px solid #e5e5e5',
                            boxShadow: '0 4px 10px rgba(0,0,0,0.1)'
                        }} />
                    </div>

                    {/* Header */}
                    <div style={{ fontSize: 11, fontWeight: 'bold', letterSpacing: 1, textTransform: 'uppercase', color: '#999' }}>PAID TO</div>

                    {/* Name */}
                    <div style={{ fontSize: 22, fontWeight: 'bold', marginTop: 4 }}>{PROFILE.name.toUpperCase()}</div>

                    {/* Tag */}
                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
                        <div style={{
                            background: '#000', color: 'white',
                            padding: '3px 8px', borderRadius: 4,
                            fontSize: 10, fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 4,
                            letterSpacing: 0.5
                        }}>
                            {PROFILE.type === 'service' ? <Briefcase size={10} /> : <Banknote size={10} />}
                            {PROFILE.type === 'service' ? 'SERVICE' : 'TIPS'}
                        </div>
                    </div>


                </div>

                {/* Dashed Line */}
                <div style={{ borderBottom: '1px dashed #ccc', marginBottom: 25 }} />

                {/* Breakdown */}
                <div style={{ fontSize: 13, marginBottom: 25 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                        <span>Subscription</span>
                        <span>${PROFILE.amount.toFixed(2)}/mo</span>
                    </div>

                    {/* Fee Row: Only show if Subscriber Pays */}
                    {subscriberPaysFee && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, opacity: 0.7 }}>
                            <span>Service Fee ({(rate * 100).toFixed(0)}%)</span>
                            <span>+${rawFee.toFixed(2)}</span>
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 15 }}>
                        <span style={{ fontWeight: 'bold', fontSize: 14, textTransform: 'uppercase' }}>Total Due</span>
                        <div style={{ fontWeight: 'bold', fontSize: 24, letterSpacing: -1 }}>${total.toFixed(2)}</div>
                    </div>
                </div>

                {/* Dashed Line */}
                <div style={{ borderBottom: '1px dashed #ccc', marginBottom: 25 }} />

                {/* Email Input */}
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
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        onFocus={() => setEmailFocused(true)}
                        onBlur={() => setEmailFocused(false)}
                        style={{
                            width: '100%',
                            border: emailFocused ? '1px solid #000' : '1px solid #e0e0e0',
                            padding: '14px',
                            background: emailFocused ? '#fff' : '#f9f9f9',
                            fontFamily: 'inherit', fontSize: 14, outline: 'none', color: '#222',
                            borderRadius: 0,
                            // Focus Shadow -> Brand Glow
                            boxShadow: emailFocused ? '0 0 0 4px rgba(255, 148, 26, 0.1)' : 'inset 0 1px 3px rgba(0,0,0,0.02)',
                            transition: 'all 0.2s ease'
                        }}
                    />
                </div>

                {/* SLIDE TO PAY (SHADOW & COLOR) */}
                <div style={{ marginBottom: 35 }}>
                    <SlideToPay onComplete={() => setStatus('success')} disabled={!email} />
                </div>

                {/* Footer with BIG Logo */}
                <div style={{ marginTop: 20, textAlign: 'center', opacity: 0.8 }}>
                    <div style={{ fontSize: 9, marginBottom: 12, letterSpacing: 1.5, textTransform: 'uppercase' }}>Powered By</div>
                    {/* User asked for "Bigger a bit" - defaulting to 28px height */}
                    <img src="/logo.svg" alt="NatePay" style={{ height: 28 }} />

                    {/* Terms */}
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
                    <p style={{ opacity: 0.6, marginTop: 10 }}>Receipt sent to {email}</p>
                    <button
                        onClick={() => { setMount(false); setTimeout(() => navigate(0), 500); }}
                        style={{ marginTop: 30, textDecoration: 'underline', opacity: 0.6 }}
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
