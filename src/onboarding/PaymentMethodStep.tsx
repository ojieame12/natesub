import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, CreditCard, Check, Loader2, AlertCircle } from 'lucide-react'
import { useOnboardingStore, useShallow, type PaymentProvider } from './store'
import { Button, Pressable } from './components'
import { SwiftCodeLookup } from '../components'
import { api } from '../api'
import { getMinimumAmount, getCurrencySymbol, getSuggestedAmounts } from '../utils/currency'
import { needsSwiftCodeHelp } from '../utils/swiftCodes'
import {
    hasPaystack,
    hasStripe,
    isAfricanCountry,
    isCrossBorderCountry,
    getPaystackCurrency,
    getStripeDescription,
    getPaystackDescription,
} from '../utils/regionConfig'
import '../Dashboard.css'
import './onboarding.css'

// Prefetch StripeComplete chunk so return from Stripe doesn't trigger Suspense fallback
const prefetchStripeComplete = () => import('../StripeComplete')

interface PaymentMethodCardProps {
    name: string
    description: string
    logo?: string
    recommended?: boolean
    disabled?: boolean
    selected: boolean
    onSelect: () => void
}

function PaymentMethodCard({ name, description, logo, recommended, disabled, selected, onSelect }: PaymentMethodCardProps) {
    return (
        <Pressable
            className={`payment-method-card ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
            onClick={onSelect}
            disabled={disabled}
        >
            <div className="payment-method-icon">
                {logo ? (
                    <img src={logo} alt={name} style={{ width: 28, height: 28, borderRadius: 6 }} />
                ) : (
                    <CreditCard size={24} />
                )}
            </div>
            <div className="payment-method-info">
                <div className="payment-method-name">
                    {name}
                    {recommended && <span className="payment-method-badge">Recommended</span>}
                </div>
                <div className="payment-method-desc">{description}</div>
            </div>
            {selected && (
                <div className="payment-method-check">
                    <Check size={20} />
                </div>
            )}
        </Pressable>
    )
}

export default function PaymentMethodStep() {
    const navigate = useNavigate()
    // Use useShallow to prevent re-renders when unrelated store values change
    const store = useOnboardingStore(useShallow((s) => ({
        countryCode: s.countryCode,
        country: s.country,
        currency: s.currency,
        setCurrency: s.setCurrency,
        paymentProvider: s.paymentProvider,
        setPaymentProvider: s.setPaymentProvider,
        prevStep: s.prevStep,
        reset: s.reset,
        nextStep: s.nextStep,
        currentStep: s.currentStep,
        // Values used in handleContinue
        username: s.username,
        firstName: s.firstName,
        lastName: s.lastName,
        bio: s.bio,
        avatarUrl: s.avatarUrl,
        purpose: s.purpose,
        pricingModel: s.pricingModel,
        singleAmount: s.singleAmount,
        tiers: s.tiers,
        setPricing: s.setPricing,
        address: s.address,
        city: s.city,
        state: s.state,
        zip: s.zip,
    })))
    const { countryCode, country, setCurrency, paymentProvider, setPaymentProvider, prevStep, reset, nextStep, currentStep } = store
    const [selectedMethod, setSelectedMethod] = useState<string | null>(paymentProvider)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Sync local state when store rehydrates (e.g., cross-device resume)
    useEffect(() => {
        if (paymentProvider !== null && selectedMethod !== paymentProvider) {
            setSelectedMethod(paymentProvider)
        }
    }, [paymentProvider]) // eslint-disable-line react-hooks/exhaustive-deps

    // SWIFT code lookup modal state (for cross-border African countries)
    const [showSwiftLookup, setShowSwiftLookup] = useState(false)
    const [pendingStripeUrl, setPendingStripeUrl] = useState<string | null>(null)

    // SWIFT lookup handlers
    const handleSwiftLookupContinue = useCallback(() => {
        if (pendingStripeUrl) {
            window.location.href = pendingStripeUrl
        }
    }, [pendingStripeUrl])

    const handleSwiftLookupClose = useCallback(() => {
        setShowSwiftLookup(false)
        setPendingStripeUrl(null)
        setSaving(false)
    }, [])

    // Determine which payment methods to show based on country code (from regionConfig)
    const countryUpper = countryCode?.toUpperCase() || ''
    const isPaystackCountry = hasPaystack(countryUpper)
    const showAfricaSection = isAfricanCountry(countryUpper)

    // Paystack currency for this country (undefined if not supported)
    const expectedPaystackCurrency = getPaystackCurrency(countryUpper)
    // Show Paystack for supported countries
    const canUsePaystack = isPaystackCountry
    // Stripe available for supported countries (via regionConfig)
    const canUseStripe = hasStripe(countryUpper)

    const handleContinue = async () => {
        if (!selectedMethod) return

        // Validate that the selected payment method is available for this country
        // This guards against stale store values or edge cases
        if (selectedMethod === 'stripe' && !canUseStripe) {
            setError('Stripe is not available in your country. Please select another payment method.')
            return
        }
        if (selectedMethod === 'paystack' && !canUsePaystack) {
            setError('Paystack is not available in your country. Please select another payment method.')
            return
        }

        // Determine final currency based on payment method selection FIRST
        // - Stripe for cross-border countries → USD (subscription currency)
        // - Paystack → local currency
        let finalCurrency = store.currency || 'USD'

        if (selectedMethod === 'stripe' && isCrossBorderCountry(countryUpper)) {
            finalCurrency = 'USD'
        } else if (selectedMethod === 'paystack' && expectedPaystackCurrency) {
            finalCurrency = expectedPaystackCurrency
        }

        // Get suggested amounts for the FINAL currency
        const suggestedAmounts = getSuggestedAmounts(finalCurrency, 'personal')
        const minAmount = getMinimumAmount(finalCurrency)
        const currencySymbol = getCurrencySymbol(finalCurrency)

        // Auto-set singleAmount if it's invalid for the final currency
        // This handles the case where currency changes (e.g., NGN 10 → USD 10)
        let finalSingleAmount = store.singleAmount
        if (store.pricingModel === 'single') {
            if (!finalSingleAmount || finalSingleAmount < minAmount) {
                // Use the first suggested amount as a sensible default
                finalSingleAmount = suggestedAmounts[0]
                store.setPricing('single', store.tiers, finalSingleAmount)
            }
        }

        // Auto-normalize tier amounts if invalid for the final currency
        // This handles currency switches (e.g., NGN tiers → USD tiers)
        if (store.pricingModel === 'tiers' && store.tiers && store.tiers.length > 0) {
            const hasInvalidTiers = store.tiers.some(t => !t.amount || t.amount < minAmount)
            if (hasInvalidTiers) {
                // Reset tiers to suggested amounts for this currency
                const normalizedTiers = store.tiers.map((tier, i) => ({
                    ...tier,
                    amount: suggestedAmounts[Math.min(i, suggestedAmounts.length - 1)] || minAmount,
                }))
                store.setPricing('tiers', normalizedTiers, store.singleAmount)
            }
        }

        // Basic validation (non-pricing fields)
        const validationErrors: string[] = []
        if (!store.username?.trim()) validationErrors.push('Username is required')
        if (!store.firstName?.trim()) validationErrors.push('First name is required')
        if (!store.country?.trim()) validationErrors.push('Country is required')
        if (!store.countryCode?.trim()) validationErrors.push('Country code is required')

        // Validate pricing based on model type (should pass now with auto-fixed amount)
        if (store.pricingModel === 'tiers') {
            if (!store.tiers || store.tiers.length === 0) {
                validationErrors.push('At least one pricing tier is required')
            } else if (store.tiers.some(t => !t.amount || t.amount < minAmount)) {
                validationErrors.push(`All tier amounts must be at least ${currencySymbol}${minAmount.toLocaleString()}`)
            }
        }

        if (validationErrors.length > 0) {
            setError(validationErrors.join('. '))
            return
        }

        setSaving(true)
        setError(null)

        try {
            // Save payment provider and currency to store
            setPaymentProvider(selectedMethod as PaymentProvider)
            if (finalCurrency !== store.currency) {
                setCurrency(finalCurrency)
            }

            // Build profile data from store
            // Compose displayName from firstName + lastName
            const displayName = `${store.firstName || ''} ${store.lastName || ''}`.trim() || store.username
            const profileData = {
                username: store.username,
                displayName,
                bio: store.bio || null,
                avatarUrl: store.avatarUrl,
                country: store.country,
                countryCode: store.countryCode,
                currency: finalCurrency,
                purpose: store.purpose || 'support',
                pricingModel: store.pricingModel,
                singleAmount: store.pricingModel === 'single' ? finalSingleAmount : null,
                tiers: store.pricingModel === 'tiers' ? store.tiers : null,
                paymentProvider: selectedMethod,
                // Address fields for Stripe KYC prefill (trimmed for clean data)
                address: store.address?.trim() || undefined,
                city: store.city?.trim() || undefined,
                state: store.state?.trim() || undefined,
                zip: store.zip?.trim() || undefined,
                // Keep profile private/draft until the final "Launch" step
                isPublic: false,
            }

            // Persist onboarding progress so the flow can resume after redirects
            // Save next step - for service flow it's service-desc, for others it's review
            const nextStepKey = store.purpose === 'service' ? 'service-desc' : 'review'

            // Profile update must succeed before saving progress
            // This prevents resume landing on a later step with incomplete profile
            await api.profile.update(profileData)

            // Only save progress after profile succeeds (fire-and-forget, non-blocking)
            api.auth.saveOnboardingProgress({
                step: currentStep + 1,
                stepKey: nextStepKey,
                data: {
                    paymentProvider: selectedMethod,
                    countryCode: store.countryCode,
                    purpose: store.purpose,
                },
            }).catch(err => {
                console.error('[PaymentMethodStep] Failed to save onboarding progress:', err)
            })

            // Handle Stripe connect flow
            if (selectedMethod === 'stripe') {
                try {
                    const result = await api.stripe.connect()

                    if (result.onboardingUrl) {
                        // Store source for redirect handling when user returns from Stripe
                        sessionStorage.setItem('stripe_onboarding_source', 'onboarding')
                        sessionStorage.setItem('stripe_onboarding_started_at', Date.now().toString())
                        // Fallback: return to next step after Payment
                        // Use step key (not numeric index) for safe resume regardless of step array changes
                        sessionStorage.setItem('stripe_return_to', `/onboarding?step=${nextStepKey}`)

                        // Prefetch StripeComplete chunk so return doesn't show skeleton
                        prefetchStripeComplete()

                        // For cross-border countries (NG/GH/KE), show SWIFT code helper first
                        // This helps users find their bank's SWIFT code before Stripe onboarding
                        if (needsSwiftCodeHelp(countryCode)) {
                            setPendingStripeUrl(result.onboardingUrl)
                            setShowSwiftLookup(true)
                            return
                        }

                        // Profile is saved - redirect to Stripe onboarding
                        // Don't reset() here - AuthRedirect will route properly when user returns
                        window.location.href = result.onboardingUrl
                        return
                    }

                    if (result.alreadyOnboarded) {
                        // Already connected - proceed to final review/launch
                        nextStep()
                        return
                    }

                    if (result.error) {
                        // Profile saved but Stripe setup failed - offer retry or redirect
                        setError(`${result.error}. Your profile was saved - you can retry payment setup from Settings.`)
                        setSaving(false)
                        return
                    }
                } catch (stripeErr: any) {
                    // Profile saved but Stripe call failed
                    console.error('Stripe connect error:', stripeErr)
                    const errorMsg = stripeErr?.error || stripeErr?.message || 'Payment setup failed'
                    setError(`${errorMsg}. Your profile was saved - you can complete payment setup from Settings.`)
                    setSaving(false)
                    return
                }
            }

            // Handle Paystack connect flow - navigate to bank account step
            if (selectedMethod === 'paystack') {
                // Store source for redirect handling when user returns from Paystack
                sessionStorage.setItem('paystack_onboarding_source', 'onboarding')
                // Fallback: return to next step after Payment (using step key for safe resume)
                const nextStepKey = store.purpose === 'service' ? 'service-desc' : 'review'
                sessionStorage.setItem('paystack_return_to', `/onboarding?step=${nextStepKey}`)
                navigate('/onboarding/paystack')
                return
            }

            // For flutterwave (when available), go to dashboard
            reset()
            navigate('/dashboard', { replace: true })

        } catch (err: any) {
            console.error('Failed to complete onboarding:', err)
            setError(err?.error || 'Failed to save profile. Please try again.')
            setSaving(false)
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
                    <h1>Connect payments</h1>
                    <p>Choose how you want to receive your money.</p>
                </div>

                <div className="step-body">
                    {error && (
                        <div className="payment-error" style={{
                            padding: '12px 16px',
                            background: 'rgba(239, 68, 68, 0.1)',
                            borderRadius: 12,
                            marginBottom: 16,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: 'var(--error)' }}>
                                <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                                <span style={{ fontSize: 14 }}>{error}</span>
                            </div>
                            {error.includes('Settings') && (
                                <Pressable
                                    onClick={() => {
                                        reset()
                                        navigate('/settings/payments')
                                    }}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        marginTop: 12,
                                        padding: '8px 16px',
                                        background: 'var(--primary)',
                                        color: 'white',
                                        borderRadius: 8,
                                        fontSize: 14,
                                        fontWeight: 500,
                                    }}
                                >
                                    Go to Settings
                                </Pressable>
                            )}
                        </div>
                    )}

                    <div className="payment-methods-grid">
                        {/* 1. Stripe (Global) */}
                        <PaymentMethodCard
                            name="Stripe"
                            description={canUseStripe ? getStripeDescription(countryUpper) : "Not available in your country"}
                            logo="/stripe-logo.svg"
                            recommended={!isPaystackCountry && canUseStripe} // Recommend Stripe if outside Paystack regions
                            disabled={!canUseStripe}
                            selected={selectedMethod === 'stripe'}
                            onSelect={() => setSelectedMethod('stripe')}
                        />

                        {/* 2. Africa Divider (Only show if user is in Africa) */}
                        {showAfricaSection && (
                            <div className="paystack-divider">
                                <span>Africa</span>
                            </div>
                        )}

                        {/* 3. Paystack (Local Currencies) */}
                        {canUsePaystack && (
                            <PaymentMethodCard
                                name="Paystack"
                                description={getPaystackDescription(countryUpper)}
                                logo="/paystack-logo.svg"
                                recommended={isPaystackCountry} // Recommend Paystack if available
                                selected={selectedMethod === 'paystack'}
                                onSelect={() => {
                                    setSelectedMethod('paystack')
                                    setError(null)
                                }}
                            />
                        )}
                    </div>

                    {country && (
                        <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 16, textAlign: 'center' }}>
                            Detected Location: {country}
                        </p>
                    )}
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={handleContinue}
                        disabled={!selectedMethod || saving}
                    >
                        {saving ? (
                            <>
                                <Loader2 size={18} className="spin" style={{ marginRight: 8 }} />
                                Setting up...
                            </>
                        ) : selectedMethod === 'stripe' ? (
                            'Connect with Stripe'
                        ) : selectedMethod === 'paystack' ? (
                            'Connect Payment Method'
                        ) : (
                            'Complete Setup'
                        )}
                    </Button>
                </div>
            </div>

            {/* SWIFT Code Lookup Modal for cross-border African countries */}
            {showSwiftLookup && countryCode && (
                <SwiftCodeLookup
                    countryCode={countryCode}
                    onContinue={handleSwiftLookupContinue}
                    onClose={handleSwiftLookupClose}
                />
            )}
        </div>
    )
}
