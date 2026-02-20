import { useState, useEffect, useRef } from 'react'
import { ChevronLeft, AlertCircle, Loader2, Check, Sparkles } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { useGeneratePerks, useAIConfig, useSaveOnboardingProgress } from '../api/hooks'
import { saveRetryQueue } from './saveRetryQueue'
import type { ServicePerk } from './store'
import './onboarding.css'

const PLACEHOLDER_EXAMPLES = [
    'I help entrepreneurs build their personal brand through 1-on-1 coaching...',
    'Weekly fitness coaching with personalized meal plans and workout routines...',
    'Monthly design retainer for startups - logos, social media, and branding...',
    'Private music lessons and feedback on your compositions...',
]

// Default placeholder perks when AI is unavailable or user skips
const PLACEHOLDER_PERKS: ServicePerk[] = [
    { id: 'placeholder-1', title: 'Monthly subscription access', enabled: true },
    { id: 'placeholder-2', title: 'Direct support for my work', enabled: true },
    { id: 'placeholder-3', title: 'Exclusive updates and content', enabled: true },
]

export default function ServiceStep() {
    const {
        serviceDescription,
        setServiceDescription,
        servicePerks,
        setServicePerks,
        firstName,
        singleAmount,
        nextStep,
        prevStep,
        currentStep,
    } = useOnboardingStore()
    const { mutateAsync: saveProgress } = useSaveOnboardingProgress()

    const [localDescription, setLocalDescription] = useState(serviceDescription)
    const [isSaving, setIsSaving] = useState(false)
    const [saveError, setSaveError] = useState<string | null>(null)
    const [isGenerating, setIsGenerating] = useState(false)
    const [generationError, setGenerationError] = useState<string | null>(null)
    const [hasGenerated, setHasGenerated] = useState(servicePerks.length >= 3)
    const userHasEditedDescription = useRef(false)

    // AI config and perk generation
    const { data: aiConfig, isError: isAIConfigError } = useAIConfig()
    const isAIAvailable = isAIConfigError ? false : (aiConfig?.available ?? false)
    const generatePerksMutation = useGeneratePerks()

    // Display name for perk generation
    const displayName = firstName || undefined

    // Rotate placeholder on mount
    const [placeholderIndex] = useState(() => Math.floor(Math.random() * PLACEHOLDER_EXAMPLES.length))
    const placeholder = PLACEHOLDER_EXAMPLES[placeholderIndex]

    // Sync from store on hydration
    useEffect(() => {
        if (!userHasEditedDescription.current && serviceDescription && serviceDescription !== localDescription) {
            setLocalDescription(serviceDescription)
        }
    }, [serviceDescription, localDescription])

    // If we already have perks (returning to step), show them
    useEffect(() => {
        if (servicePerks.length >= 3) {
            setHasGenerated(true)
        }
    }, [servicePerks.length])

    const MAX_DESCRIPTION_LENGTH = 500
    const descLength = localDescription.trim().length
    const isDescriptionValid = descLength >= 20 && descLength <= MAX_DESCRIPTION_LENGTH

    // Generate perks inline
    const handleGeneratePerks = async () => {
        if (!isDescriptionValid) return

        setIsGenerating(true)
        setGenerationError(null)
        setServiceDescription(localDescription.trim())

        try {
            if (isAIAvailable) {
                const result = await generatePerksMutation.mutateAsync({
                    description: localDescription.trim(),
                    pricePerMonth: singleAmount || 10,
                    displayName,
                })
                setServicePerks(result.perks)
            } else {
                // AI unavailable — use placeholder perks
                setServicePerks(PLACEHOLDER_PERKS)
            }
            setHasGenerated(true)
        } catch (err: unknown) {
            console.error('Perk generation failed:', err)
            // Fallback to placeholder perks on error
            setServicePerks(PLACEHOLDER_PERKS)
            setHasGenerated(true)
            setGenerationError('AI generation unavailable. Using default perks — you can customize them later.')
        } finally {
            setIsGenerating(false)
        }
    }

    const handleContinue = async () => {
        if (!isDescriptionValid) return

        setIsSaving(true)
        setSaveError(null)

        // Ensure perks exist (generate placeholders if somehow missing)
        let finalPerks = servicePerks
        if (finalPerks.length < 3) {
            finalPerks = PLACEHOLDER_PERKS
            setServicePerks(finalPerks)
        }

        setServiceDescription(localDescription.trim())

        try {
            await saveProgress({
                step: currentStep + 1,
                stepKey: 'review', // After service is always review
                data: {
                    serviceDescription: localDescription.trim(),
                    servicePerks: finalPerks,
                    purpose: 'service',
                },
            })
            nextStep()
        } catch (err) {
            console.warn('[ServiceStep] Failed to save progress:', err)
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
                <Pressable className="onboarding-back" onClick={prevStep}>
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
                    <h1>Describe your service</h1>
                    <p>
                        {firstName ? `${firstName}, tell` : 'Tell'} us what you offer so we can create your page.
                    </p>
                </div>

                <div className="step-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Description */}
                    <div className="service-description-step-card">
                        <textarea
                            className="service-description-step-input"
                            value={localDescription}
                            onChange={(e) => {
                                userHasEditedDescription.current = true
                                setLocalDescription(e.target.value)
                                // Reset generated state when description changes
                                if (hasGenerated) setHasGenerated(false)
                            }}
                            placeholder={placeholder}
                            rows={4}
                            autoFocus
                            data-testid="service-description-input"
                        />
                        <div className="service-description-step-hint">
                            {descLength < 20 ? (
                                <span className="hint-warning">At least 20 characters needed</span>
                            ) : descLength > MAX_DESCRIPTION_LENGTH ? (
                                <span className="hint-warning">{descLength}/{MAX_DESCRIPTION_LENGTH} - Too long</span>
                            ) : (
                                <span className="hint-success">{descLength}/{MAX_DESCRIPTION_LENGTH}</span>
                            )}
                        </div>
                    </div>

                    {/* Generate Perks Button / Results */}
                    {!hasGenerated ? (
                        <Button
                            variant="secondary"
                            size="lg"
                            fullWidth
                            onClick={handleGeneratePerks}
                            disabled={!isDescriptionValid || isGenerating}
                            data-testid="generate-perks-btn"
                        >
                            {isGenerating ? (
                                <>
                                    <Loader2 size={18} className="spin" style={{ marginRight: 8 }} />
                                    Generating perks...
                                </>
                            ) : (
                                <>
                                    <Sparkles size={18} style={{ marginRight: 8 }} />
                                    Generate Perks
                                </>
                            )}
                        </Button>
                    ) : (
                        <div className="service-step-perks" data-testid="service-perks">
                            <div className="service-step-perks-header">
                                <h3>Your Perks</h3>
                                <Pressable
                                    className="service-step-regenerate"
                                    onClick={handleGeneratePerks}
                                    disabled={isGenerating || !isDescriptionValid}
                                >
                                    {isGenerating ? (
                                        <Loader2 size={14} className="spin" />
                                    ) : (
                                        <Sparkles size={14} />
                                    )}
                                    <span>Regenerate</span>
                                </Pressable>
                            </div>
                            <div className="service-step-perk-list">
                                {servicePerks.map((perk, index) => (
                                    <div key={perk.id || index} className="service-step-perk-item">
                                        <Check size={16} style={{ color: 'var(--status-success)', flexShrink: 0 }} />
                                        <span>{perk.title}</span>
                                    </div>
                                ))}
                            </div>
                            <p className="service-step-perk-hint">You can edit these after launch</p>
                        </div>
                    )}

                    {generationError && (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '8px 12px',
                            background: 'rgba(245, 158, 11, 0.1)',
                            borderRadius: 8,
                            fontSize: 13,
                            color: 'var(--warning, #D97706)',
                        }}>
                            <AlertCircle size={16} />
                            <span>{generationError}</span>
                        </div>
                    )}
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={handleContinue}
                        disabled={!isDescriptionValid || isSaving}
                        data-testid="service-continue-btn"
                    >
                        {isSaving ? (
                            <Loader2 size={20} className="spin" />
                        ) : (
                            'Continue'
                        )}
                    </Button>
                </div>
            </div>
        </div>
    )
}
