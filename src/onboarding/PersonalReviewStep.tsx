import { useState } from 'react'
import { ChevronLeft, ChevronRight, Pencil, Check } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { getShareableLink } from '../utils/constants'
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

    const {
        name,
        username,
        bio,
        purpose,
        pricingModel,
        singleAmount,
        tiers,
        setName,
        setBio,
        setUsername,
        goToStep,
        prevStep
    } = useOnboardingStore()

    const handleLaunch = () => {
        console.log('Launching page:', { name, username, bio, purpose, pricingModel, singleAmount, tiers })
        navigate('/dashboard')
    }

    // Format pricing display
    const getPricingDisplay = () => {
        if (pricingModel === 'single') {
            return `$${singleAmount}/month`
        }
        const tierCount = tiers.length
        const minPrice = Math.min(...tiers.map(t => t.amount))
        return `${tierCount} tiers from $${minPrice}/mo`
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
                </div>

                <div className="step-footer">
                    <Button variant="primary" size="lg" fullWidth onClick={handleLaunch}>
                        Launch My Page
                    </Button>
                </div>
            </div>
        </div>
    )
}
