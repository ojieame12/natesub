import { useState } from 'react'
import { ChevronLeft, Mic, Check, Phone, MessageSquare, FolderOpen } from 'lucide-react'
import { useOnboardingStore } from './store'
import type { ServiceDeliverable } from './store'
import { Button, Pressable } from './components'
import { VoiceRecorder } from '../components'
import './onboarding.css'

const DELIVERABLE_ICONS: Record<ServiceDeliverable['type'], React.ReactNode> = {
    calls: <Phone size={18} />,
    async: <MessageSquare size={18} />,
    resources: <FolderOpen size={18} />,
    custom: <Check size={18} />,
}

export default function ServiceDescriptionStep() {
    const {
        serviceDescription,
        serviceDescriptionAudio,
        serviceDeliverables,
        serviceCredential,
        setServiceDescription,
        setServiceDescriptionAudio,
        toggleServiceDeliverable,
        updateServiceDeliverable,
        setServiceCredential,
        nextStep,
        prevStep,
    } = useOnboardingStore()

    const [showVoice, setShowVoice] = useState(!!serviceDescriptionAudio)

    const hasDescription = serviceDescription.trim().length > 0 || serviceDescriptionAudio !== null
    const hasDeliverables = serviceDeliverables.some(d => d.enabled)
    const canContinue = hasDescription && hasDeliverables

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
                    {/* What do you help with */}
                    <div className="service-section">
                        <div className="service-description-field">
                            <textarea
                                value={serviceDescription}
                                onChange={(e) => setServiceDescription(e.target.value)}
                                placeholder="I help founders turn ideas into products..."
                                className="service-description-textarea"
                                rows={3}
                                maxLength={300}
                            />
                            <span className="service-description-count">
                                {serviceDescription.length}/300
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

                    {/* What subscribers get */}
                    <div className="service-section">
                        <label className="service-section-label">What do subscribers get?</label>
                        <div className="service-deliverables">
                            {serviceDeliverables.map((deliverable) => (
                                <div key={deliverable.id} className="service-deliverable">
                                    <Pressable
                                        className={`service-deliverable-checkbox ${deliverable.enabled ? 'checked' : ''}`}
                                        onClick={() => toggleServiceDeliverable(deliverable.id)}
                                    >
                                        {deliverable.enabled && <Check size={14} />}
                                    </Pressable>
                                    <div className="service-deliverable-icon">
                                        {DELIVERABLE_ICONS[deliverable.type]}
                                    </div>
                                    <span className="service-deliverable-label">{deliverable.label}</span>

                                    {/* Quantity input for calls */}
                                    {deliverable.type === 'calls' && deliverable.enabled && (
                                        <div className="service-deliverable-qty">
                                            <input
                                                type="number"
                                                min={1}
                                                max={20}
                                                value={deliverable.quantity || 2}
                                                onChange={(e) => updateServiceDeliverable(deliverable.id, {
                                                    quantity: parseInt(e.target.value) || 1
                                                })}
                                                className="service-qty-input"
                                            />
                                            <span className="service-qty-unit">/mo</span>
                                        </div>
                                    )}

                                    {/* Detail for async/resources */}
                                    {(deliverable.type === 'async' || deliverable.type === 'resources') && deliverable.enabled && (
                                        <input
                                            type="text"
                                            value={deliverable.detail || ''}
                                            onChange={(e) => updateServiceDeliverable(deliverable.id, {
                                                detail: e.target.value
                                            })}
                                            placeholder={deliverable.type === 'async' ? 'Slack, Email...' : 'Templates...'}
                                            className="service-detail-input"
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Your background */}
                    <div className="service-section">
                        <label className="service-section-label">Your background (optional)</label>
                        <input
                            type="text"
                            value={serviceCredential}
                            onChange={(e) => setServiceCredential(e.target.value)}
                            placeholder="10 years product leadership, ex-Google"
                            className="service-credential-input"
                            maxLength={100}
                        />
                    </div>
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={nextStep}
                        disabled={!canContinue}
                    >
                        Continue
                    </Button>
                    {!canContinue && (
                        <p className="step-hint">
                            {!hasDescription ? 'Describe your service' : 'Select at least one deliverable'}
                        </p>
                    )}
                </div>
            </div>
        </div>
    )
}
