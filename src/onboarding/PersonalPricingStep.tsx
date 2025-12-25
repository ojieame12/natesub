import { useState } from 'react'
import { ChevronLeft, Plus, Trash2 } from 'lucide-react'
import { useOnboardingStore } from './store'
import type { SubscriptionTier } from './store'
import { Button, Pressable } from './components'
import { useSaveOnboardingProgress } from '../api/hooks'
import { getCurrencySymbol, getSuggestedAmounts, calculateFeePreview, formatAmountWithSeparators, getMinimumAmount } from '../utils/currency'
import './onboarding.css'

// Inline fee preview component to show what creator will receive
// Uses split model: 4% subscriber + 4% creator = 8% total
function FeePreviewBox({ amount, currency }: { amount: number; currency: string }) {
    const preview = calculateFeePreview(amount, currency)

    return (
        <div className="fee-preview-box">
            <div className="fee-preview-row">
                <span>Subscriber pays</span>
                <span>{formatAmountWithSeparators(preview.subscriberPays, currency)}/mo</span>
            </div>
            <div className="fee-preview-divider" />
            <div className="fee-preview-row fee-deduction">
                <span>Platform + processing (8%)</span>
                <span>-{formatAmountWithSeparators(preview.totalFee, currency)}</span>
            </div>
            <div className="fee-preview-divider" />
            <div className="fee-preview-row fee-total">
                <span>You receive</span>
                <span>{formatAmountWithSeparators(preview.creatorReceives, currency)}/mo</span>
            </div>
        </div>
    )
}

export default function PersonalPricingStep() {
    const {
        pricingModel,
        singleAmount,
        tiers,
        setPricing,
        currency,
        branch,
        currentStep,
        nextStep,
        prevStep
    } = useOnboardingStore()
    const { mutateAsync: saveProgress } = useSaveOnboardingProgress()
    const [inputValue, setInputValue] = useState(singleAmount?.toString() || '')

    const currencySymbol = getCurrencySymbol(currency)
    // Get currency-aware suggested amounts (e.g., NGN shows ₦5000, not ₦5)
    const suggestedAmounts = getSuggestedAmounts(currency, branch === 'service' ? 'service' : 'personal')

    // Helper to update state via setPricing
    const updateState = (updates: { model?: 'single' | 'tiers', newAmount?: number | null, newTiers?: SubscriptionTier[] }) => {
        setPricing(
            updates.model || pricingModel,
            updates.newTiers || tiers,
            updates.newAmount !== undefined ? updates.newAmount : singleAmount
        )
    }

    const handleSingleAmountChange = (value: string) => {
        setInputValue(value)
        const num = parseInt(value)
        if (!isNaN(num) && num > 0) {
            updateState({ newAmount: num })
        } else if (value === '') {
            updateState({ newAmount: null })
        }
    }

    const handleQuickAmount = (amount: number) => {
        setInputValue(amount.toString())
        updateState({ newAmount: amount })
    }

    const handleAddTier = () => {
        const newTier: SubscriptionTier = {
            id: `tier-${Date.now()}`,
            name: 'New Tier',
            amount: 15,
            perks: ['Add a perk'],
        }
        updateState({ newTiers: [...tiers, newTier] })
    }

    const handleTierAmountChange = (id: string, value: string) => {
        const num = parseInt(value)
        if (!isNaN(num) && num > 0) {
            const newTiers = tiers.map(t => t.id === id ? { ...t, amount: num } : t)
            updateState({ newTiers })
        }
    }

    const handleTierNameChange = (id: string, name: string) => {
        const newTiers = tiers.map(t => t.id === id ? { ...t, name } : t)
        updateState({ newTiers })
    }

    const removeTier = (id: string) => {
        const newTiers = tiers.filter(t => t.id !== id)
        updateState({ newTiers })
    }

    // Currency-aware minimum validation
    // Uses getMinimumAmount() which returns appropriate minimums per currency
    // e.g., $1 for USD, ₦500 for NGN, ¥100 for JPY
    const minAmount = getMinimumAmount(currency)
    const isValid = pricingModel === 'single'
        ? (singleAmount && singleAmount >= minAmount)
        : (tiers.length > 0 && tiers.every(t => t.amount >= minAmount))

    const showMinAmountWarning = pricingModel === 'single'
        ? (singleAmount !== null && singleAmount > 0 && singleAmount < minAmount)
        : (tiers.some(t => t.amount > 0 && t.amount < minAmount))

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
                                onClick={() => updateState({ model: 'single' })}
                            >
                                Simple
                            </Pressable>
                            <Pressable
                                className={`pricing-model-btn ${pricingModel === 'tiers' ? 'active' : ''}`}
                                onClick={() => updateState({ model: 'tiers' })}
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
                                        type="text"
                                        inputMode="decimal"
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

                            {/* Fee Preview - show what creator will receive */}
                            {singleAmount && singleAmount >= minAmount && (
                                <FeePreviewBox amount={singleAmount} currency={currency} />
                            )}
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
                            Minimum subscription amount is {currencySymbol}{minAmount.toLocaleString()}
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
