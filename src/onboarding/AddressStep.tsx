import { useState } from 'react'
import { ChevronLeft, MapPin, AlertCircle, Loader2 } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { useSaveOnboardingProgress } from '../api/hooks'
import '../Dashboard.css'
import './onboarding.css'

export default function AddressStep() {
    const {
        address, setAddress,
        city, setCity,
        state, setState,
        zip, setZip,
        country,
        nextStep, prevStep, currentStep
    } = useOnboardingStore()
    const { mutateAsync: saveProgress } = useSaveOnboardingProgress()
    const [isSaving, setIsSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)

    // Validation - street and city required, state/zip optional but recommended
    const isValid = address.trim().length >= 5 && city.trim().length >= 2

    const handleContinue = async () => {
        // Block navigation until save succeeds
        setIsSaving(true)
        setSaveError(null)

        try {
            // Save NEXT step key so resume lands on the step user is going to
            await saveProgress({
                step: currentStep + 1,
                stepKey: 'purpose', // After address is always purpose
                data: { address, city, state, zip },
            })
            // Only advance on success
            nextStep()
        } catch (err) {
            console.warn('[AddressStep] Failed to save progress:', err)
            setSaveError('Failed to save. Please try again.')
        } finally {
            setIsSaving(false)
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
                {saveError && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 14px',
                        background: '#FEE2E2',
                        borderRadius: 10,
                        marginBottom: 16,
                        fontSize: 13,
                        color: '#DC2626',
                    }}>
                        <AlertCircle size={18} />
                        <span>{saveError}</span>
                    </div>
                )}
                <div className="step-header">
                    <h1>What's your address?</h1>
                    <p>Used for payment verification and tax documents.</p>
                </div>

                <div className="step-body">
                    <div className="address-form">
                        <input
                            className="input"
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            placeholder="Street address"
                            autoFocus
                            data-testid="address-street"
                        />
                        <input
                            className="input"
                            value={city}
                            onChange={(e) => setCity(e.target.value)}
                            placeholder="City"
                            data-testid="address-city"
                        />
                        <div className="address-row">
                            <input
                                className="input state"
                                value={state}
                                onChange={(e) => setState(e.target.value)}
                                placeholder="State/Province"
                                data-testid="address-state"
                            />
                            <input
                                className="input zip"
                                value={zip}
                                onChange={(e) => setZip(e.target.value)}
                                placeholder="ZIP/Postal"
                                data-testid="address-zip"
                            />
                        </div>
                    </div>

                    <div className="address-info">
                        <MapPin size={16} />
                        <span>Receiving payments in {country || 'your country'}</span>
                    </div>
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={handleContinue}
                        disabled={!isValid || isSaving}
                        data-testid="address-continue-btn"
                    >
                        {isSaving ? (
                            <Loader2 size={20} className="spin" />
                        ) : (
                            'Continue'
                        )}
                    </Button>
                </div>
            </div>
        </div>
    )
}
