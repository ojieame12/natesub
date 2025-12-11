import { ChevronLeft } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import '../Dashboard.css'
import './onboarding.css'

export default function EmailStep() {
    const { email, setEmail, nextStep, prevStep } = useOnboardingStore()

    const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

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
                        className="input"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="email@example.com"
                        autoFocus
                    />
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={nextStep}
                        disabled={!isValidEmail}
                    >
                        Continue
                    </Button>
                </div>
            </div>
        </div>
    )
}
