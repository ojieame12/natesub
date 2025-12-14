import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { VoiceRecorder } from '../components'
import { uploadBlob } from '../api/hooks'
import './onboarding.css'

export default function VoiceIntroStep() {
    const {
        voiceIntroUrl,
        setVoiceIntroUrl,
        // For service branch, use serviceDescriptionAudioUrl as fallback
        branch,
        serviceDescriptionAudioUrl,
        nextStep,
        prevStep,
    } = useOnboardingStore()

    // For service providers who recorded audio in ServiceDescriptionStep,
    // use that as the default voice intro
    const existingUrl = voiceIntroUrl || (branch === 'service' ? serviceDescriptionAudioUrl : null)

    const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
    const [audioUrl, setAudioUrl] = useState<string | null>(existingUrl)
    const [isUploading, setIsUploading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleRecorded = async (blob: Blob, _duration: number) => {
        setAudioBlob(blob)
        setError(null)
        setIsUploading(true)

        try {
            // Use blob.type (detected by VoiceRecorder) instead of hardcoding
            const publicUrl = await uploadBlob(blob, 'voice')
            setAudioUrl(publicUrl)
            setVoiceIntroUrl(publicUrl)
            setAudioBlob(null)
        } catch (err) {
            console.error('Voice upload failed:', err)
            setError('Failed to save recording. Please try again.')
        } finally {
            setIsUploading(false)
        }
    }

    const handleRemove = () => {
        setAudioBlob(null)
        setAudioUrl(null)
        setVoiceIntroUrl(null)
        setError(null)
    }

    const hasRecording = audioUrl || audioBlob

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
                    <h1>Add a voice intro</h1>
                    <p>Let subscribers hear from you directly. A personal touch goes a long way.</p>
                </div>

                <div className="step-body">
                    <VoiceRecorder
                        onRecorded={handleRecorded}
                        onRemove={handleRemove}
                        audioBlob={audioBlob}
                        existingAudioUrl={audioUrl}
                        maxDuration={60}
                        label=""
                        hint="Up to 60 seconds. Introduce yourself or share what makes your offering special."
                        isUploading={isUploading}
                    />

                    {error && (
                        <p style={{
                            color: 'var(--status-error)',
                            fontSize: 13,
                            marginTop: 12,
                            textAlign: 'center'
                        }}>
                            {error}
                        </p>
                    )}
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={nextStep}
                        disabled={isUploading}
                    >
                        {isUploading ? 'Saving...' : hasRecording ? 'Continue' : 'Skip for now'}
                    </Button>
                    {!hasRecording && (
                        <p className="step-hint">You can add this later from your settings</p>
                    )}
                </div>
            </div>
        </div>
    )
}
