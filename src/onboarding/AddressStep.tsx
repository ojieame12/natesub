import { useState } from 'react'
import { ChevronLeft, MapPin, AlertCircle } from 'lucide-react'
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
    const [saveWarning, setSaveWarning] = useState(false)

    // Validation - street and city required, state/zip optional but recommended
    const isValid = address.trim().length >= 5 && city.trim().length >= 2

    const handleContinue = () => {
        // Fire and forget - don't block navigation on save
        saveProgress({
            step: currentStep + 1,
            stepKey: 'address', // Canonical step key for safe resume
            data: { address, city, state, zip },
        }).catch(err => {
            console.warn('[AddressStep] Failed to save progress:', err)
            setSaveWarning(true)
        })

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
                {saveWarning && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 14px',
                        background: '#FEF3C7',
                        borderRadius: 10,
                        marginBottom: 16,
                        fontSize: 13,
                        color: '#92400E',
                    }}>
                        <AlertCircle size={18} />
                        <span>Your progress may not sync across devices. Complete setup on this device.</span>
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
                        />
                        <input
                            className="input"
                            value={city}
                            onChange={(e) => setCity(e.target.value)}
                            placeholder="City"
                        />
                        <div className="address-row">
                            <input
                                className="input state"
                                value={state}
                                onChange={(e) => setState(e.target.value)}
                                placeholder="State/Province"
                            />
                            <input
                                className="input zip"
                                value={zip}
                                onChange={(e) => setZip(e.target.value)}
                                placeholder="ZIP/Postal"
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
                        disabled={!isValid}
                    >
                        Continue
                    </Button>
                </div>
            </div>
        </div>
    )
}
