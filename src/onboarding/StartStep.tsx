import { Mail, Apple } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button } from './components'
import '../Dashboard.css'
import './onboarding.css'

export default function StartStep() {
    const { nextStep } = useOnboardingStore()

    return (
        <div className="onboarding">
            <div className="onboarding-logo-header">
                <img src="/logo.svg" alt="NatePay" />
            </div>
            <div className="onboarding-content">
                <div className="start-step">

                    {/* Hero Image */}
                    <div className="start-hero">
                        <img
                            src="https://res.cloudinary.com/subframe/image/upload/v1764688418/uploads/13740/qnujqsgnfu917a1ntav4.png"
                            alt="Hero"
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
                            <Button
                                variant="secondary"
                                size="lg"
                                icon={<Apple size={20} />}
                                fullWidth
                                onClick={() => console.log('Apple Sign In')}
                            >
                                Continue with Apple
                            </Button>
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
