import { useState } from 'react'
import { ChevronLeft, ChevronRight, Pencil, Check, Loader2, AlertCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { getShareableLink } from '../utils/constants'
import { getCurrencySymbol, formatCompactNumber } from '../utils/currency'
import { calculateFeePreview } from '../utils/currency'
import { getPricing } from '../utils/pricing'
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

type EditingField = 'name' | 'username' | null

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
        setUsername,
        setFeeMode,
        prevStep,
        reset
    } = useOnboardingStore()

    const resolvedPurpose = branch === 'service' ? 'service' : (purpose || 'support')

    const handleLaunch = async () => {
        if (!name || !username) {
            setError('Please fill in all fields.')
            return
        }

        setLaunching(true)
        setError(null)

        try {
            // 1. Final Profile Update (persist edits from this step)
            await api.profile.update({
                username,
                displayName: name,
                avatarUrl,
                voiceIntroUrl,
                purpose: resolvedPurpose,
                feeMode,
                currency,
                country,
                countryCode,
                pricingModel,
                singleAmount: pricingModel === 'single' ? singleAmount : null,
                tiers: pricingModel === 'tiers' ? tiers : null,
                perks: perks.map(p => ({
                    id: p.id,
                    title: p.title,
                    enabled: p.enabled,
                })),
                impactItems: impactItems.map(i => ({
                    id: i.id,
                    title: i.title,
                    subtitle: i.subtitle,
                })),
                paymentProvider,
            })

            // 2. Publish Page
            await api.profile.updateSettings({ isPublic: true })

            // 3. Complete Onboarding
            await api.auth.saveOnboardingProgress({ step: 7, data: {} })

            // 4. Go to Dashboard
            reset()
            navigate('/dashboard', { replace: true })

        } catch (err: any) {
            console.error('Launch error:', err)
            setError(err?.error || 'Failed to launch page.')
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
                            label="Purpose"
                            value={PURPOSE_LABELS[resolvedPurpose] || ''}
                            readonly
                        />
                        <ReviewRow
                            label="Pricing"
                            value={getPricingDisplay()}
                            readonly
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
                                ? (singleAmount || 0)
                                : (tiers[0]?.amount || 0)
                            const preview = calculateFeePreview(baseAmount, currency, resolvedPurpose, feeMode)
                            return (
                                <div className="fee-mode-preview">
                                    <div className="fee-preview-row">
                                        <span>Subscribers pay</span>
                                        <span className="fee-preview-amount">{currencySymbol}{formatCompactNumber(preview.subscriberPays)}</span>
                                    </div>
                                    <div className="fee-preview-row">
                                        <span>You receive</span>
                                        <span className="fee-preview-amount">{currencySymbol}{formatCompactNumber(preview.creatorReceives)}</span>
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
