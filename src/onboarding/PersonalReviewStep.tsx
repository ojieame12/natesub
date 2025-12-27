import { useState, useRef } from 'react'
import { ChevronLeft, ChevronDown, Check, Loader2, AlertCircle, Camera, RefreshCw, Heart, Gift, Briefcase, Star, Sparkles, Wallet, MoreHorizontal } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { BottomDrawer } from '../components'
import { getShareableLink } from '../utils/constants'
import { getCurrencySymbol, getSuggestedAmounts, getMinimumAmount } from '../utils/currency'
import {
    isCrossBorderCountry,
    getLocalCurrencyName,
    getCrossBorderCurrencyOptions,
} from '../utils/regionConfig'
import { api } from '../api'
import { uploadFile } from '../api/hooks'
import './onboarding.css'

// Purpose options with icons for visual differentiation
type Purpose = 'tips' | 'support' | 'allowance' | 'fan_club' | 'exclusive_content' | 'service' | 'other'
const PURPOSE_OPTIONS: { value: Purpose; label: string; icon: React.ReactNode }[] = [
    { value: 'support', label: 'Support Me', icon: <Heart size={20} /> },
    { value: 'tips', label: 'Tips & Appreciation', icon: <Gift size={20} /> },
    { value: 'service', label: 'Services', icon: <Briefcase size={20} /> },
    { value: 'fan_club', label: 'Fan Club', icon: <Star size={20} /> },
    { value: 'exclusive_content', label: 'Exclusive Content', icon: <Sparkles size={20} /> },
    { value: 'allowance', label: 'Allowance', icon: <Wallet size={20} /> },
    { value: 'other', label: 'Other', icon: <MoreHorizontal size={20} /> },
]

