import { useState } from 'react'
import { ChevronLeft, Plus, Trash2 } from 'lucide-react'
import { useOnboardingStore } from './store'
import type { SubscriptionTier } from './store'
import { Button, Pressable } from './components'
import { useSaveOnboardingProgress } from '../api/hooks'
import { getCurrencySymbol, getSuggestedAmounts } from '../utils/currency'
import './onboarding.css'

export default function PersonalPricingStep() {
    const {
        pricingModel,
        setPricingModel,
        singleAmount,
        setSingleAmount,
        tiers,
        updateTier,
        addTier,
        removeTier,
        currency,
        branch,
        currentStep,
        nextStep,
        prevStep
    } = useOnboardingStore()
    const { mutateAsync: saveProgress } = useSaveOnboardingProgress()

    const currencySymbol = getCurrencySymbol(currency)
    // Get currency-aware suggested amounts (e.g., NGN shows ₦5000, not ₦5)
    const suggestedAmounts = getSuggestedAmounts(currency, branch === 'service' ? 'service' : 'personal')

    const [inputValue, setInputValue] = useState(singleAmount?.toString() || '')

    const handleSingleAmountChange = (value: string) => {
        setInputValue(value)
        const num = parseInt(value)
        if (!isNaN(num) && num > 0) {
            setSingleAmount(num)
        }
    }

    const handleQuickAmount = (amount: number) => {
        setInputValue(amount.toString())
        setSingleAmount(amount)
    }

    const handleAddTier = () => {
        const newTier: SubscriptionTier = {
            id: `tier-${Date.now()}`,
            name: 'New Tier',
            amount: 15,
            perks: ['Add a perk'],
        }
        addTier(newTier)
    }

    const handleTierAmountChange = (id: string, value: string) => {
        const num = parseInt(value)
        if (!isNaN(num) && num > 0) {
            updateTier(id, { amount: num })
        }
    }

    const handleTierNameChange = (id: string, name: string) => {
        updateTier(id, { name })
    }

    // Validation - minimum $1 for subscriptions (Stripe requires $0.50 minimum)
    const MIN_AMOUNT = 1
    const isValid = pricingModel === 'single'
        ? (singleAmount && singleAmount >= MIN_AMOUNT)
        : (tiers.length > 0 && tiers.every(t => t.amount >= MIN_AMOUNT))

    const showMinAmountWarning = pricingModel === 'single'
        ? (singleAmount !== null && singleAmount > 0 && singleAmount < MIN_AMOUNT)
        : (tiers.some(t => t.amount > 0 && t.amount < MIN_AMOUNT))

    const handleContinue = async () => {
        // Save pricing milestone to server
        try {
            await saveProgress({
                step: currentStep + 1,
                branch: branch as 'personal' | 'service',
                data: {
                    pricingModel,
                    singleAmount: pricingModel === 'single' ? singleAmount : undefined,
                },
            })
        } catch (err) {
            console.warn('Failed to save onboarding progress:', err)
        }
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
                <div className="step-header">
                    <h1>Set your {pricingModel === 'single' ? 'price' : 'packages'}</h1>
                    <p>You can always change this later.</p>
                </div>

                <div className="step-body">
                    {/* Pricing model toggle - Service only */}
                    {branch === 'service' && (
                        <div className="pricing-model-toggle">
                            <Pressable
                                className={`pricing-model-btn ${pricingModel === 'single' ? 'active' : ''}`}
                                onClick={() => setPricingModel('single')}
                            >
                                Simple
                            </Pressable>
                            <Pressable
                                className={`pricing-model-btn ${pricingModel === 'tiers' ? 'active' : ''}`}
                                onClick={() => setPricingModel('tiers')}
                            >
                                Packages
                            </Pressable>
                        </div>
                    )}

                    {pricingModel === 'single' ? (
                        /* Single Amount Mode */
                        <>
                            <div className="single-amount-wrapper">
                                <span className="single-amount-label">Monthly subscription</span>
                                <div className="single-amount-input-group">
                                    <span className="single-amount-currency">{currencySymbol}</span>
                                    <input
                                        type="number"
                                        className="single-amount-input"
                                        placeholder="0"
                                        value={inputValue}
                                        onChange={(e) => handleSingleAmountChange(e.target.value)}
                                    />
                                </div>
                                <span className="single-amount-period">per month</span>
                            </div>

                            <div className="quick-amounts">
                                {suggestedAmounts.map((amount) => (
                                    <Pressable
                                        key={amount}
                                        className={`quick-amount-btn ${singleAmount === amount ? 'selected' : ''}`}
                                        onClick={() => handleQuickAmount(amount)}
                                    >
                                        {currencySymbol}{amount.toLocaleString()}
                                    </Pressable>
                                ))}
                            </div>
                        </>
                    ) : (
                        /* Tiers Mode */
                        <>
                            {tiers.map((tier) => (
                                <div key={tier.id} className="tier-card">
                                    <div className="tier-info">
                                        <input
                                            type="text"
                                            className="tier-name-input"
                                            value={tier.name}
                                            onChange={(e) => handleTierNameChange(tier.id, e.target.value)}
                                            placeholder="Tier name"
                                        />
                                        <div className="tier-perks">
                                            {tier.perks.slice(0, 2).join(' · ')}
                                            {tier.perks.length > 2 && ` +${tier.perks.length - 2}`}
                                        </div>
                                    </div>
                                    <div className="tier-price-group">
                                        <span className="tier-currency">{currencySymbol}</span>
                                        <input
                                            type="number"
                                            className="tier-input"
                                            value={tier.amount}
                                            onChange={(e) => handleTierAmountChange(tier.id, e.target.value)}
                                        />
                                        <span className="tier-period">/mo</span>
                                    </div>
                                    {tiers.length > 1 && (
                                        <Pressable
                                            className="tier-delete"
                                            onClick={() => removeTier(tier.id)}
                                        >
                                            <Trash2 size={18} />
                                        </Pressable>
                                    )}
                                </div>
                            ))}

                            {tiers.length < 5 && (
                                <Pressable className="add-tier-btn" onClick={handleAddTier}>
                                    <Plus size={20} />
                                    <span>Add Tier</span>
                                </Pressable>
                            )}
                        </>
                    )}

                    {showMinAmountWarning && (
                        <p style={{
                            fontSize: 13,
                            color: 'var(--status-warning)',
                            textAlign: 'center',
                            marginTop: 16,
                        }}>
                            Minimum subscription amount is {currencySymbol}{MIN_AMOUNT}
                        </p>
                    )}
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={handleContinue}
                        disabled={!isValid}
                    >
                        Continue
                    </Button>
                </div>
            </div>
        </div>
    )
}
