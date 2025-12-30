import { useState } from 'react'
import { ChevronLeft, Heart, Gift, Briefcase, Star, Sparkles, Wallet, MoreHorizontal, Check, AlertCircle } from 'lucide-react'
import { useOnboardingStore, type SubscriptionPurpose } from './store'
import { Pressable } from './components'
import { api } from '../api'
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
    const [saveWarning, setSaveWarning] = useState(false)

    const handleSelect = (value: SubscriptionPurpose) => {
        setPurpose(value)

        // Persist purpose to backend for cross-device resume and step count calculation
        // Local store is primary, backend is for durability
        // Save NEXT step key so resume lands on the step user is going to
        api.auth.saveOnboardingProgress({
            step: currentStep + 1,
            stepKey: 'avatar', // After purpose is always avatar
            data: { purpose: value },
        }).catch((err) => {
            console.warn('[onboarding] Failed to save purpose:', err)
            setSaveWarning(true)
        })

        nextStep()
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
                {saveWarning && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 14px',
                        background: '#FEF3C7',
                        borderRadius: 10,
                        marginBottom: 16,
                        fontSize: 13,
                        color: '#92400E',
                    }}>
                        <AlertCircle size={18} />
                        <span>Your progress may not sync across devices. Complete setup on this device.</span>
                    </div>
                )}
                <div className="step-header">
                    <h1>What's this for?</h1>
                    <p>
                        {firstName ? `${firstName}, how` : 'How'} will people pay you?
                    </p>
                </div>

                <div className="step-body">
                    <div className="purpose-step-list">
                        {PURPOSE_OPTIONS.map((option) => (
                            <Pressable
                                key={option.value}
                                className={`purpose-step-card ${purpose === option.value ? 'selected' : ''}`}
                                onClick={() => handleSelect(option.value)}
                            >
                                <span className="purpose-step-icon">{option.icon}</span>
                                <div className="purpose-step-text">
                                    <span className="purpose-step-label">{option.label}</span>
                                    <span className="purpose-step-desc">{option.description}</span>
                                </div>
                                {purpose === option.value && (
                                    <Check size={20} className="purpose-step-check" />
                                )}
                            </Pressable>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}
