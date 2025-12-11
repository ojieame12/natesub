import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, CreditCard, Check, Loader2, AlertCircle } from 'lucide-react'
import { useOnboardingStore, type PaymentProvider } from './store'
import { Button, Pressable } from './components'
import { api } from '../api'
import '../Dashboard.css'
import './onboarding.css'

// Flutterwave supported country codes
const FLUTTERWAVE_COUNTRY_CODES = [
    'NG', 'GH', 'KE', 'ZA', 'UG', 'TZ', 'RW', 'CM', 'SN', 'EG'
]

interface PaymentMethodCardProps {
    name: string
    description: string
    recommended?: boolean
    selected: boolean
    onSelect: () => void
}

function PaymentMethodCard({ name, description, recommended, selected, onSelect }: PaymentMethodCardProps) {
    return (
        <Pressable
            className={`payment-method-card ${selected ? 'selected' : ''}`}
            onClick={onSelect}
        >
            <div className="payment-method-icon">
                <CreditCard size={24} />
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
    const store = useOnboardingStore()
    const { countryCode, country, paymentProvider, setPaymentProvider, prevStep, reset } = store
    const [selectedMethod, setSelectedMethod] = useState<string | null>(paymentProvider)
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
                // Fallback to common countries if API fails
                setStripeCountryCodes(['US', 'CA', 'GB', 'AU', 'DE', 'FR', 'JP', 'SG'])
            } finally {
                setLoading(false)
            }
        }
        fetchSupportedCountries()
    }, [])

    // Determine which payment methods to show based on country code
    const isStripeCountry = stripeCountryCodes.includes(countryCode?.toUpperCase() || '')
    const isFlutterwaveCountry = FLUTTERWAVE_COUNTRY_CODES.includes(countryCode?.toUpperCase() || '')

    // Default recommendation
    const recommendedMethod = isStripeCountry ? 'stripe' : isFlutterwaveCountry ? 'flutterwave' : 'bank'

    const handleContinue = async () => {
        if (!selectedMethod) return

        // Local validation before POST
        const validationErrors: string[] = []
        if (!store.username?.trim()) validationErrors.push('Username is required')
        if (!store.name?.trim()) validationErrors.push('Name is required')
        if (!store.country?.trim()) validationErrors.push('Country is required')
        if (!store.countryCode?.trim()) validationErrors.push('Country code is required')
        if (!store.singleAmount || store.singleAmount <= 0) validationErrors.push('Price must be greater than 0')

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
                singleAmount: store.singleAmount,
                tiers: store.tiers,
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

            // Handle Stripe connect flow
            if (selectedMethod === 'stripe') {
                const result = await api.stripe.connect()

                if (result.onboardingUrl) {
                    // Reset store before redirecting
                    reset()
                    // Redirect to Stripe onboarding
                    window.location.href = result.onboardingUrl
                    return
                }

                if (result.alreadyOnboarded) {
                    // Already connected, go to dashboard
                    reset()
                    navigate('/dashboard')
                    return
                }

                if (result.error) {
                    setError(result.error)
                    setSaving(false)
                    return
                }
            }

            // For other payment methods (flutterwave, bank), go to dashboard
            reset()
            navigate('/dashboard')

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
                    <p>Choose how you want to receive your money.</p>
                </div>

                <div className="step-body">
                    {error && (
                        <div className="payment-error" style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '12px 16px',
                            background: 'rgba(239, 68, 68, 0.1)',
                            borderRadius: 12,
                            marginBottom: 16,
                            color: 'var(--error)'
                        }}>
                            <AlertCircle size={18} />
                            <span style={{ fontSize: 14 }}>{error}</span>
                        </div>
                    )}

                    {/* Show Stripe if in supported country */}
                    {isStripeCountry && (
                        <PaymentMethodCard
                            name="Stripe"
                            description="Bank deposits, cards, Apple Pay"
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

                    {/* Flutterwave - Coming Soon (not implemented yet) */}
                    {isFlutterwaveCountry && (
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

                    {/* If not in Stripe country, show Stripe with warning */}
                    {!isStripeCountry && (
                        <PaymentMethodCard
                            name="Stripe"
                            description="Bank deposits, cards, Apple Pay"
                            selected={selectedMethod === 'stripe'}
                            onSelect={() => {
                                setSelectedMethod('stripe')
                                setError(`Stripe may not be available in ${country || 'your country'}. You can try, but setup may fail.`)
                            }}
                        />
                    )}

                    {/* Manual/Bank transfer option always available */}
                    <PaymentMethodCard
                        name="Manual Payouts"
                        description="We'll hold funds until you request withdrawal"
                        selected={selectedMethod === 'bank'}
                        onSelect={() => {
                            setSelectedMethod('bank')
                            setError(null)
                        }}
                    />

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
                        ) : (
                            'Complete Setup'
                        )}
                    </Button>
                </div>
            </div>
        </div>
    )
}
