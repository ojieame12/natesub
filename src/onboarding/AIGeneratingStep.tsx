import { useEffect, useState, useRef } from 'react'
import { AlertCircle } from 'lucide-react'
import { useOnboardingStore } from './store'
import { useGeneratePerks, useGenerateBanner } from '../api/hooks'
import { Button } from './components'
import { api } from '../api'
import './onboarding.css'

type GenerationPhase =
  | 'starting'
  | 'analyzing'
  | 'perks'
  | 'banner'
  | 'finishing'
  | 'done'
  | 'error'

const PHASE_MESSAGES: Record<GenerationPhase, string> = {
  starting: 'Getting ready...',
  analyzing: 'Analyzing your service...',
  perks: 'Crafting your perks...',
  banner: 'Creating your banner...',
  finishing: 'Almost ready...',
  done: 'All set!',
  error: 'Something went wrong',
}

export default function AIGeneratingStep() {
  const {
    serviceDescription,
    singleAmount,
    firstName,
    lastName,
    avatarUrl,
    bannerUrl,
    servicePerks,
    setServicePerks,
    setBannerUrl,
    nextStep,
    prevStep,
    currentStep,
  } = useOnboardingStore()

  const [phase, setPhase] = useState<GenerationPhase>('starting')
  const [error, setError] = useState<string | null>(null)
  const hasStarted = useRef(false)

  const generatePerksMutation = useGeneratePerks()
  const generateBannerMutation = useGenerateBanner()

  const displayName = `${firstName} ${lastName}`.trim()

  // Idempotent checks - separate for perks and banner
  const hasPerks = servicePerks.length >= 3
  const hasBanner = !!bannerUrl
  const fullyGenerated = hasPerks && (hasBanner || !avatarUrl) // Skip if both done (or banner N/A)

  // Run generation on mount (or skip if already generated)
  useEffect(() => {
    if (hasStarted.current) return
    hasStarted.current = true

    // Skip if everything is already generated
    if (fullyGenerated) {
      nextStep()
      return
    }

    runGeneration()
  }, [fullyGenerated])

  const runGeneration = async () => {
    try {
      // Phase 1: Analyzing (brief for UX feedback)
      setPhase('analyzing')

      let generatedPerks = servicePerks
      let generatedBanner = bannerUrl

      // Run perks and banner generation in PARALLEL for faster completion
      const needsPerks = !hasPerks
      const needsBanner = avatarUrl && !hasBanner

      if (needsPerks || needsBanner) {
        setPhase(needsPerks ? 'perks' : 'banner')

        const [perksResult, bannerResult] = await Promise.allSettled([
          // Generate perks (skip if already exist)
          needsPerks
            ? generatePerksMutation.mutateAsync({
                description: serviceDescription,
                pricePerMonth: singleAmount || 10,
                displayName: displayName || undefined,
              })
            : Promise.resolve(null),
          // Generate banner in parallel (if avatar exists)
          needsBanner
            ? generateBannerMutation.mutateAsync()
            : Promise.resolve(null),
        ])

        // Handle perks result
        if (perksResult.status === 'fulfilled' && perksResult.value) {
          setServicePerks(perksResult.value.perks)
          generatedPerks = perksResult.value.perks
        } else if (perksResult.status === 'rejected') {
          // Perks are required - throw to trigger error state
          throw perksResult.reason
        }

        // Handle banner result (optional - failure is ok)
        if (bannerResult.status === 'fulfilled' && bannerResult.value) {
          setBannerUrl(bannerResult.value.bannerUrl)
          generatedBanner = bannerResult.value.bannerUrl
        } else if (bannerResult.status === 'rejected') {
          console.warn('Banner generation failed:', bannerResult.reason)
        }
      }

      // Persist generated content to backend (fire and forget)
      api.auth.saveOnboardingProgress({
        step: currentStep,
        stepKey: 'ai-gen',
        data: {
          servicePerks: generatedPerks,
          bannerUrl: generatedBanner || null,
          purpose: 'service',
        },
      }).catch(() => {})

      // Quick finishing phase for UX transition
      setPhase('finishing')
      await delay(150)

      // Done - advance immediately
      setPhase('done')
      nextStep()

    } catch (err: any) {
      console.error('AI generation failed:', err)
      setError(err?.error || err?.message || 'Failed to generate your page content')
      setPhase('error')
    }
  }

  const handleRetry = () => {
    setError(null)
    hasStarted.current = false
    runGeneration()
  }

  const handleSkip = () => {
    // Skip AI generation - go to review with empty perks
    // User can manually add perks there
    nextStep()
  }

  // Error state
  if (phase === 'error') {
    return (
      <div className="onboarding">
        <div className="onboarding-logo-header">
          <img src="/logo.svg" alt="NatePay" />
        </div>

        <div className="ai-generating-container">
          <div className="ai-generating-error">
            <AlertCircle size={48} />
            <h2>Generation Failed</h2>
            <p>{error}</p>
            <div className="ai-generating-error-actions">
              <Button variant="primary" size="lg" onClick={handleRetry}>
                Try Again
              </Button>
              <Button variant="secondary" size="lg" onClick={handleSkip}>
                Skip & Add Manually
              </Button>
              <Button variant="ghost" size="md" onClick={prevStep}>
                Go Back
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Loading state with logo animation
  return (
    <div className="onboarding">
      <div className="ai-generating-container">
        <div className="ai-generating-logo">
          <img
            src="/logo.svg"
            alt="NatePay"
            className="ai-generating-logo-img"
          />
          <div className="ai-generating-pulse" />
        </div>

        <div className="ai-generating-status">
          <p className="ai-generating-message">{PHASE_MESSAGES[phase]}</p>
          <div className="ai-generating-dots">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        </div>

        <div className="ai-generating-progress">
          <div className="ai-generating-progress-track">
            <div
              className="ai-generating-progress-fill"
              style={{ width: `${getProgressPercent(phase)}%` }}
            />
          </div>
        </div>

        {/* Escape hatch - skip during loading */}
        <button className="ai-generating-skip" onClick={handleSkip}>
          Skip and add manually
        </button>
      </div>
    </div>
  )
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getProgressPercent(phase: GenerationPhase): number {
  switch (phase) {
    case 'starting': return 5
    case 'analyzing': return 20
    case 'perks': return 50
    case 'banner': return 75
    case 'finishing': return 90
    case 'done': return 100
    default: return 0
  }
}
