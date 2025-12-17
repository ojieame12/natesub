// @ts-nocheck
import { useState } from 'react'
import { ChevronLeft, RefreshCw } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { EditableList } from '../components'
import './onboarding.css'

export default function AIReviewStep() {
    const {
        generatedBio,
        generatedPerks,
        generatedImpact,
        setGeneratedContent,
        setBio,
        setPerks,
        setImpactItems,
        nextStep,
        prevStep,
        goToStep,
        currentStep,
    } = useOnboardingStore()

    const [bio, setLocalBio] = useState(generatedBio)
    const [perks, setLocalPerks] = useState(
        generatedPerks.map((text, i) => ({ id: `perk-${i}`, text }))
    )
    const [impact, setLocalImpact] = useState(
        generatedImpact.map((text, i) => ({ id: `impact-${i}`, text }))
    )
    const [isRegenerating, setIsRegenerating] = useState(false)

    const handleRegenerate = async () => {
        setIsRegenerating(true)
        // Go back to generating step which will re-run generation
        goToStep(currentStep - 1)
    }

    const handleContinue = () => {
        // Save to store
        setGeneratedContent(bio, perks.map(p => p.text), impact.map(i => i.text))

        // Also set the actual onboarding fields
        setBio(bio)

        // Convert perks to PerkItem format
        const perkItems = perks.map((p, i) => ({
            id: `perk-${i}`,
            title: p.text,
            enabled: true,
        }))
        setPerks(perkItems)

        // Convert impact to ImpactItem format
        const impactItems = impact.map((item, i) => ({
            id: `impact-${i}`,
            title: item.text,
            subtitle: '',
        }))
        setImpactItems(impactItems)

        nextStep()
    }

    const hasContent = bio.trim().length > 0 || perks.length > 0 || impact.length > 0

    return (
        <div className="onboarding">
            <div className="onboarding-logo-header">
                <img src="/logo.svg" alt="NatePay" />
            </div>
            <div className="onboarding-header">
                <Pressable className="onboarding-back" onClick={prevStep}>
                    <ChevronLeft size={24} />
                </Pressable>
                <div className="onboarding-header-spacer" />
                <Pressable
                    className="ai-review-regenerate"
                    onClick={handleRegenerate}
                    disabled={isRegenerating}
                >
                    <RefreshCw size={18} className={isRegenerating ? 'spinning' : ''} />
                </Pressable>
            </div>

            <div className="onboarding-content">
                <div className="step-header">
                    <h1>Review your page</h1>
                    <p>Edit anything below to make it yours</p>
                </div>

                <div className="step-body ai-review-body">
                    {/* Bio Section */}
                    <div className="ai-review-section">
                        <label className="ai-review-label">Your bio</label>
                        <textarea
                            value={bio}
                            onChange={(e) => setLocalBio(e.target.value)}
                            placeholder="Tell people about yourself..."
                            className="ai-review-textarea"
                            rows={3}
                            maxLength={200}
                        />
                        <span className="ai-review-count">{bio.length}/200</span>
                    </div>

                    {/* Perks Section */}
                    <EditableList
                        label="What subscribers get"
                        items={perks}
                        onChange={setLocalPerks}
                        variant="check"
                        placeholder="Add a perk..."
                        maxItems={6}
                    />

                    {/* Impact Section */}
                    <EditableList
                        label="How this helps"
                        items={impact}
                        onChange={setLocalImpact}
                        variant="dot"
                        placeholder="Add an impact..."
                        maxItems={6}
                    />
                </div>

                <div className="step-footer">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={handleContinue}
                        disabled={!hasContent}
                    >
                        Looks good
                    </Button>
                </div>
            </div>
        </div>
    )
}
