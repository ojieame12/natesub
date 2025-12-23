import { ChevronLeft, MapPin } from 'lucide-react'
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
        country, countryCode,
        nextStep, prevStep, currentStep
    } = useOnboardingStore()
    const { mutateAsync: saveProgress } = useSaveOnboardingProgress()

    // Validation - street and city required, state/zip optional but recommended
    const isValid = address.trim().length >= 5 && city.trim().length >= 2

    const handleContinue = async () => {
        // Save progress to server
        try {
            await saveProgress({
                step: currentStep + 1,
                data: { address, city, state, zip },
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
