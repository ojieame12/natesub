import { useRef, useEffect, useLayoutEffect, useState, useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import {
    useOnboardingStore,
    useShallow,
    type OnboardingStepKey,
    getVisibleStepKeys,
    stepKeyToIndex,
    stepIndexToKey,
} from './store'
import { useAuthState } from '../hooks/useAuthState'
import { shouldSkipAddressStep } from '../utils/constants'
import StartStep from './StartStep'
import EmailStep from './EmailStep'
import OtpStep from './OtpStep'
import IdentityStep from './IdentityStep'
import AddressStep from './AddressStep'
import PurposeStep from './PurposeStep'
import AvatarUploadStep from './AvatarUploadStep'
import PersonalUsernameStep from './PersonalUsernameStep'
import PaymentMethodStep from './PaymentMethodStep'
import ServiceDescriptionStep from './ServiceDescriptionStep'
import AIGeneratingStep from './AIGeneratingStep'
import PersonalReviewStep from './PersonalReviewStep'
import './onboarding.css'

// Lightweight shell shown while waiting for auth/hydration
// Prevents flash of step 0 on reload for returning users
function ResumingShell() {
    return (
        <div className="onboarding-wrapper">
            <div className="onboarding-resuming">
                <img src="/logo.svg" alt="NatePay" className="resuming-logo" />
            </div>
        </div>
    )
}

// Map step keys to components
const STEP_COMPONENTS: Record<OnboardingStepKey, React.ReactElement> = {
    'start': <StartStep key="start" />,
    'email': <EmailStep key="email" />,
    'otp': <OtpStep key="otp" />,
    'identity': <IdentityStep key="identity" />,
    'address': <AddressStep key="address" />,
    'purpose': <PurposeStep key="purpose" />,
    'avatar': <AvatarUploadStep key="avatar" />,
    'username': <PersonalUsernameStep key="username" />,
    'payments': <PaymentMethodStep key="payments" />,
    'service-desc': <ServiceDescriptionStep key="service-desc" />,
    'ai-gen': <AIGeneratingStep key="ai-gen" />,
    'review': <PersonalReviewStep key="review" />,
}

export default function OnboardingFlow() {
    const location = useLocation()
    const { onboarding, status } = useAuthState()

    // Extract primitives from onboarding to prevent object reference issues in useEffect deps
    const onboardingStep = onboarding?.step ?? null
    const onboardingData = onboarding?.data ?? null
    const onboardingStepKey = onboardingData?.stepKey as OnboardingStepKey | undefined

    // Use useShallow to prevent re-renders when unrelated store values change
    const { currentStep, currentStepKey, countryCode, purpose, hydrateFromServer, goToStepKey } = useOnboardingStore(
        useShallow((s) => ({
            currentStep: s.currentStep,
            currentStepKey: s.currentStepKey,
            countryCode: s.countryCode,
            purpose: s.purpose,
            hydrateFromServer: s.hydrateFromServer,
            goToStepKey: s.goToStepKey,
        }))
    )
    const [animState, setAnimState] = useState<{ direction: 'forward' | 'back'; isAnimating: boolean }>({
        direction: 'forward',
        isAnimating: false,
    })
    // Track if we're ready to render (prevents flash of step 0 on reload)
    const [isReadyToRender, setIsReadyToRender] = useState(false)
    const prevStepRef = useRef(currentStep)
    const hasHydratedFromServer = useRef(false)
    const lastAppliedUrlStep = useRef<string | null>(null)
    const shouldSkipNextAnimation = useRef(false)

    // Determine if we should show the address step based on country
    // Use server data as fallback before store is hydrated
    const effectiveCountryCode = countryCode || onboardingData?.countryCode
    const showAddressStep = effectiveCountryCode && !shouldSkipAddressStep(effectiveCountryCode)

    // Check if this is service mode (requires AI generation steps)
    // Use server data as fallback to avoid chicken-and-egg problem
    // where store has 'support' but server has 'service'
    const effectivePurpose = purpose || onboardingData?.purpose
    const isServiceMode = effectivePurpose === 'service'

    // Step configuration for utility functions
    const stepConfig = useMemo(() => ({
        showAddressStep: !!showAddressStep,
        isServiceMode,
    }), [showAddressStep, isServiceMode])

    // Get visible step keys based on current configuration
    const visibleStepKeys = useMemo(() => getVisibleStepKeys(stepConfig), [stepConfig])

    // Build steps array from visible keys
    const steps = useMemo(() =>
        visibleStepKeys.map(key => STEP_COMPONENTS[key]),
        [visibleStepKeys]
    )

    // Compute current step index from step key OR step index
    // nextStep/prevStep only update currentStep (index), so we must detect that case
    const effectiveStep = useMemo(() => {
        // First, compute what index the current key would give us
        const keyIndex = currentStepKey && currentStepKey !== 'start' && visibleStepKeys.includes(currentStepKey)
            ? stepKeyToIndex(currentStepKey, stepConfig)
            : -1

        // If currentStep differs from keyIndex, trust currentStep
        // This handles nextStep/prevStep which only update the index
        if (keyIndex >= 0 && currentStep !== keyIndex && currentStep >= 0 && currentStep < steps.length) {
            return currentStep
        }

        // If key is valid and in sync (or currentStep is out of range), use key
        if (keyIndex >= 0) {
            return keyIndex
        }

        // Fallback: use currentStep if valid
        if (currentStep >= 0 && currentStep < steps.length) {
            return currentStep
        }

        return 0
    }, [currentStepKey, currentStep, visibleStepKeys, stepConfig, steps.length])

    // Hydrate onboarding state from URL ?step= param or server state
    // Use useLayoutEffect to hydrate BEFORE first paint (prevents flash)
    useLayoutEffect(() => {
        // For unauthenticated users (fresh start), render immediately
        if (status === 'unauthenticated') {
            setIsReadyToRender(true)
            return
        }

        // Still checking auth - don't render yet
        if (status === 'checking' || status === 'unknown') {
            return
        }

        // Authenticated - hydrate from URL or server state before rendering
        const params = new URLSearchParams(location.search)
        const urlStep = params.get('step')

        // URL can contain either a step key (preferred) or numeric index (legacy)
        if (urlStep) {
            // Check if it's a valid step key
            const isStepKey = visibleStepKeys.includes(urlStep as OnboardingStepKey)

            if (isStepKey) {
                if (lastAppliedUrlStep.current !== urlStep) {
                    lastAppliedUrlStep.current = urlStep
                    shouldSkipNextAnimation.current = true
                    hydrateFromServer({
                        stepKey: urlStep as OnboardingStepKey,
                        step: stepKeyToIndex(urlStep as OnboardingStepKey, stepConfig),
                        data: onboardingData,
                    })
                }
            } else {
                // Legacy numeric step support
                const parsed = parseInt(urlStep, 10)
                if (!Number.isNaN(parsed) && lastAppliedUrlStep.current !== urlStep) {
                    lastAppliedUrlStep.current = urlStep
                    shouldSkipNextAnimation.current = true
                    const clampedStep = Math.min(Math.max(parsed, 0), steps.length - 1)
                    const stepKey = stepIndexToKey(clampedStep, stepConfig)
                    hydrateFromServer({
                        stepKey,
                        step: clampedStep,
                        data: onboardingData,
                    })
                }
            }
            setIsReadyToRender(true)
            return
        }

        // Hydrate from server state (resume flow)
        if (!hasHydratedFromServer.current && onboardingStep && onboardingStep > 0) {
            hasHydratedFromServer.current = true
            shouldSkipNextAnimation.current = true

            // Use server stepKey if available, otherwise map from numeric step
            if (onboardingStepKey && visibleStepKeys.includes(onboardingStepKey)) {
                // Server has valid step key - use it
                hydrateFromServer({
                    stepKey: onboardingStepKey,
                    step: stepKeyToIndex(onboardingStepKey, stepConfig),
                    data: onboardingData,
                })
            } else {
                // Fallback: map numeric step to safe key
                // Payment step is a safe fallback for out-of-bounds steps
                const paymentStepKey: OnboardingStepKey = 'payments'
                const safeStepKey = onboardingStep >= steps.length
                    ? paymentStepKey
                    : stepIndexToKey(onboardingStep, stepConfig)

                hydrateFromServer({
                    stepKey: safeStepKey,
                    step: stepKeyToIndex(safeStepKey, stepConfig),
                    data: onboardingData,
                })
            }
        }

        // Ready to render after hydration
        setIsReadyToRender(true)
    }, [location.search, status, onboardingStep, onboardingStepKey, onboardingData, hydrateFromServer, visibleStepKeys, stepConfig, steps.length])

    // Sync step key when effectiveStep changes (e.g., after nextStep/prevStep)
    // This keeps the step key in sync with navigation that uses indices
    useEffect(() => {
        const expectedKey = stepIndexToKey(effectiveStep, stepConfig)
        if (currentStepKey !== expectedKey) {
            goToStepKey(expectedKey)
        }
    }, [effectiveStep, stepConfig, currentStepKey, goToStepKey])

    // Step transitions (CSS-driven) - animate only on user navigation.
    // Uses single state update to prevent double renders
    useEffect(() => {
        const prevStep = prevStepRef.current
        if (prevStep === effectiveStep) return

        if (shouldSkipNextAnimation.current) {
            shouldSkipNextAnimation.current = false
            prevStepRef.current = effectiveStep
            return
        }

        // Single state update instead of two separate setters
        setAnimState({
            direction: effectiveStep > prevStep ? 'forward' : 'back',
            isAnimating: true,
        })
        prevStepRef.current = effectiveStep

        const timer = setTimeout(() => {
            setAnimState(prev => ({ ...prev, isAnimating: false }))
        }, 450)
        return () => clearTimeout(timer)
    }, [effectiveStep])

    const currentStepComponent = steps[effectiveStep] || <StartStep />

    // Progress bar logic
    const progress = Math.min(((effectiveStep + 1) / steps.length) * 100, 100)
    const showProgress = effectiveStep > 0 && effectiveStep < steps.length - 1

    // Show resuming shell while waiting for auth/hydration
    // This prevents the flash of step 0 on reload for returning users
    if (!isReadyToRender) {
        return <ResumingShell />
    }

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
                className={`onboarding-step-container ${animState.isAnimating ? `slide-${animState.direction}` : ''}`}
                key={effectiveStep}
            >
                {currentStepComponent}
            </div>
        </div>
    )
}
