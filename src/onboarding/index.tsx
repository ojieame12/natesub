import { useOnboardingStore } from './store'
import StartStep from './StartStep'
import EmailStep from './EmailStep'
import OtpStep from './OtpStep'
import IdentityStep from './IdentityStep'
import BranchSelectorStep from './BranchSelectorStep'
import PersonalPricingStep from './PersonalPricingStep'
// Skipped for streamlined flow:
// - PurposeStep (implied by branch choice)
// - PricingModelStep (default to single tier)
// - ImpactItemsStep, PerksStep, PersonalAboutStep (AI handles for service, skip for personal)
// - PersonalReviewStep (user can edit from dashboard)
import PersonalUsernameStep from './PersonalUsernameStep'
import AvatarUploadStep from './AvatarUploadStep'
import PaymentMethodStep from './PaymentMethodStep'
import ServiceDescriptionStep from './ServiceDescriptionStep'
import AIGeneratingStep from './AIGeneratingStep'
import AIReviewStep from './AIReviewStep'

export default function OnboardingFlow() {
    const { currentStep, branch } = useOnboardingStore()

    // Step mapping depends on branch selection
    //
    // PERSONAL BRANCH (optimized - 9 steps total):
    // 0: StartStep
    // 1: EmailStep
    // 2: OtpStep
    // 3: IdentityStep
    // 4: BranchSelectorStep - choose personal vs service
    // 5: PersonalPricingStep - direct to price (skip purpose, default single tier)
    // 6: PersonalUsernameStep
    // 7: AvatarUploadStep
    // 8: PaymentMethodStep
    //
    // SERVICE BRANCH (11 steps total):
    // 0: StartStep
    // 1: EmailStep
    // 2: OtpStep
    // 3: IdentityStep
    // 4: BranchSelectorStep - choose personal vs service
    // 5: ServiceDescriptionStep - describe your service (text/voice)
    // 6: AIGeneratingStep - AI creates page
    // 7: AIReviewStep - review/edit AI output
    // 8: PersonalPricingStep - set price
    // 9: PersonalUsernameStep
    // 10: AvatarUploadStep
    // 11: PaymentMethodStep

    // Common steps (0-4)
    const commonSteps = [
        <StartStep key="start" />,
        <EmailStep key="email" />,
        <OtpStep key="otp" />,
        <IdentityStep key="identity" />,
        <BranchSelectorStep key="branch" />,
    ]

    // Personal branch - streamlined (no purpose, no pricing model, no review)
    // Purpose is implied by "Subscribe to Me" choice
    // Default to single price tier
    // User can edit everything from dashboard after launch
    const personalSteps = [
        <PersonalPricingStep key="pricing" />,
        <PersonalUsernameStep key="username" />,
        <AvatarUploadStep key="avatar" />,
        <PaymentMethodStep key="payment" />,
    ]

    // Service branch - AI-assisted setup
    const serviceSteps = [
        <ServiceDescriptionStep key="service-desc" />,
        <AIGeneratingStep key="ai-generating" />,
        <AIReviewStep key="ai-review" />,
        <PersonalPricingStep key="pricing" />,
        <PersonalUsernameStep key="username" />,
        <AvatarUploadStep key="avatar" />,
        <PaymentMethodStep key="payment" />,
    ]

    // Build the appropriate steps array based on branch
    const getSteps = () => {
        if (currentStep < 5) {
            // Haven't reached branch selection yet
            return commonSteps
        }

        if (branch === 'service') {
            return [...commonSteps, ...serviceSteps]
        }

        // Default to personal (or if branch not selected yet)
        return [...commonSteps, ...personalSteps]
    }

    const steps = getSteps()

    return steps[currentStep] || <StartStep />
}
