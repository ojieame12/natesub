import { useEffect, useRef } from 'react'
import { Sparkles } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Skeleton } from '../components'
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
    } = useOnboardingStore()

    const { mutateAsync: generatePage } = useAIGenerate()
    const hasStarted = useRef(false)

    useEffect(() => {
        // Prevent double-execution in React StrictMode
        if (hasStarted.current) return
        hasStarted.current = true

        let cancelled = false

        const generate = async () => {
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
                    includeMarketResearch: false, // Keep it fast for onboarding
                })

                if (!cancelled) {
                    setGeneratedContent(
                        result.bio,
                        result.perks,
                        result.impactItems
                    )
                    setIsGenerating(false)
                    nextStep()
                }
            } catch (error) {
                console.error('AI generation failed:', error)
                if (!cancelled) {
                    setIsGenerating(false)
                    // Still advance - user can manually enter content
                    nextStep()
                }
            }
        }

        generate()

        return () => {
            cancelled = true
        }
    }, []) // Empty deps - run once on mount

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
