import { useOnboardingStore } from './store'
import StartStep from './StartStep'
import EmailStep from './EmailStep'
import OtpStep from './OtpStep'
import IdentityStep from './IdentityStep'
import PurposeStep from './PurposeStep'
import PricingModelStep from './PricingModelStep'
import PersonalPricingStep from './PersonalPricingStep'
import ImpactItemsStep from './ImpactItemsStep'
import PerksStep from './PerksStep'
import PersonalAboutStep from './PersonalAboutStep'
import PersonalUsernameStep from './PersonalUsernameStep'
import AvatarUploadStep from './AvatarUploadStep'
import PaymentMethodStep from './PaymentMethodStep'
import PersonalReviewStep from './PersonalReviewStep'

export default function OnboardingFlow() {
    const { currentStep } = useOnboardingStore()

    // Step mapping:
    // 0: StartStep - Welcome screen
    // 1: EmailStep - Email input
    // 2: OtpStep - Verification code
    // 3: IdentityStep - Name, country
    // 4: PurposeStep - What's this subscription for?
    // 5: PricingModelStep - Single amount or tiers?
    // 6: PersonalPricingStep - Set prices
    // 7: ImpactItemsStep - How would it help you?
    // 8: PerksStep - What subscribers get
    // 9: PersonalAboutStep - Bio/about me
    // 10: PersonalUsernameStep - Choose username
    // 11: AvatarUploadStep - Profile photo
    // 12: PaymentMethodStep - Connect payment
    // 13: PersonalReviewStep - Review & launch

    const steps = [
        <StartStep key="start" />,
        <EmailStep key="email" />,
        <OtpStep key="otp" />,
        <IdentityStep key="identity" />,
        <PurposeStep key="purpose" />,
        <PricingModelStep key="pricing-model" />,
        <PersonalPricingStep key="pricing" />,
        <ImpactItemsStep key="impact" />,
        <PerksStep key="perks" />,
        <PersonalAboutStep key="about" />,
        <PersonalUsernameStep key="username" />,
        <AvatarUploadStep key="avatar" />,
        <PaymentMethodStep key="payment" />,
        <PersonalReviewStep key="review" />,
    ]

    return steps[currentStep] || <StartStep />
}
