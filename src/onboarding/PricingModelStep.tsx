import { useState, useMemo } from 'react'
import { ChevronLeft, Check } from 'lucide-react'
import { useOnboardingStore } from './store'
import type { PricingModel } from './store'
import { Button, Pressable } from './components'
import { getCurrencySymbol, getSuggestedAmounts } from '../utils/currency'
import './onboarding.css'

interface PricingModelOption {
    model: PricingModel
    title: string
    description: string
    example: string
}

export default function PricingModelStep() {
    const { pricingModel, tiers, singleAmount, setPricing, nextStep, prevStep, currency } = useOnboardingStore()
    const [selected, setSelected] = useState<PricingModel>(pricingModel)

    // Generate currency-aware examples
    const pricingOptions = useMemo((): PricingModelOption[] => {
        const currencyCode = currency || 'USD'
        const symbol = getCurrencySymbol(currencyCode)
        const amounts = getSuggestedAmounts(currencyCode, 'personal')
        // Use first 3 suggested amounts for tier examples
        const [low, mid, high] = amounts.slice(0, 3)

        return [
            {
                model: 'single',
                title: 'One Price',
                description: 'A single monthly amount for everyone. Simple and straightforward.',
                example: `e.g. ${symbol}${mid?.toLocaleString() || '10'}/month to support me`,
            },
            {
                model: 'tiers',
                title: 'Multiple Tiers',
                description: 'Different levels with different perks. Let supporters choose how much.',
                example: `e.g. Fan ${symbol}${low?.toLocaleString() || '5'}, Supporter ${symbol}${mid?.toLocaleString() || '10'}, VIP ${symbol}${high?.toLocaleString() || '25'}`,
            },
        ]
    }, [currency])

    const handleSelect = (model: PricingModel) => {
        setSelected(model)
        setPricing(model, tiers, singleAmount)
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
                        {pricingOptions.map((option) => {
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
