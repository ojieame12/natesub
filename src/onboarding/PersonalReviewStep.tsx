import { useState } from 'react'
import { ChevronLeft, ChevronRight, Pencil, Check, Loader2, AlertCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { getShareableLink } from '../utils/constants'
import { getCurrencySymbol, formatCompactNumber } from '../utils/currency'
import { calculateFeePreview, getPricing } from '../utils/pricing'
import { api } from '../api'
import './onboarding.css'

const PURPOSE_LABELS: Record<string, string> = {
    tips: 'Tips & Appreciation',
    support: 'Support Me',
    allowance: 'Allowance',
    fan_club: 'Fan Club',
    exclusive_content: 'Exclusive Content',
    other: 'Other',
}

type EditingField = 'name' | 'bio' | 'username' | null

interface ReviewRowProps {
    label: string
    value: string
    onEdit?: (value: string) => void
    onNavigate?: () => void
    multiline?: boolean
    editing?: boolean
    onStartEdit?: () => void
    onEndEdit?: () => void
    readonly?: boolean
}

function ReviewRow({
    label,
    value,
    onEdit,
    onNavigate,
    multiline,
    editing,
    onStartEdit,
    onEndEdit,
    readonly
}: ReviewRowProps) {
    const [localValue, setLocalValue] = useState(value)

    const handleSave = () => {
        if (onEdit) onEdit(localValue)
        onEndEdit?.()
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !multiline) {
            handleSave()
        }
    }

    if (editing && onEdit) {
        return (
            <div className="review-row review-row-editing">
                <span className="review-row-label">{label}</span>
                <div className="review-row-input-group">
                    {multiline ? (
                        <textarea
                            className="review-row-textarea"
                            value={localValue}
                            onChange={(e) => setLocalValue(e.target.value)}
                            autoFocus
                            rows={3}
                        />
                    ) : (
                        <input
                            className="review-row-input"
                            value={localValue}
                            onChange={(e) => setLocalValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            autoFocus
                        />
                    )}
                    <Pressable className="review-row-save" onClick={handleSave}>
                        <Check size={18} />
                    </Pressable>
                </div>
            </div>
        )
    }

    const isNavigable = !!onNavigate
    const isEditable = !!onEdit && !readonly

    return (
        <Pressable
            className={`review-row ${isNavigable || isEditable ? 'review-row-interactive' : ''}`}
            onClick={() => {
                if (onNavigate) {
                    onNavigate()
                } else if (isEditable) {
                    onStartEdit?.()
                }
            }}
            disabled={readonly && !onNavigate}
        >
            <span className="review-row-label">{label}</span>
            <div className="review-row-right">
                <span className={`review-row-value ${!value ? 'review-row-empty' : ''}`}>
                    {value || 'Not set'}
                </span>
                {isNavigable && <ChevronRight size={18} className="review-row-chevron" />}
                {isEditable && !isNavigable && <Pencil size={14} className="review-row-pencil" />}
            </div>
        </Pressable>
    )
}

export default function PersonalReviewStep() {
    const navigate = useNavigate()
    const [editingField, setEditingField] = useState<EditingField>(null)
    const [launching, setLaunching] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const {
        name,
        username,
        bio,
        purpose,
        branch,
        pricingModel,
        singleAmount,
        tiers,
        impactItems,
        perks,
        country,
        countryCode,
        currency,
        avatarUrl,
        voiceIntroUrl,
        paymentProvider,
        feeMode,
        setName,
        setBio,
        setUsername,
        setFeeMode,
        goToStep,
        prevStep,
        reset
    } = useOnboardingStore()

    const handleLaunch = async () => {
        setLaunching(true)
        setError(null)

        try {
            // 1. Save profile to backend
            const profileData = {
                username,
                displayName: name,
                bio: bio || undefined,
                avatarUrl: avatarUrl || undefined,
                voiceIntroUrl: voiceIntroUrl || undefined,
                country,
                countryCode,
                currency,
                purpose: purpose || 'tips',
                pricingModel,
                singleAmount: pricingModel === 'single' ? singleAmount : undefined,
                tiers: pricingModel === 'tiers' ? tiers : undefined,
                perks: perks.filter(p => p.enabled),
                impactItems,
                feeMode,
            }

            await api.profile.update(profileData)
            console.log('Profile saved successfully')

            // 2. Initiate Stripe connect if selected
            if (paymentProvider === 'stripe') {
                try {
                    const stripeResult = await api.stripe.connect()

                    if (stripeResult.error) {
                        // Show error but don't block - user can set up payments later
                        console.warn('Stripe connect warning:', stripeResult.error)
                        setError(stripeResult.suggestion || stripeResult.error)
                        // Wait a bit then continue anyway
                        await new Promise(resolve => setTimeout(resolve, 2000))
                    } else if (stripeResult.onboardingUrl) {
                        // Mark source for when we return from Stripe
                        sessionStorage.setItem('stripe_onboarding_source', 'onboarding')
                        // Redirect to Stripe for onboarding
                        window.location.href = stripeResult.onboardingUrl
                        return // Don't navigate to dashboard yet - return early!
                    } else if (stripeResult.alreadyOnboarded) {
                        console.log('Stripe already connected')
                    }
                } catch (stripeErr: any) {
                    console.warn('Stripe setup deferred:', stripeErr)
                    // Don't block launch if Stripe fails - they can set up later
                    if (stripeErr?.error?.includes('not available')) {
                        setError('Stripe is not available in your country. You can set up payments later in Settings.')
                        await new Promise(resolve => setTimeout(resolve, 2000))
                    }
                }
            }

            // 3. Clear onboarding store and navigate to dashboard
            reset()
            navigate('/dashboard')

        } catch (err: any) {
            console.error('Launch error:', err)
            setError(err?.error || 'Failed to save profile. Please try again.')
            setLaunching(false)
        }
    }

    // Format pricing display
    const currencySymbol = getCurrencySymbol(currency)
    const getPricingDisplay = () => {
        if (pricingModel === 'single') {
            return `${currencySymbol}${formatCompactNumber(singleAmount || 0)}/month`
        }
        const tierCount = tiers.length
        const minPrice = Math.min(...tiers.map(t => t.amount))
        return `${tierCount} tiers from ${currencySymbol}${formatCompactNumber(minPrice)}/mo`
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
                    <h1>Ready to launch?</h1>
                    <p>Review your page before going live.</p>
                </div>

                <div className="step-body">
                    <div className="review-card">
                        <ReviewRow
                            label="Your Link"
                            value={getShareableLink(username || '...')}
                            readonly
                        />
                        <ReviewRow
                            label="Username"
                            value={username}
                            onEdit={setUsername}
                            editing={editingField === 'username'}
                            onStartEdit={() => setEditingField('username')}
                            onEndEdit={() => setEditingField(null)}
                        />
                        <ReviewRow
                            label="Display Name"
                            value={name}
                            onEdit={setName}
                            editing={editingField === 'name'}
                            onStartEdit={() => setEditingField('name')}
                            onEndEdit={() => setEditingField(null)}
                        />
                        <ReviewRow
                            label="About"
                            value={bio}
                            onEdit={setBio}
                            multiline
                            editing={editingField === 'bio'}
                            onStartEdit={() => setEditingField('bio')}
                            onEndEdit={() => setEditingField(null)}
                        />
                        <ReviewRow
                            label="Purpose"
                            value={purpose ? PURPOSE_LABELS[purpose] : ''}
                            onNavigate={() => goToStep(3)} // Navigate to purpose step
                        />
                        <ReviewRow
                            label="Pricing"
                            value={getPricingDisplay()}
                            onNavigate={() => goToStep(4)} // Navigate to pricing step
                        />
                    </div>

                    {/* Fee Mode Toggle */}
                    <div className="fee-mode-section">
                        <div className="fee-mode-header">
                            <span className="fee-mode-title">Platform fee ({getPricing(branch === 'service' ? 'service' : 'personal').transactionFeeLabel})</span>
                        </div>

                        <div className="fee-mode-toggle">
                            <Pressable
                                className={`fee-mode-option ${feeMode === 'absorb' ? 'active' : ''}`}
                                onClick={() => setFeeMode('absorb')}
                            >
                                I absorb
                            </Pressable>
                            <Pressable
                                className={`fee-mode-option ${feeMode === 'pass_to_subscriber' ? 'active' : ''}`}
                                onClick={() => setFeeMode('pass_to_subscriber')}
                            >
                                Subscriber pays
                            </Pressable>
                        </div>

                        {(() => {
                            const baseAmount = pricingModel === 'single'
                                ? (singleAmount || 0) * 100  // Convert to cents
                                : (tiers[0]?.amount || 0) * 100
                            const preview = calculateFeePreview(baseAmount, branch === 'service' ? 'service' : 'personal', feeMode)
                            return (
                                <div className="fee-mode-preview">
                                    <div className="fee-preview-row">
                                        <span>Subscribers pay</span>
                                        <span className="fee-preview-amount">{currencySymbol}{formatCompactNumber(preview.subscriberPays / 100)}</span>
                                    </div>
                                    <div className="fee-preview-row">
                                        <span>You receive</span>
                                        <span className="fee-preview-amount">{currencySymbol}{formatCompactNumber(preview.creatorReceives / 100)}</span>
                                    </div>
                                </div>
                            )
                        })()}
                    </div>
                </div>

                {error && (
                    <div style={{
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

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={handleLaunch}
                        disabled={launching}
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
        </div>
    )
}
