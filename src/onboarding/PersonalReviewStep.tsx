import { useState, useRef } from 'react'
import { ChevronLeft, ChevronDown, Check, Loader2, AlertCircle, Camera, RefreshCw, Heart, Gift, Briefcase, Star, Sparkles, Wallet, MoreHorizontal, Edit3, Wand2, Plus, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useOnboardingStore, useShallow } from './store'
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
import { uploadFile, useGeneratePerks, useAIConfig, useCurrentUser } from '../api/hooks'
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

    // Service mode state
    const [editingPerkIndex, setEditingPerkIndex] = useState<number | null>(null)
    const [editingPerkValue, setEditingPerkValue] = useState('')
    const [isAddingPerk, setIsAddingPerk] = useState(false)
    const [newPerkValue, setNewPerkValue] = useState('')
    const generatePerksMutation = useGeneratePerks()
    const { data: aiConfig } = useAIConfig()
    const isAIAvailable = aiConfig?.available ?? false
    const { data: userData } = useCurrentUser()

    // Use useShallow to prevent re-renders when unrelated store values change
    const {
        firstName,
        lastName,
        setFirstName,
        setLastName,
        username,
        purpose,
        pricingModel,
        singleAmount,
        tiers,
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
        reset,
        // Service mode fields
        serviceDescription,
        setServiceDescription,
        servicePerks,
        setServicePerks,
        bannerUrl,
    } = useOnboardingStore(useShallow((s) => ({
        firstName: s.firstName,
        lastName: s.lastName,
        setFirstName: s.setFirstName,
        setLastName: s.setLastName,
        username: s.username,
        purpose: s.purpose,
        pricingModel: s.pricingModel,
        singleAmount: s.singleAmount,
        tiers: s.tiers,
        country: s.country,
        countryCode: s.countryCode,
        currency: s.currency,
        setCurrency: s.setCurrency,
        avatarUrl: s.avatarUrl,
        paymentProvider: s.paymentProvider,
        address: s.address,
        city: s.city,
        state: s.state,
        zip: s.zip,
        currentStep: s.currentStep,
        setAvatarUrl: s.setAvatarUrl,
        setPurpose: s.setPurpose,
        setPricing: s.setPricing,
        prevStep: s.prevStep,
        reset: s.reset,
        serviceDescription: s.serviceDescription,
        setServiceDescription: s.setServiceDescription,
        servicePerks: s.servicePerks,
        setServicePerks: s.setServicePerks,
        bannerUrl: s.bannerUrl,
    })))

    // Check if we're in service mode
    const isServiceMode = purpose === 'service'

    // Use store → backend onboardingData fallback chain (handles localStorage cleared)
    const resolvedPaymentProvider = paymentProvider || userData?.onboarding?.data?.paymentProvider

    // Determine if user is a cross-border creator using Stripe
    const isCrossBorderStripe = resolvedPaymentProvider === 'stripe' && isCrossBorderCountry(countryCode)
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

    // Service mode: Generate perks when description changes and we have enough context
    const handleGeneratePerks = async () => {
        if (!serviceDescription.trim()) {
            setError('Please describe your service first')
            return
        }
        const price = parseFloat(priceInput) || 10
        try {
            const result = await generatePerksMutation.mutateAsync({
                description: serviceDescription.trim(),
                pricePerMonth: price,
                displayName: displayName || undefined,
            })
            setServicePerks(result.perks)
            setError(null)
        } catch (err: any) {
            console.error('Failed to generate perks:', err)
            setError('Failed to generate perks. Please try again.')
        }
    }

    // Note: Banner generation available in EditPage after onboarding

    // Handle perk inline editing
    const startEditingPerk = (index: number) => {
        setEditingPerkIndex(index)
        setEditingPerkValue(servicePerks[index]?.title || '')
    }

    const savePerkEdit = () => {
        if (editingPerkIndex === null) return
        const newPerks = [...servicePerks]
        if (newPerks[editingPerkIndex]) {
            newPerks[editingPerkIndex] = {
                ...newPerks[editingPerkIndex],
                title: editingPerkValue.trim() || newPerks[editingPerkIndex].title,
            }
            setServicePerks(newPerks)
        }
        setEditingPerkIndex(null)
        setEditingPerkValue('')
    }

    const cancelPerkEdit = () => {
        setEditingPerkIndex(null)
        setEditingPerkValue('')
    }

    // Manual perk entry (when AI is unavailable or user prefers manual)
    const handleAddPerk = () => {
        if (!newPerkValue.trim()) return
        if (servicePerks.length >= 3) return

        const newPerk = {
            id: `perk-${Date.now()}-${servicePerks.length}`,
            title: newPerkValue.trim(),
            enabled: true,
        }
        setServicePerks([...servicePerks, newPerk])
        setNewPerkValue('')
        setIsAddingPerk(false)
    }

    const cancelAddPerk = () => {
        setNewPerkValue('')
        setIsAddingPerk(false)
    }

    const handleDeletePerk = (index: number) => {
        const newPerks = servicePerks.filter((_, i) => i !== index)
        setServicePerks(newPerks)
    }

    const handleLaunch = async () => {
        if (!displayName || !username) {
            setError('Please fill in all fields.')
            return
        }

        if (!avatarUrl) {
            setError('Please add a profile photo.')
            return
        }

        // Service mode validation
        if (isServiceMode) {
            if (!serviceDescription.trim()) {
                setError('Please describe your service.')
                return
            }
            if (servicePerks.length < 3) {
                setError(`Please add ${3 - servicePerks.length} more perk${3 - servicePerks.length === 1 ? '' : 's'} (${servicePerks.length}/3 minimum).`)
                return
            }
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
            try {
                await api.profile.update({
                    username,
                    displayName,
                    avatarUrl,
                    purpose: resolvedPurpose,
                    currency,
                    country,
                    countryCode,
                    pricingModel: pricingModel,
                    singleAmount: pricingModel === 'single' ? finalAmount : null,
                    tiers: pricingModel === 'tiers' ? tiers.map(t => ({
                        ...t,
                        amount: typeof t.amount === 'string' ? parseFloat(t.amount) : t.amount,
                    })) : null,
                    paymentProvider: resolvedPaymentProvider,
                    // Address fields for Stripe KYC prefill (trimmed for clean data)
                    address: address?.trim() || undefined,
                    city: city?.trim() || undefined,
                    state: state?.trim() || undefined,
                    zip: zip?.trim() || undefined,
                    // Service mode fields
                    ...(isServiceMode && {
                        bio: serviceDescription.trim(),
                        bannerUrl: bannerUrl || undefined,
                        perks: servicePerks as any,
                    }),
                })
            } catch (err: any) {
                console.error('Profile update failed:', err)
                throw new Error(err?.error || 'Failed to save profile. Please try again.')
            }

            // 2. Publish Page
            try {
                await api.profile.updateSettings({ isPublic: true })
            } catch (err: any) {
                console.error('Publish failed:', err)
                // Profile saved but publish failed - user can retry
                throw new Error('Profile saved, but failed to publish. Please try again.')
            }

            // 3. Complete Onboarding - dynamic step based on flow length
            // Backend uses countryCode + purpose to determine completion threshold
            try {
                await api.auth.saveOnboardingProgress({
                    step: currentStep + 1,
                    stepKey: 'review', // Current step is review - completion triggers clear
                    data: {
                        countryCode,
                        purpose, // Redundant - ensures backend knows flow type for completion check
                    },
                })
            } catch (err: any) {
                // Page is live, just onboarding progress failed - non-critical, continue
                console.warn('Onboarding progress save failed (non-critical):', err)
            }

            // 4. Go to their new page (owner view with share button)
            reset()
            navigate(`/${username}`, { replace: true })

        } catch (err: any) {
            console.error('Launch error:', err)
            setError(err?.message || err?.error || 'Failed to launch page.')
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

                        {/* Purpose selector - disabled for service mode to prevent step mismatch */}
                        <Pressable
                            className={`setup-purpose ${isServiceMode ? 'disabled' : ''}`}
                            onClick={() => !isServiceMode && setShowPurposeDrawer(true)}
                            disabled={isServiceMode}
                        >
                            <span className="setup-purpose-label">For</span>
                            <span className="setup-purpose-value">
                                {PURPOSE_OPTIONS.find(p => p.value === resolvedPurpose)?.label || 'Support Me'}
                            </span>
                            {!isServiceMode && <ChevronDown size={16} className="setup-purpose-chevron" />}
                        </Pressable>
                    </div>

                    {/* Service Mode: Service Description */}
                    {isServiceMode && (
                        <div className="setup-card service-description-card">
                            <label className="service-description-label">
                                What do you offer?
                            </label>
                            <textarea
                                className="service-description-input"
                                value={serviceDescription}
                                onChange={(e) => setServiceDescription(e.target.value)}
                                placeholder="e.g., I help entrepreneurs build their personal brand through 1-on-1 coaching sessions..."
                                rows={3}
                            />
                        </div>
                    )}

                    {/* Service Mode: Perks */}
                    {isServiceMode && (
                        <div className="setup-card service-perks-card">
                            <div className="service-perks-header">
                                <span className="service-perks-title">What subscribers get ({servicePerks.length}{servicePerks.length < 3 ? '/3 min' : ''})</span>
                                {isAIAvailable && (
                                    <Pressable
                                        className="service-perks-generate"
                                        onClick={handleGeneratePerks}
                                        disabled={generatePerksMutation.isPending || !serviceDescription.trim()}
                                    >
                                        {generatePerksMutation.isPending ? (
                                            <Loader2 size={14} className="spin" />
                                        ) : (
                                            <Wand2 size={14} />
                                        )}
                                        <span>{servicePerks.length > 0 ? 'Regenerate' : 'Generate'}</span>
                                    </Pressable>
                                )}
                            </div>

                            {/* Existing perks list */}
                            {servicePerks.length > 0 && (
                                <div className="service-perks-list">
                                    {servicePerks.map((perk, index) => (
                                        <div key={perk.id} className="service-perk-item">
                                            {editingPerkIndex === index ? (
                                                <div className="service-perk-edit">
                                                    <input
                                                        type="text"
                                                        value={editingPerkValue}
                                                        onChange={(e) => setEditingPerkValue(e.target.value)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') savePerkEdit()
                                                            if (e.key === 'Escape') cancelPerkEdit()
                                                        }}
                                                        autoFocus
                                                        maxLength={60}
                                                    />
                                                    <Pressable onClick={savePerkEdit} className="service-perk-save">
                                                        <Check size={14} />
                                                    </Pressable>
                                                </div>
                                            ) : (
                                                <>
                                                    <span className="service-perk-check">✓</span>
                                                    <span className="service-perk-title">{perk.title}</span>
                                                    <div className="service-perk-actions">
                                                        <Pressable
                                                            className="service-perk-edit-btn"
                                                            onClick={() => startEditingPerk(index)}
                                                        >
                                                            <Edit3 size={12} />
                                                        </Pressable>
                                                        <Pressable
                                                            className="service-perk-delete-btn"
                                                            onClick={() => handleDeletePerk(index)}
                                                            disabled={servicePerks.length <= 3}
                                                        >
                                                            <X size={12} />
                                                        </Pressable>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Add perk manually (always show, max 5) */}
                            {servicePerks.length < 5 && (
                                isAddingPerk ? (
                                    <div className="service-perk-add-form">
                                        <input
                                            type="text"
                                            value={newPerkValue}
                                            onChange={(e) => setNewPerkValue(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleAddPerk()
                                                if (e.key === 'Escape') cancelAddPerk()
                                            }}
                                            placeholder="e.g., Weekly 1-on-1 calls"
                                            autoFocus
                                            maxLength={60}
                                        />
                                        <Pressable onClick={handleAddPerk} className="service-perk-save" disabled={!newPerkValue.trim()}>
                                            <Check size={14} />
                                        </Pressable>
                                        <Pressable onClick={cancelAddPerk} className="service-perk-cancel">
                                            <X size={14} />
                                        </Pressable>
                                    </div>
                                ) : (
                                    <Pressable
                                        className="service-perk-add-btn"
                                        onClick={() => setIsAddingPerk(true)}
                                    >
                                        <Plus size={14} />
                                        <span>Add perk{isAIAvailable ? ' manually' : ''}</span>
                                    </Pressable>
                                )
                            )}

                            {/* Empty state hint */}
                            {servicePerks.length === 0 && !isAddingPerk && (
                                <p className="service-perks-empty">
                                    {isAIAvailable
                                        ? 'Describe your service above, then Generate or add perks manually.'
                                        : 'Add at least 3 perks that describe what subscribers will receive.'}
                                </p>
                            )}
                        </div>
                    )}

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
                    {/* Filter out 'service' option if not already in service mode
                        to prevent confusing step jumps. Service mode requires
                        additional steps that are inserted before Review. */}
                    {PURPOSE_OPTIONS
                        .filter(option => isServiceMode || option.value !== 'service')
                        .map((option) => (
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
