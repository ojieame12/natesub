import { useState } from 'react'
import { Mail, RefreshCw } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button } from './components'
import '../Dashboard.css'
import './onboarding.css'

const HERO_IMAGE_URL = '/hero.png'

export default function StartStep() {
    // Use selector to prevent re-renders when other state changes
    const nextStep = useOnboardingStore((s) => s.nextStep)
    const reset = useOnboardingStore((s) => s.reset)
    const email = useOnboardingStore((s) => s.email)
    const name = useOnboardingStore((s) => s.name)
    const [imageLoaded, setImageLoaded] = useState(false)

    // Check if there's existing progress from a previous session
    const hasExistingProgress = Boolean(email || name)

    const handleStartOver = () => {
        reset()
        // Small delay to ensure state is cleared before proceeding
        setTimeout(nextStep, 50)
    }

    return (
        <div className="onboarding">
            <div className="onboarding-logo-header">
                <img src="/logo.svg" alt="NatePay" />
            </div>
            <div className="onboarding-content">
                <div className="start-step">

                    {/* Hero Image with loading state */}
                    <div className="start-hero">
                        {!imageLoaded && (
                            <div className="start-hero-placeholder" aria-hidden="true" />
                        )}
                        <img
                            src={HERO_IMAGE_URL}
                            alt="Hero"
                            onLoad={() => setImageLoaded(true)}
                            style={{ opacity: imageLoaded ? 1 : 0, transition: 'opacity 0.3s ease' }}
                        />
                    </div>

                    {/* Bottom section */}
                    <div className="start-bottom">
                        <div className="start-text">
                            <h1>Own your<br />recurring income.</h1>
                            <p>No invoices. No chasing. Just recurring payments from the people who value you.</p>
                        </div>

                        <div className="start-buttons">
                            <Button
                                variant="primary"
                                size="lg"
                                icon={<Mail size={20} />}
                                fullWidth
                                onClick={nextStep}
                            >
                                Continue with email
                            </Button>

                            {/* Show Start Over option if there's existing progress */}
                            {hasExistingProgress && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    icon={<RefreshCw size={16} />}
                                    onClick={handleStartOver}
                                >
                                    Start over
                                </Button>
                            )}
                        </div>

                        {/* Subtle legal text */}
                        <p className="start-legal">
                            By continuing, you agree to our{' '}
                            <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>
                            {' '}and{' '}
                            <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
