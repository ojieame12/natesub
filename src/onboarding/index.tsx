import { useRef, useEffect, useState } from 'react'
import { useOnboardingStore } from './store'
import StartStep from './StartStep'
import EmailStep from './EmailStep'
import OtpStep from './OtpStep'
import IdentityStep from './IdentityStep'
import BranchSelectorStep from './BranchSelectorStep'
import PersonalPricingStep from './PersonalPricingStep'
import PersonalUsernameStep from './PersonalUsernameStep'
import AvatarUploadStep from './AvatarUploadStep'
import VoiceIntroStep from './VoiceIntroStep'
import PaymentMethodStep from './PaymentMethodStep'
import ServiceDescriptionStep from './ServiceDescriptionStep'
import AIGeneratingStep from './AIGeneratingStep'
import AIReviewStep from './AIReviewStep'
import './onboarding.css'

// Step configuration for progress tracking
const COMMON_STEP_COUNT = 5  // Start, Email, OTP, Identity, Branch
const PERSONAL_STEP_COUNT = 5  // Pricing, Username, Avatar, VoiceIntro, Payment
const SERVICE_STEP_COUNT = 8  // Description, AI Gen, AI Review, Pricing, Username, Avatar, VoiceIntro, Payment

export default function OnboardingFlow() {
    const { currentStep, branch } = useOnboardingStore()
    const [direction, setDirection] = useState<'forward' | 'back'>('forward')
    const [isAnimating, setIsAnimating] = useState(false)
    const prevStepRef = useRef(currentStep)

    // Track direction of navigation
    useEffect(() => {
        if (currentStep > prevStepRef.current) {
            setDirection('forward')
        } else if (currentStep < prevStepRef.current) {
            setDirection('back')
        }
        setIsAnimating(true)
        const timer = setTimeout(() => setIsAnimating(false), 300)
        prevStepRef.current = currentStep
        return () => clearTimeout(timer)
    }, [currentStep])

    // Calculate total steps based on branch
    const getTotalSteps = () => {
        if (currentStep < COMMON_STEP_COUNT) {
            // Before branch selection, assume personal (shorter)
            return COMMON_STEP_COUNT + PERSONAL_STEP_COUNT
        }
        return branch === 'service'
            ? COMMON_STEP_COUNT + SERVICE_STEP_COUNT
            : COMMON_STEP_COUNT + PERSONAL_STEP_COUNT
    }

    // Calculate progress percentage
    const totalSteps = getTotalSteps()
    const progress = Math.min(((currentStep + 1) / totalSteps) * 100, 100)

    // Don't show progress on start screen
    const showProgress = currentStep > 0

    // Common steps (0-4)
    const commonSteps = [
        <StartStep key="start" />,
        <EmailStep key="email" />,
        <OtpStep key="otp" />,
        <IdentityStep key="identity" />,
        <BranchSelectorStep key="branch" />,
    ]

    // Personal branch steps
    const personalSteps = [
        <PersonalPricingStep key="pricing" />,
        <PersonalUsernameStep key="username" />,
        <AvatarUploadStep key="avatar" />,
        <VoiceIntroStep key="voice" />,
        <PaymentMethodStep key="payment" />,
    ]

    // Service branch steps
    const serviceSteps = [
        <ServiceDescriptionStep key="service-desc" />,
        <AIGeneratingStep key="ai-generating" />,
        <AIReviewStep key="ai-review" />,
        <PersonalPricingStep key="pricing" />,
        <PersonalUsernameStep key="username" />,
        <AvatarUploadStep key="avatar" />,
        <VoiceIntroStep key="voice" />,
        <PaymentMethodStep key="payment" />,
    ]

    // Build steps array
    const getSteps = () => {
        if (currentStep < COMMON_STEP_COUNT) {
            return commonSteps
        }
        if (branch === 'service') {
            return [...commonSteps, ...serviceSteps]
        }
        return [...commonSteps, ...personalSteps]
    }

    const steps = getSteps()
    const currentStepComponent = steps[currentStep] || <StartStep />

    return (
        <div className="onboarding-wrapper">
            {/* Progress Bar */}
            {showProgress && (
                <div className="onboarding-progress">
                    <div
                        className="onboarding-progress-bar"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            )}

            {/* Step Content with Animation */}
            <div
                className={`onboarding-step-container ${isAnimating ? `slide-${direction}` : ''}`}
                key={currentStep}
            >
                {currentStepComponent}
            </div>
        </div>
    )
}
