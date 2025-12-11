import { useState } from 'react'
import { ChevronLeft, Check } from 'lucide-react'
import { useOnboardingStore } from './store'
import type { PricingModel } from './store'
import { Button, Pressable } from './components'
import './onboarding.css'

interface PricingModelOption {
    model: PricingModel
    title: string
    description: string
    example: string
}

const PRICING_OPTIONS: PricingModelOption[] = [
    {
        model: 'single',
        title: 'One Price',
        description: 'A single monthly amount for everyone. Simple and straightforward.',
        example: 'e.g. $10/month to support me',
    },
    {
        model: 'tiers',
        title: 'Multiple Tiers',
        description: 'Different levels with different perks. Let supporters choose how much.',
        example: 'e.g. Fan $5, Supporter $10, VIP $25',
    },
]

export default function PricingModelStep() {
    const { pricingModel, setPricingModel, nextStep, prevStep } = useOnboardingStore()
    const [selected, setSelected] = useState<PricingModel>(pricingModel)

    const handleSelect = (model: PricingModel) => {
        setSelected(model)
        setPricingModel(model)
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
                    <h1>How should pricing work?</h1>
                    <p>Choose how subscribers will pay you</p>
                </div>

                <div className="step-body">
                    <div className="pricing-model-cards">
                        {PRICING_OPTIONS.map((option) => {
                            const isSelected = selected === option.model
                            return (
                                <Pressable
                                    key={option.model}
                                    className={`pricing-model-card ${isSelected ? 'selected' : ''}`}
                                    onClick={() => handleSelect(option.model)}
                                >
                                    <div className="pricing-model-header">
                                        <span className="pricing-model-title">{option.title}</span>
                                        {isSelected && (
                                            <div className="pricing-model-check">
                                                <Check size={14} />
                                            </div>
                                        )}
                                    </div>
                                    <p className="pricing-model-desc">{option.description}</p>
                                    <div className="pricing-model-example">{option.example}</div>
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
                    >
                        Continue
                    </Button>
                </div>
            </div>
        </div>
    )
}
