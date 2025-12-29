import { useState, useCallback, useMemo, useRef } from 'react'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { InlineError } from '../components'
import { useRequestMagicLink } from '../api/hooks'
import '../Dashboard.css'
import './onboarding.css'

// Email regex - defined outside component to avoid recreation
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function EmailStep() {
    // Use selectors to prevent unnecessary re-renders
    const email = useOnboardingStore((s) => s.email)
    const setEmail = useOnboardingStore((s) => s.setEmail)
    const navigateToStep = useOnboardingStore((s) => s.navigateToStep)
    const prevStep = useOnboardingStore((s) => s.prevStep)

    const [isSending, setIsSending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const isSubmitting = useRef(false) // Prevent double-submit

    const { mutateAsync: sendMagicLink } = useRequestMagicLink()

    // Memoize validation
    const isValidEmail = useMemo(() => EMAIL_REGEX.test(email), [email])

    const handleContinue = useCallback(async () => {
        if (!isValidEmail || isSending || isSubmitting.current) return

        isSubmitting.current = true
        setIsSending(true)
        setError(null)

        try {
            const normalizedEmail = email.trim().toLowerCase()
            await sendMagicLink(normalizedEmail)
            setEmail(normalizedEmail)
            // Use atomic navigation - bypasses debounce and ensures both step key
            // and index are updated together for reliable step transitions
            navigateToStep('otp')
        } catch (err: any) {
            setError(err?.error || 'Failed to send code. Please try again.')
        } finally {
            setIsSending(false)
            isSubmitting.current = false
        }
    }, [isValidEmail, isSending, email, sendMagicLink, setEmail, navigateToStep])

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
                    <h1>What's your email?</h1>
                    <p>We'll send you a code to verify.</p>
                </div>

                <div className="step-body">
                    <input
                        className={`input ${error ? 'input-error' : ''}`}
                        type="email"
                        value={email}
                        onChange={useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
                            setEmail(e.target.value)
                            setError(null)
                        }, [setEmail])}
                        placeholder="email@example.com"
                        autoFocus
                        disabled={isSending}
                        onKeyDown={useCallback((e: React.KeyboardEvent) => {
                            if (e.key === 'Enter') handleContinue()
                        }, [handleContinue])}
                    />
                    {error && <InlineError message={error} />}
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={handleContinue}
                        disabled={!isValidEmail || isSending}
                    >
                        {isSending ? (
                            <>
                                <Loader2 size={18} className="spin" style={{ marginRight: 8 }} />
                                Sending code...
                            </>
                        ) : (
                            'Continue'
                        )}
                    </Button>
                </div>
            </div>
        </div>
    )
}
