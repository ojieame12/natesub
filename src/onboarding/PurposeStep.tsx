import { useState } from 'react'
import { ChevronLeft, Coins, Heart, Wallet, Users, Star, MoreHorizontal, Check } from 'lucide-react'
import { useOnboardingStore } from './store'
import type { SubscriptionPurpose } from './store'
import { Button, Pressable } from './components'
import './onboarding.css'

interface PurposeOption {
    type: SubscriptionPurpose
    title: string
    description: string
    icon: React.ReactNode
    color: string
}

const PURPOSE_OPTIONS: PurposeOption[] = [
    {
        type: 'tips',
        title: 'Tips & Appreciation',
        description: 'Fans showing gratitude',
        icon: <Coins size={22} />,
        color: '#f59e0b',
    },
    {
        type: 'support',
        title: 'Support Me',
        description: 'Help fund my work or passion',
        icon: <Heart size={22} />,
        color: '#ec4899',
    },
    {
        type: 'allowance',
        title: 'Allowance',
        description: 'Regular support from loved ones',
        icon: <Wallet size={22} />,
        color: '#10b981',
    },
    {
        type: 'fan_club',
        title: 'Fan Club',
        description: 'Exclusive community membership',
        icon: <Users size={22} />,
        color: '#8b5cf6',
    },
    {
        type: 'exclusive_content',
        title: 'Exclusive Content',
        description: 'Behind-the-scenes, early access',
        icon: <Star size={22} />,
        color: '#3b82f6',
    },
    {
        type: 'other',
        title: 'Something Else',
        description: 'A unique use case',
        icon: <MoreHorizontal size={22} />,
        color: '#6b7280',
    },
]

export default function PurposeStep() {
    const { purpose, setPurpose, nextStep, prevStep } = useOnboardingStore()
    const [selected, setSelected] = useState<SubscriptionPurpose | null>(purpose)

    const handleSelect = (type: SubscriptionPurpose) => {
        setSelected(type)
        setPurpose(type)
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
                <div className="step-header">
                    <h1>What's this subscription for?</h1>
                    <p>Pick what best describes your page</p>
                </div>

                <div className="step-body">
                    <div className="purpose-list">
                        {PURPOSE_OPTIONS.map((option) => {
                            const isSelected = selected === option.type
                            return (
                                <Pressable
                                    key={option.type}
                                    className={`purpose-card ${isSelected ? 'selected' : ''}`}
                                    onClick={() => handleSelect(option.type)}
                                >
                                    <div
                                        className="purpose-icon"
                                        style={{ backgroundColor: `${option.color}15`, color: option.color }}
                                    >
                                        {option.icon}
                                    </div>
                                    <div className="purpose-content">
                                        <span className="purpose-title">{option.title}</span>
                                        <span className="purpose-desc">{option.description}</span>
                                    </div>
                                    {isSelected && (
                                        <div className="purpose-check">
                                            <Check size={16} />
                                        </div>
                                    )}
                                </Pressable>
                            )
                        })}
                    </div>
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={nextStep}
                        disabled={!selected}
                    >
                        Continue
                    </Button>
                </div>
            </div>
        </div>
    )
}
