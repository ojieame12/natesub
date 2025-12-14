import { useState } from 'react'
import { ChevronLeft, Mic } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { VoiceRecorder } from '../components'
import { uploadBlob } from '../api/hooks'
import './onboarding.css'

export default function ServiceDescriptionStep() {
    const {
        serviceDescription,
        serviceDescriptionAudio,
        serviceDescriptionAudioUrl,
        setServiceDescription,
        setServiceDescriptionAudio,
        setServiceDescriptionAudioUrl,
        nextStep,
        prevStep,
    } = useOnboardingStore()

    const [showVoice, setShowVoice] = useState(!!serviceDescriptionAudio || !!serviceDescriptionAudioUrl)
    const [isUploading, setIsUploading] = useState(false)
    const [uploadError, setUploadError] = useState<string | null>(null)

    const hasDescription = serviceDescription.trim().length > 0 || serviceDescriptionAudioUrl !== null || serviceDescriptionAudio !== null

    const handleRecorded = async (blob: Blob, _duration: number) => {
        // Store blob locally for immediate playback
        setServiceDescriptionAudio(blob)
        setUploadError(null)
        setIsUploading(true)

        try {
            // Upload to S3 and get URL
            // Use blob.type (detected by VoiceRecorder) instead of hardcoding
            const publicUrl = await uploadBlob(blob, 'voice')
            setServiceDescriptionAudioUrl(publicUrl)
            // Clear the blob after successful upload (URL is now persisted)
            setServiceDescriptionAudio(null)
        } catch (err) {
            console.error('Audio upload failed:', err)
            setUploadError('Failed to save recording. Please try again.')
            // Keep the blob so user can try again
        } finally {
            setIsUploading(false)
        }
    }

    const handleRemoveAudio = () => {
        setServiceDescriptionAudio(null)
        setServiceDescriptionAudioUrl(null)
        setUploadError(null)
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
                    <h1>What do you do?</h1>
                </div>

                <div className="step-body service-step-body">
                    <div className="service-section">
                        <div className="service-description-field">
                            <textarea
                                value={serviceDescription}
                                onChange={(e) => setServiceDescription(e.target.value)}
                                placeholder="Describe your service and what people get when they subscribe..."
                                className="service-description-textarea"
                                rows={5}
                                maxLength={500}
                            />
                            <span className="service-description-count">
                                {serviceDescription.length}/500
                            </span>
                        </div>

                        {/* Voice alternative */}
                        {showVoice || serviceDescriptionAudio || serviceDescriptionAudioUrl ? (
                            <>
                                <VoiceRecorder
                                    onRecorded={handleRecorded}
                                    onRemove={handleRemoveAudio}
                                    audioBlob={serviceDescriptionAudio}
                                    existingAudioUrl={serviceDescriptionAudioUrl}
                                    maxDuration={60}
                                    label=""
                                    isUploading={isUploading}
                                />
                                {uploadError && (
                                    <p className="voice-recorder-error" style={{ color: 'var(--status-error)', fontSize: 13, marginTop: 8 }}>
                                        {uploadError}
                                    </p>
                                )}
                            </>
                        ) : (
                            <Pressable
                                className="service-voice-trigger-small"
                                onClick={() => setShowVoice(true)}
                            >
                                <Mic size={16} />
                                <span>or record voice</span>
                            </Pressable>
                        )}
                    </div>
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={nextStep}
                        disabled={!hasDescription || isUploading}
                    >
                        {isUploading ? 'Saving recording...' : 'Continue'}
                    </Button>
                    {!hasDescription && !isUploading && (
                        <p className="step-hint">Describe what you offer</p>
                    )}
                </div>
            </div>
        </div>
    )
}
