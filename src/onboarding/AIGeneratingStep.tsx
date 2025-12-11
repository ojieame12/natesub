import { useEffect, useRef, useState } from 'react'
import { Sparkles, AlertCircle, RefreshCw, ChevronLeft } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Skeleton, Pressable } from '../components'
import { Button } from './components'
import { useAIGenerate, blobToBase64 } from '../api/hooks'
import './onboarding.css'

export default function AIGeneratingStep() {
    const {
        serviceDescription,
        serviceDescriptionAudio,
        serviceDeliverables,
        serviceCredential,
        name,
        singleAmount,
        setGeneratedContent,
        setIsGenerating,
        nextStep,
        prevStep,
    } = useOnboardingStore()

    const { mutateAsync: generatePage } = useAIGenerate()
    const hasStarted = useRef(false)
    const [error, setError] = useState<string | null>(null)

    const generate = async () => {
        setError(null)
        setIsGenerating(true)

        try {
            // Prepare input
            let audioData: { data: string; mimeType: string } | undefined

            if (serviceDescriptionAudio) {
                const base64 = await blobToBase64(serviceDescriptionAudio)
                audioData = {
                    data: base64,
                    mimeType: serviceDescriptionAudio.type || 'audio/webm',
                }
            }

            // Format deliverables for API
            const enabledDeliverables = serviceDeliverables
                .filter(d => d.enabled)
                .map(d => ({
                    type: d.type,
                    label: d.label,
                    quantity: d.quantity,
                    detail: d.detail,
                }))

            // Call real API
            const result = await generatePage({
                audio: audioData,
                textDescription: serviceDescription || undefined,
                deliverables: enabledDeliverables,
                credential: serviceCredential || undefined,
                price: singleAmount || 25,
                userName: name || 'Creator',
                includeMarketResearch: false,
            })

            setGeneratedContent(
                result.bio,
                result.perks,
                result.impactItems
            )
            setIsGenerating(false)
            nextStep()
        } catch (err: any) {
            console.error('AI generation failed:', err)
            setIsGenerating(false)
            setError(err?.error || 'Failed to generate your page. Please try again.')
        }
    }

    useEffect(() => {
        // Prevent double-execution in React StrictMode
        if (hasStarted.current) return
        hasStarted.current = true
        generate()
    }, [])

    // Allow retry
    const handleRetry = () => {
        generate()
    }

    // Skip and enter content manually
    const handleSkip = () => {
        setGeneratedContent('', [], [])
        nextStep()
    }

    // Error state
    if (error) {
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

                <div className="onboarding-content ai-generating-content">
                    <div className="ai-generating-center">
                        <div className="ai-generating-icon" style={{ background: 'var(--status-error)', opacity: 0.1 }}>
                            <AlertCircle size={32} style={{ color: 'var(--status-error)' }} />
                        </div>
                        <h2 className="ai-generating-title">Generation failed</h2>
                        <p className="ai-generating-subtitle">{error}</p>
                    </div>

                    <div className="step-footer" style={{ marginTop: 'auto' }}>
                        <Button
                            variant="primary"
                            size="lg"
                            fullWidth
                            onClick={handleRetry}
                        >
                            <RefreshCw size={18} style={{ marginRight: 8 }} />
                            Try Again
                        </Button>
                        <div style={{ marginTop: 12 }}>
                            <Button
                                variant="secondary"
                                size="lg"
                                fullWidth
                                onClick={handleSkip}
                            >
                                Skip and enter manually
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    // Loading state
    return (
        <div className="onboarding">
            <div className="onboarding-logo-header">
                <img src="/logo.svg" alt="NatePay" />
            </div>

            <div className="onboarding-content ai-generating-content">
                <div className="ai-generating-center">
                    <div className="ai-generating-icon">
                        <Sparkles size={32} />
                    </div>
                    <h2 className="ai-generating-title">Creating your page</h2>
                    <p className="ai-generating-subtitle">This will only take a moment</p>
                </div>

                <div className="ai-generating-skeletons">
                    <div className="ai-skeleton-card">
                        <Skeleton className="ai-skeleton-label" style={{ width: '60px', height: '12px' }} />
                        <Skeleton className="ai-skeleton-text" style={{ width: '100%', height: '48px' }} />
                    </div>
                    <div className="ai-skeleton-card" style={{ animationDelay: '0.1s' }}>
                        <Skeleton className="ai-skeleton-label" style={{ width: '100px', height: '12px' }} />
                        <Skeleton className="ai-skeleton-line" style={{ width: '90%', height: '16px' }} />
                        <Skeleton className="ai-skeleton-line" style={{ width: '85%', height: '16px' }} />
                        <Skeleton className="ai-skeleton-line" style={{ width: '80%', height: '16px' }} />
                    </div>
                    <div className="ai-skeleton-card" style={{ animationDelay: '0.2s' }}>
                        <Skeleton className="ai-skeleton-label" style={{ width: '80px', height: '12px' }} />
                        <Skeleton className="ai-skeleton-line" style={{ width: '75%', height: '16px' }} />
                        <Skeleton className="ai-skeleton-line" style={{ width: '70%', height: '16px' }} />
                        <Skeleton className="ai-skeleton-line" style={{ width: '65%', height: '16px' }} />
                    </div>
                </div>
            </div>
        </div>
    )
}