export default function PersonalReviewStep() {
    const navigate = useNavigate()
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [launching, setLaunching] = useState(false)
    const [isUploading, setIsUploading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [showPurposeDrawer, setShowPurposeDrawer] = useState(false)
    const [showCurrencyDrawer, setShowCurrencyDrawer] = useState(false)

    const {
        firstName,
        lastName,
        setFirstName,
        setLastName,
        username,
        purpose,
        singleAmount,
        country,
        countryCode,
        currency,
        setCurrency,
        avatarUrl,
        paymentProvider,
        address,
        city,
        state,
        zip,
        currentStep,
        setAvatarUrl,
        setPurpose,
        setPricing,
        prevStep,
        reset
    } = useOnboardingStore()

    // Determine if user is a cross-border creator using Stripe
    const isCrossBorderStripe = paymentProvider === 'stripe' && isCrossBorderCountry(countryCode)
    const localCurrencyName = getLocalCurrencyName(countryCode)

    // Construct display name from first/last name
    const displayName = `${firstName} ${lastName}`.trim()

    const resolvedPurpose = purpose || 'support'
    const currencySymbol = getCurrencySymbol(currency)

    // Price input as string for free editing
    const [priceInput, setPriceInput] = useState(String(singleAmount || 10))

    // Handle currency change - adjust price to sensible default for new currency
    const handleCurrencyChange = (newCurrency: string) => {
        setCurrency(newCurrency)
        // Set a sensible default price for the new currency
        const suggestedAmounts = getSuggestedAmounts(newCurrency, 'personal')
        const newPrice = suggestedAmounts[0] || 10
        setPriceInput(String(newPrice))
        setPricing('single', [], newPrice)
        setShowCurrencyDrawer(false)
    }

    // Format number with commas for display
    const formatWithCommas = (val: string): string => {
        // Remove existing commas and non-numeric chars except decimal
        const clean = val.replace(/,/g, '')
        if (!clean || clean === '.') return clean

        const parts = clean.split('.')
        // Add commas to integer part
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
        return parts.join('.')
    }

    // Get raw number from formatted string
    const parseFormattedNumber = (val: string): string => {
        return val.replace(/,/g, '')
    }

    // Dynamic font size based on digit count
    const getPriceFontSize = (val: string): number => {
        const digits = parseFormattedNumber(val).replace('.', '').length
        if (digits <= 3) return 48
        if (digits <= 4) return 40
        if (digits <= 5) return 32
        if (digits <= 6) return 28
        return 24
    }

    const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        // Get raw value without commas
        const rawVal = parseFormattedNumber(e.target.value)
        // Only allow digits and one decimal
        if (rawVal === '' || /^\d*\.?\d*$/.test(rawVal)) {
            setPriceInput(rawVal)
            const numVal = parseFloat(rawVal) || 0
            setPricing('single', [], numVal)
        }
    }

    // Formatted display value
    const displayPrice = formatWithCommas(priceInput)

    const handleAvatarClick = () => {
        fileInputRef.current?.click()
    }

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return

        const isImage = file.type.startsWith('image/') ||
            file.type === 'image/heic' ||
            file.type === 'image/heif' ||
            file.name.toLowerCase().endsWith('.heic') ||
            file.name.toLowerCase().endsWith('.heif')

        if (!isImage) {
            setError('Please upload an image file')
            return
        }

        if (file.size > 10 * 1024 * 1024) {
            setError('Image must be less than 10MB')
            return
        }

        setIsUploading(true)
        setError(null)
        try {
            const url = await uploadFile(file, 'avatar')
            setAvatarUrl(url)
        } catch (err: any) {
            setError(err?.error || err?.message || 'Failed to upload avatar')
        } finally {
            setIsUploading(false)
            if (fileInputRef.current) {
                fileInputRef.current.value = ''
            }
        }
    }

    // Get minimum amount for current currency
    const minAmount = getMinimumAmount(currency)

    const handleLaunch = async () => {
        if (!displayName || !username) {
            setError('Please fill in all fields.')
            return
        }

        if (!avatarUrl) {
            setError('Please add a profile photo.')
            return
        }

        // Validate single pricing amount
        const finalAmount = parseFloat(priceInput) || 0
        if (finalAmount <= 0) {
            setError('Please set a price.')
            return
        }
        if (finalAmount < minAmount) {
            setError(`Minimum price is ${currencySymbol}${minAmount.toLocaleString()} for ${currency}.`)
            return
        }
        setLaunching(true)
        setError(null)

        try {
            // 1. Final Profile Update (includes address for Stripe KYC prefill)
            await api.profile.update({
                username,
                displayName,
                avatarUrl,
                purpose: resolvedPurpose,
                currency,
                country,
                countryCode,
                pricingModel: 'single',
                singleAmount: finalAmount,
                tiers: null,
                paymentProvider,
                // Address fields for Stripe KYC prefill (trimmed for clean data)
                address: address?.trim() || undefined,
                city: city?.trim() || undefined,
                state: state?.trim() || undefined,
                zip: zip?.trim() || undefined,
            })

            // 2. Publish Page
            await api.profile.updateSettings({ isPublic: true })

            // 3. Complete Onboarding - dynamic step based on flow length
            // Backend uses countryCode to determine completion threshold
            await api.auth.saveOnboardingProgress({
                step: currentStep + 1,
                data: { countryCode },
            })

            // 4. Go to their new page (owner view with share button)
            reset()
            navigate(`/${username}`, { replace: true })

        } catch (err: any) {
            console.error('Launch error:', err)
            setError(err?.error || 'Failed to launch page.')
            setLaunching(false)
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
                    <h1>Set up your page</h1>
                    <p>Almost there! Customize and launch.</p>
                </div>

                <div className="step-body">
                    {/* Avatar + Name Card */}
                    <div className="setup-card">
                        {/* Avatar */}
                        <Pressable className="setup-avatar" onClick={handleAvatarClick} disabled={isUploading}>
                            {avatarUrl ? (
                                <img src={avatarUrl} alt="" className="setup-avatar-image" />
                            ) : (
                                <div className="setup-avatar-placeholder">
                                    {firstName ? firstName.charAt(0).toUpperCase() : 'U'}
                                </div>
                            )}
                            <div className="setup-avatar-overlay">
                                {isUploading ? <Loader2 size={16} className="spin" /> : <Camera size={16} />}
                            </div>
                        </Pressable>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*,.heic,.heif"
                            onChange={handleFileChange}
                            style={{ display: 'none' }}
                        />

                        {/* Display Name (first + last) */}
                        <div className="setup-name-row">
                            <input
                                type="text"
                                className="setup-name-input"
                                value={firstName}
                                onChange={(e) => setFirstName(e.target.value)}
                                placeholder="First"
                            />
                            <input
                                type="text"
                                className="setup-name-input"
                                value={lastName}
                                onChange={(e) => setLastName(e.target.value)}
                                placeholder="Last"
                            />
                        </div>

                        {/* Link preview */}
                        <span className="setup-link">{getShareableLink(username || '...')}</span>

                        {/* Purpose selector */}
                        <Pressable
                            className="setup-purpose"
                            onClick={() => setShowPurposeDrawer(true)}
                        >
                            <span className="setup-purpose-label">For</span>
                            <span className="setup-purpose-value">
                                {PURPOSE_OPTIONS.find(p => p.value === resolvedPurpose)?.label || 'Support Me'}
                            </span>
                            <ChevronDown size={16} className="setup-purpose-chevron" />
                        </Pressable>
                    </div>

                    {/* Pricing Card */}
                    <div className="setup-price-card">
                        {isCrossBorderStripe ? (
                            <Pressable
                                className="setup-price-currency-btn"
                                onClick={() => setShowCurrencyDrawer(true)}
                                style={{ fontSize: Math.max(16, getPriceFontSize(priceInput) / 2) }}
                            >
                                {currencySymbol}
                                <ChevronDown size={14} style={{ marginLeft: 2, opacity: 0.5 }} />
                            </Pressable>
                        ) : (
                            <span className="setup-price-currency" style={{ fontSize: Math.max(16, getPriceFontSize(priceInput) / 2) }}>{currencySymbol}</span>
                        )}
                        <input
                            type="text"
                            inputMode="decimal"
                            className="setup-price-input"
                            value={displayPrice}
                            onChange={handlePriceChange}
                            placeholder="10"
                            style={{ fontSize: getPriceFontSize(priceInput) }}
                        />
                        <span className="setup-price-period">/month</span>
                    </div>

                    {/* Conversion note for cross-border creators */}
                    {isCrossBorderStripe && (
                        <div className="setup-conversion-note">
                            <RefreshCw size={14} />
                            <span>Payouts convert to {localCurrencyName} at market rate</span>
                        </div>
                    )}
                </div>

                {error && (
                    <div className="setup-error">
                        <AlertCircle size={18} />
                        <span>{error}</span>
                    </div>
                )}

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={handleLaunch}
                        disabled={launching || isUploading}
                    >
                        {launching ? (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Loader2 size={18} className="spin" />
                                Launching...
                            </span>
                        ) : (
                            'Launch My Page'
                        )}
                    </Button>
                </div>
            </div>

            {/* Purpose Drawer - with swipe-to-dismiss */}
            <BottomDrawer
                open={showPurposeDrawer}
                onClose={() => setShowPurposeDrawer(false)}
                title="What's this for?"
            >
                <div className="purpose-list">
                    {PURPOSE_OPTIONS.map((option) => (
                        <Pressable
                            key={option.value}
                            className={`purpose-option ${resolvedPurpose === option.value ? 'selected' : ''}`}
                            onClick={() => {
                                setPurpose(option.value)
                                setShowPurposeDrawer(false)
                            }}
                        >
                            <span className="purpose-option-icon">{option.icon}</span>
                            <span className="purpose-option-name">{option.label}</span>
                            {resolvedPurpose === option.value && (
                                <Check size={20} className="purpose-option-check" />
                            )}
                        </Pressable>
                    ))}
                </div>
            </BottomDrawer>

            {/* Currency Drawer - for cross-border creators */}
            {showCurrencyDrawer && (
                <>
                    <div
                        className="drawer-overlay"
                        onClick={() => setShowCurrencyDrawer(false)}
                    />
                    <div className="country-drawer">
                        <div className="drawer-handle" />
                        <h3 className="drawer-title">Choose currency</h3>
                        <p style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 16 }}>
                            Payouts will be converted to {localCurrencyName}
                        </p>
                        <div className="country-list">
                            {getCrossBorderCurrencyOptions().map((curr) => (
                                <Pressable
                                    key={curr.code}
                                    className={`country-option ${currency === curr.code ? 'selected' : ''}`}
                                    onClick={() => handleCurrencyChange(curr.code)}
                                >
                                    <span className="country-option-name">{curr.symbol} {curr.label}</span>
                                    {currency === curr.code && (
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
