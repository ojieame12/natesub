import { useRef, useEffect, useState, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useOnboardingStore } from './store'
import { useAuthState } from '../hooks/useAuthState'
import StartStep from './StartStep'
import EmailStep from './EmailStep'
import OtpStep from './OtpStep'
import IdentityStep from './IdentityStep'
import AddressStep from './AddressStep'
import PersonalUsernameStep from './PersonalUsernameStep'
import PaymentMethodStep from './PaymentMethodStep'
import PersonalReviewStep from './PersonalReviewStep'
import './onboarding.css'

// Countries where we skip address collection (cross-border recipients have simpler verification)
const SKIP_ADDRESS_COUNTRIES = ['NG', 'GH', 'KE']

export default function OnboardingFlow() {
    const location = useLocation()
    const { onboarding, status } = useAuthState()
    const { currentStep, countryCode, hydrateFromServer } = useOnboardingStore()
    const [direction, setDirection] = useState<'forward' | 'back'>('forward')
    const [isAnimating, setIsAnimating] = useState(false)
    const prevStepRef = useRef(currentStep)
    const hasHydratedFromServer = useRef(false)
    const lastAppliedUrlStep = useRef<number | null>(null)
    const shouldSkipNextAnimation = useRef(false)

    // Determine if we should show the address step based on country
    const showAddressStep = countryCode && !SKIP_ADDRESS_COUNTRIES.includes(countryCode)

    // "Naked Onboarding" Steps - dynamically include AddressStep for non-cross-border countries
    const steps = useMemo(() => {
        const baseSteps = [
            <StartStep key="start" />,
            <EmailStep key="email" />,
            <OtpStep key="otp" />,
            <IdentityStep key="identity" />,
        ]

        // Add address step only for non-cross-border countries (US, UK, EU, etc.)
        if (showAddressStep) {
            baseSteps.push(<AddressStep key="address" />)
        }

        baseSteps.push(
            <PersonalUsernameStep key="username" />,
            <PaymentMethodStep key="payments" />,
            <PersonalReviewStep key="review" />
        )

        return baseSteps
    }, [showAddressStep])

    // Hydrate onboarding state from URL ?step= param or server state
    useEffect(() => {
        if (status !== 'authenticated') return

        const params = new URLSearchParams(location.search)
        const urlStep = params.get('step')

        if (urlStep) {
            const parsed = parseInt(urlStep, 10)
            if (!Number.isNaN(parsed) && lastAppliedUrlStep.current !== parsed) {
                lastAppliedUrlStep.current = parsed
                shouldSkipNextAnimation.current = true
                const clampedStep = Math.min(Math.max(parsed, 0), steps.length - 1)
                hydrateFromServer({
                    step: clampedStep,
                    branch: onboarding?.branch || null,
                    data: onboarding?.data,
                })
            }
            return
        }

        if (hasHydratedFromServer.current) return

        if (onboarding?.step && onboarding.step > 0 && currentStep === 0) {
            hasHydratedFromServer.current = true
            shouldSkipNextAnimation.current = true
            // Map old/out-of-bounds steps to the Username step (index 4) so they can review before creating
            const safeStep = onboarding.step >= steps.length ? 4 : onboarding.step

            hydrateFromServer({
                step: safeStep,
                branch: onboarding.branch || null,
                data: onboarding.data,
            })
        }
    }, [location.search, status, onboarding, currentStep, hydrateFromServer])

    // Step transitions (CSS-driven) - animate only on user navigation.
    useEffect(() => {
        const prevStep = prevStepRef.current
        if (prevStep === currentStep) return

        if (shouldSkipNextAnimation.current) {
            shouldSkipNextAnimation.current = false
            prevStepRef.current = currentStep
            return
        }

        setDirection(currentStep > prevStep ? 'forward' : 'back')
        setIsAnimating(true)
        prevStepRef.current = currentStep

        const timer = setTimeout(() => setIsAnimating(false), 450)
        return () => clearTimeout(timer)
    }, [currentStep])

    const currentStepComponent = steps[currentStep] || <StartStep />

    // Progress bar logic
    const progress = Math.min(((currentStep + 1) / steps.length) * 100, 100)
    const showProgress = currentStep > 0 && currentStep < steps.length - 1

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
