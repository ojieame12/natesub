import { useState } from 'react'
import { ChevronLeft, User, Briefcase, Check } from 'lucide-react'
import { useOnboardingStore } from './store'
import type { BranchType } from './store'
import { Button, Pressable } from './components'
import './onboarding.css'

interface BranchOption {
    type: Exclude<BranchType, null>
    title: string
    description: string
    icon: React.ReactNode
}

const BRANCH_OPTIONS: BranchOption[] = [
    {
        type: 'personal',
        title: 'Subscribe to Me',
        description: 'Personal support, tips, allowance, anything',
        icon: <User size={24} />,
    },
    {
        type: 'service',
        title: 'Subscribe to My Service',
        description: 'Coaching, consulting, professional retainers',
        icon: <Briefcase size={24} />,
    },
]

export default function BranchSelectorStep() {
    const { branch, setBranch, setPricingModel, setPurpose, nextStep, prevStep, goToStep } = useOnboardingStore()
    const [selected, setSelected] = useState<BranchType>(branch)

    const handleSelect = (type: Exclude<BranchType, null>) => {
        setSelected(type)

        // If switching branches after already having selected one, reset to step 5
        // to avoid step misalignment between personal (4 steps) and service (7 steps)
        if (branch && branch !== type) {
            goToStep(4) // Stay on this step, will advance to 5 on continue
        }

        setBranch(type)

        // Set appropriate defaults based on branch
        if (type === 'personal') {
            setPricingModel('single')
            setPurpose('support') // Default purpose for personal
        } else {
            setPricingModel('single') // Service also defaults to single pricing
            // Purpose will be 'service' - set in PaymentMethodStep
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
                <div className="step-header">
                    <h1>What kind of page?</h1>
                    <p>Choose how you want people to subscribe</p>
                </div>

                <div className="step-body">
                    <div className="branch-list">
                        {BRANCH_OPTIONS.map((option, index) => {
                            const isSelected = selected === option.type
                            return (
                                <Pressable
                                    key={option.type}
                                    className={`branch-card ${isSelected ? 'selected' : ''}`}
                                    onClick={() => handleSelect(option.type)}
                                    style={{ animationDelay: `${index * 0.1}s` }}
                                >
                                    <div className="branch-icon">
                                        {option.icon}
                                    </div>
                                    <div className="branch-content">
                                        <span className="branch-title">{option.title}</span>
                                        <span className="branch-desc">{option.description}</span>
                                    </div>
                                    {isSelected && (
                                        <div className="branch-check">
                                            <Check size={18} />
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
