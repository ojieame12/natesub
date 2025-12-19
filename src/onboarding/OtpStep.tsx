import { useRef, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { InlineError } from '../components'
import { useVerifyMagicLink, useRequestMagicLink } from '../api/hooks'
import './onboarding.css'

export default function OtpStep() {
    const navigate = useNavigate()
    const { otp, setOtp, nextStep, prevStep, email, hydrateFromServer } = useOnboardingStore()
    const inputRefs = useRef<(HTMLInputElement | null)[]>([])
    const [error, setError] = useState<string | null>(null)
    const [success, setSuccess] = useState<string | null>(null)
    const [isVerifying, setIsVerifying] = useState(false)
    const [isResending, setIsResending] = useState(false)
    const [resendCooldown, setResendCooldown] = useState(0)
    const verifyInFlightRef = useRef(false)

    const { mutateAsync: verifyCode } = useVerifyMagicLink()
    const { mutateAsync: resendCode } = useRequestMagicLink()

    const OTP_LENGTH = 6
    const digits = otp.split('').concat(Array(OTP_LENGTH - otp.length).fill(''))
    const canVerify = otp.length === OTP_LENGTH && !isVerifying
    const hasAttemptedRef = useRef(false)

    // Auto-verify when all digits entered
    useEffect(() => {
        if (otp.length === OTP_LENGTH && !hasAttemptedRef.current) {
            verifyOtp()
        }
    }, [otp])

    // Reset attempt flag when OTP changes (user clearing/retyping)
    useEffect(() => {
        if (otp.length < OTP_LENGTH) {
            hasAttemptedRef.current = false
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
        const normalizedEmail = email.trim().toLowerCase()
        if (!normalizedEmail) {
            setError('Missing email. Please go back and try again.')
            return
        }
        if (otp.length !== OTP_LENGTH) return
        if (verifyInFlightRef.current) return
        verifyInFlightRef.current = true
        hasAttemptedRef.current = true
        setIsVerifying(true)
        setError(null)
        setSuccess(null)
        try {
            // Pass both OTP and email for security - prevents OTP collision attacks
            const result = await verifyCode({ otp, email: normalizedEmail })

            // Smart routing based on user state
            // If backend provides onboarding progress, hydrate store first
            if (result.onboardingStep && result.onboardingStep >= 3) {
                hydrateFromServer({
                    step: result.onboardingStep,
                    branch: result.onboardingBranch,
                    data: result.onboardingData,
                })
            }

            // Honor backend's redirectTo if provided (most reliable)
            if (result.redirectTo) {
                navigate(result.redirectTo, { replace: true })
            } else if (result.hasProfile && result.hasActivePayment) {
                // Fully set up - go to dashboard
                navigate('/dashboard', { replace: true })
            } else if (result.onboardingStep && result.onboardingStep >= 3) {
                // Has progress - stay in onboarding (store already hydrated above)
            } else if (result.hasProfile && !result.hasActivePayment) {
                // Profile exists but no payment - go to payment settings
                navigate('/settings/payments', { replace: true })
            } else {
                // Fresh user - continue to next step (identity)
                nextStep()
            }
        } catch (err: any) {
            const errorMsg = err?.error || 'Invalid code. Please try again.'
            const status = err?.status
            const normalizedError = errorMsg.toLowerCase()

            // Rate limit: keep the code so the user can retry once the limit resets.
            if (status === 429 || normalizedError.includes('too many') || normalizedError.includes('rate')) {
                setError('Too many attempts. Please wait a few minutes and try again.')
                return
            }

            // Improve error messages
            if (normalizedError.includes('expired')) {
                setError('This code has expired. Please click Resend to get a new code.')
            } else if (normalizedError.includes('no longer valid') || normalizedError.includes('already') || normalizedError.includes('used')) {
                setError('This code is no longer valid. Please click Resend to get a new code.')
            } else {
                setError(errorMsg)
            }
            setOtp('') // Clear for retry
            hasAttemptedRef.current = false // Allow retry
            inputRefs.current[0]?.focus()
        } finally {
            setIsVerifying(false)
            verifyInFlightRef.current = false
        }
    }

    const handleResend = async () => {
        if (resendCooldown > 0 || isResending) return
        setIsResending(true)
        setError(null)
        setSuccess(null)
        setOtp('') // Clear any old code
        try {
            const normalizedEmail = email.trim().toLowerCase()
            if (!normalizedEmail) {
                setError('Missing email. Please go back and try again.')
                return
            }
            await resendCode(normalizedEmail)
            setResendCooldown(60) // 60 second cooldown
            setSuccess('New code sent! Check your email.')
        } catch (err: any) {
            const errorMsg = err?.error || 'Failed to resend. Try again.'
            if (errorMsg.toLowerCase().includes('too many') || errorMsg.toLowerCase().includes('rate')) {
                setError('Too many requests. Please wait a minute before trying again.')
                setResendCooldown(60) // Force cooldown on rate limit
            } else {
                setError(errorMsg)
            }
        } finally {
            setIsResending(false)
        }
    }

    const handleChange = (index: number, value: string) => {
        if (!/^\d*$/.test(value)) return
        // Clear messages when user starts typing
        if (error) setError(null)
        if (success) setSuccess(null)
        const newOtp = otp.split('')
        newOtp[index] = value.slice(-1)
        setOtp(newOtp.join('').slice(0, OTP_LENGTH))
        if (value && index < OTP_LENGTH - 1) inputRefs.current[index + 1]?.focus()
    }

    const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
        if (e.key === 'Backspace' && !digits[index] && index > 0) {
            inputRefs.current[index - 1]?.focus()
        }
    }

    // Handle paste - fill all digits at once
    const handlePaste = (e: React.ClipboardEvent) => {
        e.preventDefault()
        const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH)
        if (pastedData.length > 0) {
            setOtp(pastedData)
            // Focus the last filled input or the next empty one
            const focusIndex = Math.min(pastedData.length, OTP_LENGTH - 1)
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

                    <div className="step-footer" style={{ marginTop: 24 }}>
                        <Button
                            variant="primary"
                            size="lg"
                            fullWidth
                            onClick={verifyOtp}
                            disabled={!canVerify}
                        >
                            {isVerifying ? (
                                <>
                                    <Loader2 size={18} className="spinning" />
                                    <span style={{ marginLeft: 8 }}>Verifying...</span>
                                </>
                            ) : (
                                'Verify'
                            )}
                        </Button>
                    </div>

                    {error && (
                        <InlineError
                            message={error}
                            style={{ marginTop: 16, justifyContent: 'center' }}
                        />
                    )}

                    {success && (
                        <p style={{ fontSize: 14, color: 'var(--status-success, #22c55e)', textAlign: 'center', marginTop: 16 }}>
                            {success}
                        </p>
                    )}

                    <div style={{ textAlign: 'center', marginTop: 24 }}>
                        <Pressable onClick={handleResend} disabled={resendCooldown > 0 || isResending || isVerifying}>
                            <span style={{ color: 'var(--text-secondary)', fontSize: 15 }}>
                                Didn't get a code?{' '}
                                <span style={{ color: (resendCooldown > 0 || isResending) ? 'var(--text-tertiary)' : 'var(--text-primary)', fontWeight: 600 }}>
                                    {isResending ? 'Sending...' : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend'}
                                </span>
                            </span>
                        </Pressable>
                    </div>
                </div>
            </div>
        </div>
    )
}
