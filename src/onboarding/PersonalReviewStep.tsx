import { useState, useRef } from 'react'
import { ChevronLeft, ChevronDown, Check, Loader2, AlertCircle, Camera } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { getShareableLink } from '../utils/constants'
import { getCurrencySymbol } from '../utils/currency'
import { api } from '../api'
import { uploadFile } from '../api/hooks'
import './onboarding.css'

// Purpose options
type Purpose = 'tips' | 'support' | 'allowance' | 'fan_club' | 'exclusive_content' | 'service' | 'other'
const PURPOSE_OPTIONS: { value: Purpose; label: string }[] = [
    { value: 'support', label: 'Support Me' },
    { value: 'tips', label: 'Tips & Appreciation' },
    { value: 'service', label: 'Services' },
    { value: 'fan_club', label: 'Fan Club' },
    { value: 'exclusive_content', label: 'Exclusive Content' },
    { value: 'allowance', label: 'Allowance' },
    { value: 'other', label: 'Other' },
]

export default function PersonalReviewStep() {
    const navigate = useNavigate()
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [launching, setLaunching] = useState(false)
    const [isUploading, setIsUploading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [showPurposeDrawer, setShowPurposeDrawer] = useState(false)

    const {
        name,
        username,
        purpose,
        branch,
        singleAmount,
        country,
        countryCode,
        currency,
        avatarUrl,
        paymentProvider,
        setName,
        setAvatarUrl,
        setPurpose,
        setPricing,
        tiers,
        prevStep,
        reset
    } = useOnboardingStore()

    const resolvedPurpose = branch === 'service' ? 'service' : (purpose || 'support')
    const currencySymbol = getCurrencySymbol(currency)

    // Price input as string for free editing
    const [priceInput, setPriceInput] = useState(String(singleAmount || 10))

    const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value
        if (val === '' || /^\d*\.?\d*$/.test(val)) {
            setPriceInput(val)
            const numVal = parseFloat(val) || 0
            setPricing('single', tiers, numVal)
        }
    }

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

    const handleLaunch = async () => {
        if (!name || !username) {
            setError('Please fill in all fields.')
            return
        }

        const finalAmount = parseFloat(priceInput) || 0
        if (finalAmount <= 0) {
            setError('Please set a price.')
            return
        }

        setLaunching(true)
        setError(null)

        try {
            // 1. Final Profile Update
            await api.profile.update({
                username,
                displayName: name,
                avatarUrl,
                purpose: resolvedPurpose,
                currency,
                country,
                countryCode,
                pricingModel: 'single',
                singleAmount: finalAmount,
                tiers: null,
                paymentProvider,
            })

            // 2. Publish Page
            await api.profile.updateSettings({ isPublic: true })

            // 3. Complete Onboarding
            await api.auth.saveOnboardingProgress({ step: 7, data: {} })

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
                                    {name ? name.charAt(0).toUpperCase() : 'U'}
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

                        {/* Display Name */}
                        <input
                            type="text"
                            className="setup-name-input"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Your name"
                        />

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
                        <span className="setup-price-currency">{currencySymbol}</span>
                        <input
                            type="text"
                            inputMode="decimal"
                            className="setup-price-input"
                            value={priceInput}
                            onChange={handlePriceChange}
                            placeholder="10"
                        />
                        <span className="setup-price-period">/month</span>
                    </div>
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

            {/* Purpose Drawer */}
            {showPurposeDrawer && (
                <>
                    <div
                        className="drawer-overlay"
                        onClick={() => setShowPurposeDrawer(false)}
                    />
                    <div className="country-drawer">
                        <div className="drawer-handle" />
                        <h3 className="drawer-title">What's this for?</h3>
                        <div className="country-list">
                            {PURPOSE_OPTIONS.map((option) => (
                                <Pressable
                                    key={option.value}
                                    className={`country-option ${resolvedPurpose === option.value ? 'selected' : ''}`}
                                    onClick={() => {
                                        setPurpose(option.value)
                                        setShowPurposeDrawer(false)
                                    }}
                                >
                                    <span className="country-option-name">{option.label}</span>
                                    {resolvedPurpose === option.value && (
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
