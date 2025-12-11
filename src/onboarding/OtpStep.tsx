import { useRef, useEffect, useState } from 'react'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Pressable } from './components'
import { useVerifyMagicLink, useRequestMagicLink } from '../api/hooks'
import '../Dashboard.css'
import './onboarding.css'

export default function OtpStep() {
    const { otp, setOtp, nextStep, prevStep, email } = useOnboardingStore()
    const inputRefs = useRef<(HTMLInputElement | null)[]>([])
    const [error, setError] = useState<string | null>(null)
    const [isVerifying, setIsVerifying] = useState(false)
    const [resendCooldown, setResendCooldown] = useState(0)

    const { mutateAsync: verifyCode } = useVerifyMagicLink()
    const { mutateAsync: resendCode } = useRequestMagicLink()

    const digits = otp.split('').concat(Array(6 - otp.length).fill(''))

    // Verify OTP when 6 digits entered
    useEffect(() => {
        if (otp.length === 6 && !isVerifying) {
            verifyOtp()
        }
    }, [otp])

    // Resend cooldown timer
    useEffect(() => {
        if (resendCooldown > 0) {
            const timer = setTimeout(() => setResendCooldown(c => c - 1), 1000)
            return () => clearTimeout(timer)
        }
    }, [resendCooldown])

    const verifyOtp = async () => {
        setIsVerifying(true)
        setError(null)
        try {
            await verifyCode(otp)
            nextStep()
        } catch (err: any) {
            setError(err?.error || 'Invalid code. Please try again.')
            setOtp('') // Clear for retry
            inputRefs.current[0]?.focus()
        } finally {
            setIsVerifying(false)
        }
    }

    const handleResend = async () => {
        if (resendCooldown > 0) return
        setError(null)
        try {
            await resendCode(email)
            setResendCooldown(60) // 60 second cooldown
        } catch (err: any) {
            setError(err?.error || 'Failed to resend. Try again.')
        }
    }

    const handleChange = (index: number, value: string) => {
        if (!/^\d*$/.test(value)) return
        const newOtp = otp.split('')
        newOtp[index] = value.slice(-1)
        setOtp(newOtp.join('').slice(0, 6))
        if (value && index < 5) inputRefs.current[index + 1]?.focus()
    }

    const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
        if (e.key === 'Backspace' && !digits[index] && index > 0) {
            inputRefs.current[index - 1]?.focus()
        }
    }

    // Handle paste - fill all 6 digits at once
    const handlePaste = (e: React.ClipboardEvent) => {
        e.preventDefault()
        const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
        if (pastedData.length > 0) {
            setOtp(pastedData)
            // Focus the last filled input or the next empty one
            const focusIndex = Math.min(pastedData.length, 5)
            inputRefs.current[focusIndex]?.focus()
        }
    }

    return (
        <div className="onboarding">
            <div className="onboarding-logo-header">
                <img src="/logo.svg" alt="NatePay" />
            </div>
            <div className="onboarding-header">
                <Pressable className="onboarding-back" onClick={prevStep}>
                    <ChevronLeft size={24} />
                </Pressable>
            </div>

            <div className="onboarding-content">
                <div className="step-header">
                    <h1>Enter the code</h1>
                    <p>We sent a 6-digit code to {email}</p>
                </div>

                <div className="step-body">
                    <div className="otp-container">
                        {digits.map((digit, i) => (
                            <input
                                key={i}
                                ref={(el) => { inputRefs.current[i] = el }}
                                type="text"
                                inputMode="numeric"
                                maxLength={1}
                                value={digit}
                                onChange={(e) => handleChange(i, e.target.value)}
                                onKeyDown={(e) => handleKeyDown(i, e)}
                                onPaste={handlePaste}
                                className={`otp-digit ${error ? 'otp-digit-error' : ''}`}
                                autoFocus={i === 0}
                                disabled={isVerifying}
                            />
                        ))}
                    </div>

                    {isVerifying && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 }}>
                            <Loader2 size={16} className="spin" />
                            <span style={{ color: 'var(--text-secondary)', fontSize: 14 }}>Verifying...</span>
                        </div>
                    )}

                    {error && (
                        <p style={{ fontSize: 14, color: 'var(--status-error)', textAlign: 'center', marginTop: 16 }}>
                            {error}
                        </p>
                    )}

                    <div style={{ textAlign: 'center', marginTop: 24 }}>
                        <Pressable onClick={handleResend} disabled={resendCooldown > 0}>
                            <span style={{ color: 'var(--text-secondary)', fontSize: 15 }}>
                                Didn't get a code?{' '}
                                <span style={{ color: resendCooldown > 0 ? 'var(--text-tertiary)' : 'var(--text-primary)', fontWeight: 600 }}>
                                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend'}
                                </span>
                            </span>
                        </Pressable>
                    </div>
                </div>
            </div>
        </div>
    )
}
