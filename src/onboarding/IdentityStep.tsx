import { useState } from 'react'
import { ChevronLeft, ChevronDown, Check, Search, AlertCircle, Loader2 } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { useSaveOnboardingProgress } from '../api/hooks'
import { getCountryList } from '../utils/regionConfig'
import '../Dashboard.css'
import './onboarding.css'

// Get countries from centralized config
const countries = getCountryList()

export default function IdentityStep() {
    const { firstName, lastName, setFirstName, setLastName, country, countryCode, currency, setCountry, setCurrency, nextStep, prevStep, currentStep } = useOnboardingStore()
    const [showCountryPicker, setShowCountryPicker] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [isSaving, setIsSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)
    const { mutateAsync: saveProgress } = useSaveOnboardingProgress()

    const selectedCountry = countries.find(c => c.code === countryCode)

    const filteredCountries = countries.filter(c =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.code.toLowerCase().includes(searchQuery.toLowerCase())
    )

    const handleSelectCountry = (c: typeof countries[0]) => {
        setCountry(c.name, c.code)
        setCurrency(c.currency)
        setShowCountryPicker(false)
        setSearchQuery('')
    }

    const handleContinue = async () => {
        // Block navigation until save succeeds
        setIsSaving(true)
        setSaveError(null)

        try {
            // V5: Identity always goes to setup (address step removed)
            await saveProgress({
                step: currentStep + 1,
                stepKey: 'setup',
                data: { firstName, lastName, country, countryCode, currency },
            })
            // Only advance on success
            nextStep()
        } catch (err) {
            console.warn('[IdentityStep] Failed to save progress:', err)
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
                <Pressable className="onboarding-back" onClick={prevStep} aria-label="Go back">
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
                    <h1>What should we call you?</h1>
                    <p>This is how you'll appear to your subscribers.</p>
                </div>

                <div className="step-body">
                    <div className="name-row">
                        <input
                            className="input"
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            placeholder="First name"
                            autoFocus
                            data-testid="identity-first-name"
                            aria-label="First name"
                        />
                        <input
                            className="input"
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            placeholder="Last name"
                            data-testid="identity-last-name"
                            aria-label="Last name"
                        />
                    </div>

                    <Pressable
                        className="country-selector"
                        onClick={() => setShowCountryPicker(true)}
                        data-testid="country-selector"
                    >
                        {selectedCountry ? (
                            <>
                                <span className="country-flag">{selectedCountry.flag}</span>
                                <span className="country-name">{selectedCountry.name}</span>
                            </>
                        ) : (
                            <span className="country-placeholder">Select your country</span>
                        )}
                        <ChevronDown size={20} className="country-chevron" />
                    </Pressable>
                    <span className="country-hint">
                        Used to set up payments in your region
                    </span>
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={handleContinue}
                        disabled={!firstName.trim() || !lastName.trim() || !countryCode || isSaving}
                        data-testid="identity-continue-btn"
                    >
                        {isSaving ? (
                            <Loader2 size={20} className="spin" />
                        ) : (
                            'Continue'
                        )}
                    </Button>
                </div>
            </div>

            {/* Country Picker Bottom Drawer */}
            {showCountryPicker && (
                <>
                    <div
                        className="drawer-overlay"
                        onClick={() => {
                            setShowCountryPicker(false)
                            setSearchQuery('')
                        }}
                    />
                    <div className="country-drawer">
                        <div className="drawer-handle" />
                        <h3 className="drawer-title">Select Country</h3>

                        <div className="drawer-search">
                            <Search size={18} className="drawer-search-icon" />
                            <input
                                type="text"
                                className="drawer-search-input"
                                placeholder="Search countries..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>

                        <div className="country-list" data-testid="country-list">
                            {filteredCountries.map((c) => (
                                <Pressable
                                    key={c.code}
                                    className={`country-option ${c.code === countryCode ? 'selected' : ''}`}
                                    onClick={() => handleSelectCountry(c)}
                                    data-testid={`country-option-${c.code.toLowerCase()}`}
                                >
                                    <span className="country-option-flag">{c.flag}</span>
                                    <span className="country-option-name">{c.name}</span>
                                    {c.code === countryCode && (
                                        <Check size={20} className="country-option-check" />
                                    )}
                                </Pressable>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
