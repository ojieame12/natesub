import { ChevronLeft } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import '../Dashboard.css'
import './onboarding.css'

export default function PersonalAboutStep() {
    const { bio, setBio, nextStep, prevStep } = useOnboardingStore()

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
                    <h1>Tell us about yourself</h1>
                    <p>This will be shown on your subscription page.</p>
                </div>

                <div className="step-body">
                    <textarea
                        className="textarea"
                        value={bio}
                        onChange={(e) => setBio(e.target.value)}
                        placeholder="I'm a creator who..."
                        rows={5}
                    />
                    <p style={{ fontSize: 14, color: 'var(--text-tertiary)', textAlign: 'right' }}>
                        {bio.length}/280
                    </p>
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={nextStep}
                        disabled={!bio.trim()}
                    >
                        Continue
                    </Button>
                </div>
            </div>
        </div>
    )
}
