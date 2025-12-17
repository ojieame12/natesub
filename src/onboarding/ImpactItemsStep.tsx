// @ts-nocheck
import { ChevronLeft } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import './onboarding.css'

export default function ImpactItemsStep() {
    const { impactItems, updateImpactItem, nextStep, prevStep } = useOnboardingStore()

    // Check if at least one item has content
    const hasContent = impactItems.some(item => item.title.trim() !== '')

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
                    <h1>How would it help you?</h1>
                    <p>Tell subscribers why their support matters. Be personal and honest.</p>
                </div>

                <div className="step-body">
                    <div className="impact-list">
                        {impactItems.map((item, index) => (
                            <div key={item.id} className="impact-card">
                                <div className="impact-card-header">
                                    <div className="impact-number">{index + 1}</div>
                                    <span className="impact-card-label">Impact {index + 1}</span>
                                </div>
                                <div className="impact-input-group">
                                    <input
                                        type="text"
                                        className="impact-input title"
                                        placeholder="What it helps with..."
                                        value={item.title}
                                        onChange={(e) => updateImpactItem(item.id, { title: e.target.value })}
                                    />
                                    <input
                                        type="text"
                                        className="impact-input subtitle"
                                        placeholder="A little more detail (optional)"
                                        value={item.subtitle}
                                        onChange={(e) => updateImpactItem(item.id, { subtitle: e.target.value })}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={nextStep}
                        disabled={!hasContent}
                    >
                        Continue
                    </Button>
                </div>
            </div>
        </div>
    )
}
