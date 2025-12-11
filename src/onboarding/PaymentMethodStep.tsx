import { useState } from 'react'
import { ChevronLeft, CreditCard, Check } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import '../Dashboard.css'
import './onboarding.css'

// Countries that support Stripe
const STRIPE_COUNTRIES = [
    'United States', 'United Kingdom', 'Canada', 'Australia', 'Germany',
    'France', 'Spain', 'Italy', 'Netherlands', 'Ireland', 'Singapore',
    'Japan', 'Mexico', 'Brazil', 'India'
]

// Countries that use Flutterwave
const FLUTTERWAVE_COUNTRIES = [
    'Nigeria', 'Ghana', 'Kenya', 'South Africa', 'Uganda', 'Tanzania',
    'Rwanda', 'Cameroon', 'Senegal', 'Egypt'
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
    const { countryCode, country, nextStep, prevStep } = useOnboardingStore()
    const [selectedMethod, setSelectedMethod] = useState<string | null>(null)

    // Determine which payment methods to show based on country
    const isStripeCountry = STRIPE_COUNTRIES.includes(countryCode)
    const isFlutterwaveCountry = FLUTTERWAVE_COUNTRIES.includes(countryCode)

    // Default recommendation
    const recommendedMethod = isStripeCountry ? 'stripe' : 'flutterwave'

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
                    {/* Show Stripe if in supported country or always as an option */}
                    {(isStripeCountry || !isFlutterwaveCountry) && (
                        <PaymentMethodCard
                            name="Stripe"
                            description="Bank deposits, cards, Apple Pay"
                            recommended={recommendedMethod === 'stripe'}
                            selected={selectedMethod === 'stripe'}
                            onSelect={() => setSelectedMethod('stripe')}
                        />
                    )}

                    {/* Show Flutterwave if in Africa or as alternative */}
                    {(isFlutterwaveCountry || !isStripeCountry) && (
                        <PaymentMethodCard
                            name="Flutterwave"
                            description="Bank transfers, mobile money"
                            recommended={recommendedMethod === 'flutterwave'}
                            selected={selectedMethod === 'flutterwave'}
                            onSelect={() => setSelectedMethod('flutterwave')}
                        />
                    )}

                    {/* Manual/Bank transfer option always available */}
                    <PaymentMethodCard
                        name="Bank Transfer"
                        description="Request payouts manually"
                        selected={selectedMethod === 'bank'}
                        onSelect={() => setSelectedMethod('bank')}
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
                        onClick={nextStep}
                        disabled={!selectedMethod}
                    >
                        Continue
                    </Button>
                </div>
            </div>
        </div>
    )
}
