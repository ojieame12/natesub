import { ChevronLeft } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import '../Dashboard.css'
import './onboarding.css'

export default function PersonalUsernameStep() {
    const { username, setUsername, nextStep, prevStep } = useOnboardingStore()

    const isValid = username.length >= 3 && /^[a-z0-9_]+$/.test(username)

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
                        <span className="username-prefix">nate.to/</span>
                        <input
                            className="input"
                            value={username}
                            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                            placeholder="yourname"
                            autoFocus
                        />
                    </div>
                    {username && !isValid && (
                        <p style={{ fontSize: 14, color: 'var(--accent-red)', marginTop: 8 }}>
                            At least 3 characters, letters, numbers, or underscores only
                        </p>
                    )}
                    {isValid && (
                        <p style={{ fontSize: 14, color: 'var(--accent-green)', marginTop: 8 }}>
                            ✓ nate.to/{username} is available!
                        </p>
                    )}
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={nextStep}
                        disabled={!isValid}
                    >
                        Continue
                    </Button>
                </div>
            </div>
        </div>
    )
}
