import { useState } from 'react'
import { ChevronLeft, Mic } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { VoiceRecorder } from '../components'
import './onboarding.css'

export default function ServiceDescriptionStep() {
    const {
        serviceDescription,
        serviceDescriptionAudio,
        setServiceDescription,
        setServiceDescriptionAudio,
        nextStep,
        prevStep,
    } = useOnboardingStore()

    const [showVoice, setShowVoice] = useState(!!serviceDescriptionAudio)

    const hasDescription = serviceDescription.trim().length > 0 || serviceDescriptionAudio !== null

    const handleRecorded = (blob: Blob, _duration: number) => {
        setServiceDescriptionAudio(blob)
    }

    const handleRemoveAudio = () => {
        setServiceDescriptionAudio(null)
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
                        {showVoice || serviceDescriptionAudio ? (
                            <VoiceRecorder
                                onRecorded={handleRecorded}
                                onRemove={handleRemoveAudio}
                                audioBlob={serviceDescriptionAudio}
                                maxDuration={60}
                                label=""
                            />
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
                        disabled={!hasDescription}
                    >
                        Continue
                    </Button>
                    {!hasDescription && (
                        <p className="step-hint">Describe what you offer</p>
                    )}
                </div>
            </div>
        </div>
    )
}
