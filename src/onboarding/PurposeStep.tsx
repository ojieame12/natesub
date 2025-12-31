import { useState } from 'react'
import { ChevronLeft, Heart, Gift, Briefcase, Star, Sparkles, Wallet, MoreHorizontal, Check, AlertCircle, Loader2 } from 'lucide-react'
import { useOnboardingStore, type SubscriptionPurpose } from './store'
import { Pressable } from './components'
import { useSaveOnboardingProgress } from '../api/hooks'
import './onboarding.css'

// Purpose options - same as PersonalReviewStep for consistency
const PURPOSE_OPTIONS: { value: SubscriptionPurpose; label: string; description: string; icon: React.ReactNode }[] = [
    { value: 'support', label: 'Support Me', description: 'Fans supporting your work', icon: <Heart size={24} /> },
    { value: 'service', label: 'Services', description: 'Coaching, consulting, retainers', icon: <Briefcase size={24} /> },
    { value: 'tips', label: 'Tips', description: 'Appreciation from followers', icon: <Gift size={24} /> },
    { value: 'exclusive_content', label: 'Exclusive Content', description: 'Behind-the-scenes, early access', icon: <Sparkles size={24} /> },
    { value: 'fan_club', label: 'Fan Club', description: 'Community membership', icon: <Star size={24} /> },
    { value: 'allowance', label: 'Allowance', description: 'Regular support from loved ones', icon: <Wallet size={24} /> },
    { value: 'other', label: 'Other', description: 'Something unique', icon: <MoreHorizontal size={24} /> },
]

export default function PurposeStep() {
    const { purpose, setPurpose, nextStep, prevStep, firstName, currentStep } = useOnboardingStore()
    const { mutateAsync: saveProgress } = useSaveOnboardingProgress()
    const [isSaving, setIsSaving] = useState(false)
    const [savingValue, setSavingValue] = useState<SubscriptionPurpose | null>(null)
    const [saveError, setSaveError] = useState<string | null>(null)

    const handleSelect = async (value: SubscriptionPurpose) => {
        // Block navigation until save succeeds
        setIsSaving(true)
        setSavingValue(value)
        setSaveError(null)
        setPurpose(value)

        try {
            // Persist purpose to backend for cross-device resume and step count calculation
            // Save NEXT step key so resume lands on the step user is going to
            await saveProgress({
                step: currentStep + 1,
                stepKey: 'avatar', // After purpose is always avatar
                data: { purpose: value },
            })
            // Only advance on success
            nextStep()
        } catch (err) {
            console.warn('[PurposeStep] Failed to save progress:', err)
            setSaveError('Failed to save. Please try again.')
        } finally {
            setIsSaving(false)
            setSavingValue(null)
        }
    }

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
                {saveError && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 14px',
                        background: '#FEE2E2',
                        borderRadius: 10,
                        marginBottom: 16,
                        fontSize: 13,
                        color: '#DC2626',
                    }}>
                        <AlertCircle size={18} />
                        <span>{saveError}</span>
                    </div>
                )}
                <div className="step-header">
                    <h1>What's this for?</h1>
                    <p>
                        {firstName ? `${firstName}, how` : 'How'} will people pay you?
                    </p>
                </div>

                <div className="step-body">
                    <div className="purpose-step-list" data-testid="purpose-list">
                        {PURPOSE_OPTIONS.map((option) => (
                            <Pressable
                                key={option.value}
                                className={`purpose-step-card ${purpose === option.value ? 'selected' : ''} ${isSaving ? 'disabled' : ''}`}
                                onClick={() => !isSaving && handleSelect(option.value)}
                                style={isSaving ? { opacity: savingValue === option.value ? 1 : 0.5, pointerEvents: 'none' } : undefined}
                                data-testid={`purpose-${option.value}`}
                            >
                                <span className="purpose-step-icon">{option.icon}</span>
                                <div className="purpose-step-text">
                                    <span className="purpose-step-label">{option.label}</span>
                                    <span className="purpose-step-desc">{option.description}</span>
                                </div>
                                {savingValue === option.value ? (
                                    <Loader2 size={20} className="spin purpose-step-check" />
                                ) : purpose === option.value && !isSaving ? (
                                    <Check size={20} className="purpose-step-check" />
                                ) : null}
                            </Pressable>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}
