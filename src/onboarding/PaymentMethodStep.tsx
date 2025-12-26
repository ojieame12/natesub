import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, CreditCard, Check, Loader2, AlertCircle } from 'lucide-react'
import { useOnboardingStore, type PaymentProvider } from './store'
import { Button, Pressable } from './components'
import { api } from '../api'
import { getMinimumAmount, getCurrencySymbol, getSuggestedAmounts } from '../utils/currency'
import '../Dashboard.css'
import './onboarding.css'

// Paystack is enabled for supported African countries
const PAYSTACK_ENABLED = true

// Paystack supported country codes (primary for Africa)
const PAYSTACK_COUNTRY_CODES = ['NG', 'KE', 'ZA']

// Flutterwave supported country codes (as fallback)
const FLUTTERWAVE_COUNTRY_CODES = [
    'NG', 'GH', 'KE', 'ZA', 'UG', 'TZ', 'RW', 'CM', 'SN', 'EG'
]

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

// Paystack country to currency mapping
const PAYSTACK_CURRENCIES: Record<string, string> = {
    'NG': 'NGN',
    'KE': 'KES',
    'ZA': 'ZAR',
}

export default function PaymentMethodStep() {
    const navigate = useNavigate()
    const store = useOnboardingStore()
    const { countryCode, country, setCurrency, paymentProvider, setPaymentProvider, prevStep, reset, nextStep, currentStep } = store
    const [selectedMethod, setSelectedMethod] = useState<string | null>(paymentProvider)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Removed country check effect since we allow all countries now

    // Determine which payment methods to show based on country code
    const countryUpper = countryCode?.toUpperCase() || ''
    const isPaystackCountry = PAYSTACK_COUNTRY_CODES.includes(countryUpper)
    const isFlutterwaveCountry = FLUTTERWAVE_COUNTRY_CODES.includes(countryUpper)

    // Paystack currency mapping (used for auto-switch in handleContinue)
    const expectedPaystackCurrency = PAYSTACK_CURRENCIES[countryUpper]
    // Show Paystack for all Paystack countries - users can choose, currency will adjust
    const canUsePaystack = PAYSTACK_ENABLED && isPaystackCountry
    // Stripe available for all countries (cross-border payouts supported for NG/GH/KE)
    const canUseStripe = true

    const handleContinue = async () => {
        if (!selectedMethod) return

        // Determine final currency based on payment method selection FIRST
        // - Stripe for cross-border countries (NG/GH/KE) → USD
        // - Paystack → local currency
        const crossBorderCountries = ['NG', 'GH', 'KE']
        let finalCurrency = store.currency || 'USD'

        if (selectedMethod === 'stripe' && crossBorderCountries.includes(countryUpper)) {
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
            }

            // Save profile to backend
            await api.profile.update(profileData)
            // Ensure profile stays private/draft until the final "Launch" step
            await api.profile.updateSettings({ isPublic: false })

            // Persist onboarding progress so the flow can resume after redirects
            // Save next step (Review) - backend uses countryCode to determine dynamic completion
            await api.auth.saveOnboardingProgress({
                step: currentStep + 1,
                data: { paymentProvider: selectedMethod, countryCode: store.countryCode },
            }).catch(() => { })

            // Handle Stripe connect flow
            if (selectedMethod === 'stripe') {
                try {
                    const result = await api.stripe.connect()

                    if (result.onboardingUrl) {
                        // Store source for redirect handling when user returns from Stripe
                        sessionStorage.setItem('stripe_onboarding_source', 'onboarding')
                        sessionStorage.setItem('stripe_onboarding_started_at', Date.now().toString())
                        // Fallback: return to Review step (next step after Payment)
                        // Dynamic based on whether address step is shown
                        sessionStorage.setItem('stripe_return_to', `/onboarding?step=${currentStep + 1}`)
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
                        {/* 1. Stripe (Foreign Currencies) */}
                        <PaymentMethodCard
                            name="Stripe"
                            description={canUseStripe ? "Accept USD, GBP, EUR (Global Audience)" : "Not available in your country"}
                            logo="/stripe-logo.svg"
                            recommended={!isPaystackCountry && canUseStripe} // Recommend Stripe if outside Africa
                            disabled={!canUseStripe}
                            selected={selectedMethod === 'stripe'}
                            onSelect={() => setSelectedMethod('stripe')}
                        />

                        {/* 2. Africa Divider (Only show if we are in an African context or user is in Africa) */}
                        {(isPaystackCountry || isFlutterwaveCountry) && (
                            <div className="paystack-divider">
                                <span>Africa</span>
                            </div>
                        )}

                        {/* 3. Paystack (Local Currencies) */}
                        {canUsePaystack && (
                            <PaymentMethodCard
                                name="Paystack"
                                description="Accept NGN, KES, ZAR (Local Audience)"
                                logo="/paystack-logo.svg"
                                recommended={isPaystackCountry} // Recommend Paystack if inside Africa
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
        </div>
    )
}
