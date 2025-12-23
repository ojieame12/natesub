import { useState } from 'react'
import { ChevronLeft, ChevronDown, Check, Search } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { useSaveOnboardingProgress } from '../api/hooks'
import '../Dashboard.css'
import './onboarding.css'

// Countries with payment support info
const countries = [
    { code: 'US', name: 'United States', flag: '🇺🇸', currency: 'USD' },
    { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', currency: 'GBP' },
    { code: 'CA', name: 'Canada', flag: '🇨🇦', currency: 'CAD' },
    { code: 'AU', name: 'Australia', flag: '🇦🇺', currency: 'AUD' },
    { code: 'DE', name: 'Germany', flag: '🇩🇪', currency: 'EUR' },
    { code: 'FR', name: 'France', flag: '🇫🇷', currency: 'EUR' },
    { code: 'ES', name: 'Spain', flag: '🇪🇸', currency: 'EUR' },
    { code: 'IT', name: 'Italy', flag: '🇮🇹', currency: 'EUR' },
    { code: 'NL', name: 'Netherlands', flag: '🇳🇱', currency: 'EUR' },
    { code: 'BE', name: 'Belgium', flag: '🇧🇪', currency: 'EUR' },
    { code: 'IE', name: 'Ireland', flag: '🇮🇪', currency: 'EUR' },
    { code: 'PT', name: 'Portugal', flag: '🇵🇹', currency: 'EUR' },
    { code: 'AT', name: 'Austria', flag: '🇦🇹', currency: 'EUR' },
    { code: 'CH', name: 'Switzerland', flag: '🇨🇭', currency: 'CHF' },
    { code: 'SE', name: 'Sweden', flag: '🇸🇪', currency: 'SEK' },
    { code: 'NO', name: 'Norway', flag: '🇳🇴', currency: 'NOK' },
    { code: 'DK', name: 'Denmark', flag: '🇩🇰', currency: 'DKK' },
    { code: 'FI', name: 'Finland', flag: '🇫🇮', currency: 'EUR' },
    { code: 'NZ', name: 'New Zealand', flag: '🇳🇿', currency: 'NZD' },
    { code: 'SG', name: 'Singapore', flag: '🇸🇬', currency: 'SGD' },
    { code: 'HK', name: 'Hong Kong', flag: '🇭🇰', currency: 'HKD' },
    { code: 'JP', name: 'Japan', flag: '🇯🇵', currency: 'JPY' },
    { code: 'MX', name: 'Mexico', flag: '🇲🇽', currency: 'MXN' },
    { code: 'BR', name: 'Brazil', flag: '🇧🇷', currency: 'BRL' },
    { code: 'IN', name: 'India', flag: '🇮🇳', currency: 'INR' },
    // African countries - default to local currency, payment method choice handles USD if needed
    { code: 'NG', name: 'Nigeria', flag: '🇳🇬', currency: 'NGN' },
    { code: 'KE', name: 'Kenya', flag: '🇰🇪', currency: 'KES' },
    { code: 'GH', name: 'Ghana', flag: '🇬🇭', currency: 'GHS' },
    // South Africa has native Stripe support - uses ZAR, NOT cross-border
    { code: 'ZA', name: 'South Africa', flag: '🇿🇦', currency: 'ZAR' },
    { code: 'AE', name: 'United Arab Emirates', flag: '🇦🇪', currency: 'AED' },
    { code: 'PH', name: 'Philippines', flag: '🇵🇭', currency: 'PHP' },
    { code: 'MY', name: 'Malaysia', flag: '🇲🇾', currency: 'MYR' },
    { code: 'TH', name: 'Thailand', flag: '🇹🇭', currency: 'THB' },
    { code: 'ID', name: 'Indonesia', flag: '🇮🇩', currency: 'IDR' },
    { code: 'PL', name: 'Poland', flag: '🇵🇱', currency: 'PLN' },
    { code: 'CZ', name: 'Czech Republic', flag: '🇨🇿', currency: 'CZK' },
    { code: 'RO', name: 'Romania', flag: '🇷🇴', currency: 'RON' },
    { code: 'HU', name: 'Hungary', flag: '🇭🇺', currency: 'HUF' },
]

export default function IdentityStep() {
    const { firstName, lastName, setFirstName, setLastName, country, countryCode, currency, setCountry, setCurrency, nextStep, prevStep, currentStep } = useOnboardingStore()
    const [showCountryPicker, setShowCountryPicker] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
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
        // Save progress to server at this milestone
        try {
            await saveProgress({
                step: currentStep + 1, // Will be moving to next step
                data: { firstName, lastName, country, countryCode, currency },
            })
        } catch (err) {
            // Non-blocking - continue even if save fails
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
                        />
                        <input
                            className="input"
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            placeholder="Last name"
                        />
                    </div>

                    <Pressable
                        className="country-selector"
                        onClick={() => setShowCountryPicker(true)}
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
                        disabled={!firstName.trim() || !lastName.trim() || !countryCode}
                    >
                        Continue
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

                        <div className="country-list">
                            {filteredCountries.map((c) => (
                                <Pressable
                                    key={c.code}
                                    className={`country-option ${c.code === countryCode ? 'selected' : ''}`}
                                    onClick={() => handleSelectCountry(c)}
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
