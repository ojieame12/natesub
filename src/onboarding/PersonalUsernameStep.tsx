import { useState, useEffect } from 'react'
import { ChevronLeft, Loader2, Check, X } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { useCheckUsername } from '../api/hooks'
import { PUBLIC_DOMAIN } from '../utils/constants'
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
    const { data: availabilityData, isLoading: isChecking, isError, refetch } = useCheckUsername(debouncedUsername)

    const isFormatValid = username.length >= 3 && /^[a-z0-9_]+$/.test(username)
    const isAvailable = availabilityData?.available === true
    const isTaken = availabilityData?.available === false

    // Can continue only if format valid AND API confirms available (no errors)
    const canContinue = isFormatValid && isAvailable && !isChecking && !isError

    const renderStatusIcon = () => {
        if (!username || !isFormatValid) return null
        if (isChecking) return <Loader2 size={18} className="spin" style={{ color: 'var(--text-tertiary)' }} />
        if (isTaken) return <X size={18} style={{ color: 'var(--status-error)' }} />
        if (isAvailable) return <Check size={18} style={{ color: 'var(--status-success)' }} />
        return null
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
                    <h1>Claim your link</h1>
                    <p>This is your unique subscription page URL.</p>
                </div>

                <div className="step-body">
                    <div className={`username-wrapper ${isTaken ? 'input-error' : ''}`}>
                        <span className="username-prefix">{PUBLIC_DOMAIN}/</span>
                        <input
                            className="input"
                            value={username}
                            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20))}
                            placeholder="yourname"
                            maxLength={20}
                            autoFocus
                        />
                        <div className="username-status-icon">
                            {renderStatusIcon()}
                        </div>
                    </div>

                    {/* Helper text - unified styling, no layout shift */}
                    <div className="username-helper">
                        {username && !isFormatValid && (
                            <span className="username-helper-error">
                                3-20 characters, letters, numbers, or underscores only.
                            </span>
                        )}
                        {isFormatValid && isTaken && (
                            <span className="username-helper-error">
                                This username is already taken.
                            </span>
                        )}
                        {isFormatValid && isAvailable && (
                            <span className="username-helper-success">
                                ✓ Available
                            </span>
                        )}
                        {isFormatValid && !isChecking && isError && (
                            <span className="username-helper-error">
                                Couldn't check availability. <Pressable onClick={() => refetch()} style={{ display: 'inline' }}><span style={{ fontWeight: 600, textDecoration: 'underline' }}>Retry</span></Pressable>
                            </span>
                        )}
                    </div>
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
