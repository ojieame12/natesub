import { useState } from 'react'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { useRequestMagicLink } from '../api/hooks'
import '../Dashboard.css'
import './onboarding.css'

export default function EmailStep() {
    const { email, setEmail, nextStep, prevStep } = useOnboardingStore()
    const [isSending, setIsSending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const { mutateAsync: sendMagicLink } = useRequestMagicLink()

    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

    const handleContinue = async () => {
        if (!isValidEmail || isSending) return

        setIsSending(true)
        setError(null)

        try {
            await sendMagicLink(email)
            nextStep()
        } catch (err: any) {
            setError(err?.error || 'Failed to send code. Please try again.')
        } finally {
            setIsSending(false)
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
                    <h1>What's your email?</h1>
                    <p>We'll send you a code to verify.</p>
                </div>

                <div className="step-body">
                    <input
                        className={`input ${error ? 'input-error' : ''}`}
                        type="email"
                        value={email}
                        onChange={(e) => {
                            setEmail(e.target.value)
                            setError(null)
                        }}
                        placeholder="email@example.com"
                        autoFocus
                        disabled={isSending}
                        onKeyDown={(e) => e.key === 'Enter' && handleContinue()}
                    />
                    {error && (
                        <p className="input-error-text">{error}</p>
                    )}
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
