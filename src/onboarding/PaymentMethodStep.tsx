import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, CreditCard, Check, Loader2, AlertCircle } from 'lucide-react'
import { useOnboardingStore, type PaymentProvider } from './store'
import { Button, Pressable } from './components'
import { api } from '../api'
import { getPricing } from '../utils/pricing'
import '../Dashboard.css'
import './onboarding.css'

// TEMPORARY: Disable Paystack until live keys are ready
// Set to true to re-enable Paystack for NG/KE/ZA countries
const PAYSTACK_ENABLED = false

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
    selected: boolean
    onSelect: () => void
}

function PaymentMethodCard({ name, description, logo, recommended, selected, onSelect }: PaymentMethodCardProps) {
    return (
        <Pressable
            className={`payment-method-card ${selected ? 'selected' : ''}`}
            onClick={onSelect}
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
    const { countryCode, country, currency, branch, paymentProvider, setPaymentProvider, prevStep, reset, nextStep, currentStep } = store
    const [selectedMethod, setSelectedMethod] = useState<string | null>(paymentProvider)

    // Get pricing based on branch (service vs personal)
    const pricing = getPricing(branch === 'service' ? 'service' : undefined)
    const feeLabel = pricing.transactionFeeLabel
    const [stripeCountryCodes, setStripeCountryCodes] = useState<string[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Fetch Stripe supported countries on mount
    useEffect(() => {
        async function fetchSupportedCountries() {
            try {
                const result = await api.stripe.getSupportedCountries()
                setStripeCountryCodes(result.countries.map(c => c.code))
            } catch (err) {
                console.error('Failed to fetch supported countries:', err)
                // Fallback to common countries if API fails (includes cross-border countries like NG)
                setStripeCountryCodes(['US', 'CA', 'GB', 'AU', 'DE', 'FR', 'JP', 'SG', 'NG', 'GH', 'KE', 'ZA'])
            } finally {
                setLoading(false)
            }
        }
        fetchSupportedCountries()
    }, [])

    // Determine which payment methods to show based on country code
    const isStripeCountry = stripeCountryCodes.includes(countryCode?.toUpperCase() || '')
    const countryUpper = countryCode?.toUpperCase() || ''
    const isPaystackCountry = PAYSTACK_COUNTRY_CODES.includes(countryUpper)
    const isFlutterwaveCountry = FLUTTERWAVE_COUNTRY_CODES.includes(countryUpper)

    // Currency alignment check - only offer Paystack if currency matches country
    const expectedPaystackCurrency = PAYSTACK_CURRENCIES[countryUpper]
    const isCurrencyAligned = !expectedPaystackCurrency || currency?.toUpperCase() === expectedPaystackCurrency
    const canUsePaystack = PAYSTACK_ENABLED && isPaystackCountry && isCurrencyAligned

    // Default recommendation - Paystack for NG/KE/ZA with aligned currency, otherwise Stripe
    const recommendedMethod = canUsePaystack ? 'paystack' : 'stripe'

    const handleContinue = async () => {
        if (!selectedMethod) return

        // Local validation before POST
        const MIN_AMOUNT = 1 // Minimum $1 (Stripe requires $0.50)
        const validationErrors: string[] = []
        if (!store.username?.trim()) validationErrors.push('Username is required')
        if (!store.name?.trim()) validationErrors.push('Name is required')
        if (!store.country?.trim()) validationErrors.push('Country is required')
        if (!store.countryCode?.trim()) validationErrors.push('Country code is required')

        // Validate pricing based on model type
        if (store.pricingModel === 'tiers') {
            // For tiers, check that at least one tier exists with valid amount
            if (!store.tiers || store.tiers.length === 0) {
                validationErrors.push('At least one pricing tier is required')
            } else if (store.tiers.some(t => !t.amount || t.amount < MIN_AMOUNT)) {
                validationErrors.push(`All tier amounts must be at least $${MIN_AMOUNT}`)
            }
        } else {
            // For single pricing, validate singleAmount
            if (!store.singleAmount || store.singleAmount < MIN_AMOUNT) {
                validationErrors.push(`Minimum subscription amount is $${MIN_AMOUNT}`)
            }
        }

        if (validationErrors.length > 0) {
            setError(validationErrors.join('. '))
            return
        }

        setSaving(true)
        setError(null)

        try {
            // Save payment provider to store
            setPaymentProvider(selectedMethod as PaymentProvider)

            // Build profile data from store
            const profileData = {
                username: store.username,
                displayName: store.name,
                bio: store.bio || store.generatedBio || null,
                avatarUrl: store.avatarUrl,
                voiceIntroUrl: store.voiceIntroUrl,
                country: store.country,
                countryCode: store.countryCode,
                currency: store.currency,
                purpose: store.branch === 'service' ? 'service' : (store.purpose || 'support'),
                pricingModel: store.pricingModel,
                singleAmount: store.pricingModel === 'single' ? store.singleAmount : null,
                tiers: store.pricingModel === 'tiers' ? store.tiers : null,
                perks: store.perks.map(p => ({
                    id: p.id,
                    title: p.title,
                    enabled: p.enabled,
                })),
                impactItems: store.impactItems.map(i => ({
                    id: i.id,
                    title: i.title,
                    subtitle: i.subtitle,
                })),
                paymentProvider: selectedMethod,
            }

            // Save profile to backend
            await api.profile.update(profileData)
            // Ensure profile stays private/draft until the final "Launch" step
            await api.profile.updateSettings({ isPublic: false })

            // Persist onboarding progress so the flow can resume after redirects
            await api.auth.saveOnboardingProgress({
                step: currentStep + 1, // next step is Launch Review
                branch: branch === 'service' ? 'service' : 'personal',
                data: { paymentProvider: selectedMethod },
            }).catch(() => { })

            // Handle Stripe connect flow
            if (selectedMethod === 'stripe') {
                try {
                    const result = await api.stripe.connect()

                    if (result.onboardingUrl) {
                        // Store source for redirect handling when user returns from Stripe
                        sessionStorage.setItem('stripe_onboarding_source', 'onboarding')
                        sessionStorage.setItem('stripe_onboarding_started_at', Date.now().toString())
                        // Fallback: if StripeComplete can't determine source, it can still navigate back here.
                        sessionStorage.setItem('stripe_return_to', '/onboarding?step=6')
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

    if (loading) {
        return (
            <div className="onboarding">
                <div className="onboarding-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
                    <Loader2 size={32} className="spin" />
                </div>
            </div>
        )
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
                    <p>Choose how you want to receive your money. {feeLabel} fee per transaction{branch !== 'service' && ', no monthly fee'}.</p>
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

                    {/* Show Paystack for Nigeria, Kenya, South Africa with aligned currency */}
                    {canUsePaystack && (
                        <PaymentMethodCard
                            name="Paystack"
                            description="Direct bank deposits in NGN, KES, ZAR"
                            logo="/paystack-logo.svg"
                            recommended={recommendedMethod === 'paystack'}
                            selected={selectedMethod === 'paystack'}
                            onSelect={() => {
                                setSelectedMethod('paystack')
                                setError(null)
                            }}
                        />
                    )}

                    {/* Show warning if in Paystack country but currency misaligned */}
                    {isPaystackCountry && !isCurrencyAligned && (
                        <div style={{
                            padding: '12px 16px',
                            background: 'rgba(245, 158, 11, 0.1)',
                            borderRadius: 12,
                            marginBottom: 16,
                            fontSize: 14,
                            color: 'var(--text-secondary)'
                        }}>
                            Paystack requires {expectedPaystackCurrency} currency for {country}. Your selected currency is {currency?.toUpperCase()}.
                        </div>
                    )}

                    {/* Show Stripe if in supported country */}
                    {isStripeCountry && (
                        <PaymentMethodCard
                            name="Stripe"
                            description="Bank deposits, cards, Apple Pay"
                            logo="/stripe-logo.svg"
                            recommended={recommendedMethod === 'stripe'}
                            selected={selectedMethod === 'stripe'}
                            onSelect={() => setSelectedMethod('stripe')}
                        />
                    )}

                    {/* Show warning if user selected Stripe but country isn't supported */}
                    {!isStripeCountry && selectedMethod === 'stripe' && (
                        <div style={{
                            padding: '12px 16px',
                            background: 'rgba(245, 158, 11, 0.1)',
                            borderRadius: 12,
                            marginBottom: 16,
                            fontSize: 14,
                            color: 'var(--text-secondary)'
                        }}>
                            Stripe is not available in {country || 'your country'}. Please choose another option.
                        </div>
                    )}

                    {/* Flutterwave - Coming Soon (only show if not using Paystack) */}
                    {isFlutterwaveCountry && !canUsePaystack && (
                        <div className="payment-method-card disabled" style={{ opacity: 0.6, cursor: 'not-allowed' }}>
                            <div className="payment-method-icon">
                                <CreditCard size={24} />
                            </div>
                            <div className="payment-method-info">
                                <div className="payment-method-name">
                                    Flutterwave
                                    <span className="payment-method-badge" style={{ background: 'var(--neutral-200)', color: 'var(--text-secondary)' }}>Coming Soon</span>
                                </div>
                                <div className="payment-method-desc">Bank transfers, mobile money</div>
                            </div>
                        </div>
                    )}

                    {/* If not in Stripe country and can't use Paystack, show Stripe with warning */}
                    {!isStripeCountry && !canUsePaystack && (
                        <PaymentMethodCard
                            name="Stripe"
                            description="Bank deposits, cards, Apple Pay"
                            logo="/stripe-logo.svg"
                            selected={selectedMethod === 'stripe'}
                            onSelect={() => {
                                setSelectedMethod('stripe')
                                setError(`Stripe may not be available in ${country || 'your country'}. You can try, but setup may fail.`)
                            }}
                        />
                    )}


                    {country && (
                        <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 16, textAlign: 'center' }}>
                            Based on your location: {country}
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
