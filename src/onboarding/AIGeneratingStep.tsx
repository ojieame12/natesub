import { useEffect, useRef, useState } from 'react'
import { Sparkles, AlertCircle, RefreshCw, ChevronLeft } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Skeleton, Pressable } from '../components'
import { Button } from './components'
import { useAIGenerate, blobToBase64 } from '../api/hooks'
import './onboarding.css'

// Helper to fetch audio from URL and convert to base64
async function fetchAudioAsBase64(url: string): Promise<string> {
    const response = await fetch(url)
    if (!response.ok) throw new Error('Failed to fetch audio')
    const blob = await response.blob()
    return blobToBase64(blob)
}

export default function AIGeneratingStep() {
    const {
        serviceDescription,
        serviceDescriptionAudioUrl,
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
            // Prepare input - fetch audio from S3 URL and convert to base64
            let audioData: { data: string; mimeType: string } | undefined

            if (serviceDescriptionAudioUrl) {
                // Fetch the audio from S3 and convert to base64 for the AI
                const base64 = await fetchAudioAsBase64(serviceDescriptionAudioUrl)
                audioData = {
                    data: base64,
                    mimeType: 'audio/webm',
                }
            }

            // Call real API
            const result = await generatePage({
                audio: audioData,
                textDescription: serviceDescription || undefined,
                price: singleAmount || 25,
                userName: name || '',
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
