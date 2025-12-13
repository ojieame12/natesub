import { useState, useEffect } from 'react'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { useCheckUsername } from '../api/hooks'
import '../Dashboard.css'
import './onboarding.css'

export default function PersonalUsernameStep() {
    const { username, setUsername, nextStep, prevStep } = useOnboardingStore()
    const [debouncedUsername, setDebouncedUsername] = useState(username)

    // Debounce username for API check
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedUsername(username)
        }, 500)
        return () => clearTimeout(timer)
    }, [username])

    // Check availability via API (only when 3+ chars)
    const { data: availabilityData, isLoading: isChecking } = useCheckUsername(debouncedUsername)

    const isFormatValid = username.length >= 3 && /^[a-z0-9_]+$/.test(username)
    const isAvailable = availabilityData?.available === true
    const isTaken = availabilityData?.available === false

    // Can continue only if format valid AND API confirms available
    const canContinue = isFormatValid && isAvailable && !isChecking

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
                    <h1>Claim your link</h1>
                    <p>This is your unique subscription page URL.</p>
                </div>

                <div className="step-body">
                    <div className="username-wrapper">
                        <span className="username-prefix">natepay.co/</span>
                        <input
                            className="input"
                            value={username}
                            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))}
                            placeholder="yourname"
                            maxLength={20}
                            autoFocus
                        />
                    </div>
                    {username && !isFormatValid && (
                        <p style={{ fontSize: 14, color: 'var(--status-error)', marginTop: 8 }}>
                            At least 3 characters, letters, numbers, or underscores only
                        </p>
                    )}
                    {isFormatValid && isChecking && (
                        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Loader2 size={14} className="spin" />
                            Checking availability...
                        </p>
                    )}
                    {isFormatValid && !isChecking && isAvailable && (
                        <p style={{ fontSize: 14, color: 'var(--status-success)', marginTop: 8 }}>
                            natepay.co/{username} is available
                        </p>
                    )}
                    {isFormatValid && !isChecking && isTaken && (
                        <p style={{ fontSize: 14, color: 'var(--status-error)', marginTop: 8 }}>
                            natepay.co/{username} is already taken
                        </p>
                    )}
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={nextStep}
                        disabled={!canContinue}
                    >
                        Continue
                    </Button>
                </div>
            </div>
        </div>
    )
}
