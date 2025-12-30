import { useEffect, useState, useRef, useCallback } from 'react'
import { AlertCircle, Check, RefreshCw, Sparkles, Upload, Circle, CheckCircle2, Loader2 } from 'lucide-react'
import { useOnboardingStore } from './store'
import { useGeneratePerks, useGenerateBanner, uploadFile, useAIConfig } from '../api/hooks'
import { Button, Pressable } from './components'
import { api } from '../api'
import './onboarding.css'

type GenerationPhase =
  | 'starting'
  | 'analyzing'
  | 'perks'
  | 'banner'
  | 'finishing'
  | 'preview'  // Shows generated content for review
  | 'error'
  | 'ai_unavailable'  // AI is disabled/unavailable

const PHASE_MESSAGES: Record<GenerationPhase, string> = {
  starting: 'Getting ready...',
  analyzing: 'Analyzing your service...',
  perks: 'Crafting your perks...',
  banner: 'Creating your banner...',
  finishing: 'Almost ready...',
  preview: 'Review your page',
  error: 'Something went wrong',
  ai_unavailable: 'AI is currently unavailable',
}

// Max 5 AI-generated banners per user (global limit, survives onboarding)
const MAX_BANNER_OPTIONS = 5

export default function AIGeneratingStep() {
  const {
    serviceDescription,
    singleAmount,
    firstName,
    lastName,
    avatarUrl,
    bannerUrl,
    bannerOptions,
    servicePerks,
    purpose,
    setServicePerks,
    setBannerUrl,
    addBannerOption,
    clearBannerOptions,
    nextStep,
    prevStep,
    currentStep,
  } = useOnboardingStore()

  const [phase, setPhase] = useState<GenerationPhase>('starting')
  const [error, setError] = useState<string | null>(null)
  const [isRegeneratingBanner, setIsRegeneratingBanner] = useState(false)
  const [selectedBannerIndex, setSelectedBannerIndex] = useState<number | 'custom' | null>(null)
  const [customBannerPreview, setCustomBannerPreview] = useState<string | null>(null)
  const [isUploadingCustom, setIsUploadingCustom] = useState(false)
  const [generationsRemaining, setGenerationsRemaining] = useState<number | null>(null)
  const [saveWarning, setSaveWarning] = useState(false) // Show if backend save fails
  const hasStarted = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const generatePerksMutation = useGeneratePerks()
  const generateBannerMutation = useGenerateBanner()
  const { data: aiConfig, isLoading: isLoadingAIConfig } = useAIConfig()
  const isAIAvailable = aiConfig?.available ?? true // Default to true while loading

  const displayName = `${firstName} ${lastName}`.trim()

  // Idempotent checks
  const hasPerks = servicePerks.length >= 3
  // Use server-side remaining count if available, otherwise fall back to local count
  const canRegenerate = avatarUrl && (
    generationsRemaining === null
      ? bannerOptions.length < MAX_BANNER_OPTIONS
      : generationsRemaining > 0
  )

  // Initialize/restore selected banner from existing options or bannerUrl
  useEffect(() => {
    if (selectedBannerIndex !== null) return // Already selected

    // Try to restore previous selection from bannerUrl
    if (bannerUrl) {
      // Check if bannerUrl matches an AI-generated option
      const matchIndex = bannerOptions.findIndex(opt => opt.url === bannerUrl)
      if (matchIndex >= 0) {
        setSelectedBannerIndex(matchIndex)
        return
      }
      // If bannerUrl doesn't match options, it's a custom banner
      setCustomBannerPreview(bannerUrl)
      setSelectedBannerIndex('custom')
      return
    }

    // Default: select first banner if options exist
    if (bannerOptions.length > 0) {
      setSelectedBannerIndex(0)
    }
  }, [bannerOptions, selectedBannerIndex, bannerUrl])

  // Run generation on mount
  // If we have perks but no banner, still try to generate banner
  useEffect(() => {
    if (hasStarted.current) return

    // Wait for AI config to load
    if (isLoadingAIConfig) return

    hasStarted.current = true

    // Check if we need to generate anything
    const needsBanner = avatarUrl && bannerOptions.length === 0
    const needsPerks = !hasPerks

    // If AI is unavailable and we need perks, show unavailable state
    if (!isAIAvailable && needsPerks) {
      setPhase('ai_unavailable')
      return
    }

    // If we have perks but need banner:
    // - If AI available, run banner-only generation
    // - If AI unavailable, skip banner and go to preview (user can upload manually)
    if (hasPerks && needsBanner) {
      if (isAIAvailable) {
        runGeneration()
      } else {
        // AI unavailable - skip banner, go straight to preview with manual upload option
        setPhase('preview')
      }
      return
    }

    // If we have perks and banner (or no avatar), go straight to preview
    if (hasPerks) {
      setPhase('preview')
      return
    }

    // Otherwise, run full generation
    runGeneration()
  }, [hasPerks, avatarUrl, bannerOptions.length, isLoadingAIConfig, isAIAvailable])

  const runGeneration = async () => {
    try {
      setError(null)
      setPhase('analyzing')

      let generatedPerks = servicePerks
      let generatedBanner: string | null = null

      // Run perks and banner generation in PARALLEL
      const needsPerks = !hasPerks
      const needsBanner = avatarUrl && bannerOptions.length === 0

      if (needsPerks || needsBanner) {
        setPhase(needsPerks ? 'perks' : 'banner')

        const [perksResult, bannerResult] = await Promise.allSettled([
          needsPerks
            ? generatePerksMutation.mutateAsync({
                description: serviceDescription,
                pricePerMonth: singleAmount || 10,
                displayName: displayName || undefined,
              })
            : Promise.resolve(null),
          needsBanner
            ? generateBannerMutation.mutateAsync({
                serviceDescription,
                variant: 'standard', // First generation is standard
              })
            : Promise.resolve(null),
        ])

        // Handle perks result
        if (perksResult.status === 'fulfilled' && perksResult.value) {
          setServicePerks(perksResult.value.perks)
          generatedPerks = perksResult.value.perks
        } else if (perksResult.status === 'rejected') {
          throw perksResult.reason
        }

        // Handle banner result (optional - failure is ok)
        if (bannerResult.status === 'fulfilled' && bannerResult.value?.bannerUrl) {
          const variant = bannerResult.value.variant || 'standard'
          // Add banner option even if it's a fallback to avatar (wasGenerated: false)
          // This ensures users always have a banner option to select
          addBannerOption({
            url: bannerResult.value.bannerUrl,
            variant: bannerResult.value.wasGenerated ? variant : 'fallback',
          })
          generatedBanner = bannerResult.value.bannerUrl
          setSelectedBannerIndex(0)
          // Track remaining generations from server (only for AI-generated banners)
          if (bannerResult.value.wasGenerated && typeof bannerResult.value.generationsRemaining === 'number') {
            setGenerationsRemaining(bannerResult.value.generationsRemaining)
          }
        } else if (bannerResult.status === 'rejected') {
          console.warn('Banner generation failed:', bannerResult.reason)
        }
      }

      // Persist to backend (with new BannerOption format)
      const bannerOptionsToSave = generatedBanner
        ? [{ url: generatedBanner, variant: 'standard' as const }]
        : []
      api.auth.saveOnboardingProgress({
        step: currentStep,
        stepKey: 'ai-gen',
        data: {
          servicePerks: generatedPerks,
          bannerUrl: generatedBanner,
          bannerOptions: bannerOptionsToSave,
          purpose: purpose || 'service',
          serviceDescription,
        },
      }).catch((err) => {
        console.warn('[onboarding] Failed to save AI-generated content:', err)
        setSaveWarning(true)
      })

      setPhase('finishing')
      await delay(150)
      setPhase('preview')

    } catch (err: any) {
      console.error('AI generation failed:', err)
      setError(err?.error || err?.message || 'Failed to generate your page content')
      setPhase('error')
    }
  }

  // Regenerate banner with artistic variant
  const handleRegenerateBanner = async () => {
    if (!canRegenerate || isRegeneratingBanner) return

    setIsRegeneratingBanner(true)
    try {
      const result = await generateBannerMutation.mutateAsync({
        serviceDescription,
        variant: 'artistic', // Second generation uses artistic variant
      })

      if (result?.wasGenerated && result.bannerUrl) {
        const newOption = { url: result.bannerUrl, variant: result.variant || 'artistic' as const }
        addBannerOption(newOption)
        setSelectedBannerIndex(bannerOptions.length) // Select the new one

        // Track remaining generations from server
        if (typeof result.generationsRemaining === 'number') {
          setGenerationsRemaining(result.generationsRemaining)
        }

        // Persist to backend
        api.auth.saveOnboardingProgress({
          step: currentStep,
          stepKey: 'ai-gen',
          data: {
            servicePerks,
            bannerOptions: [...bannerOptions, newOption],
            purpose: purpose || 'service',
            serviceDescription,
          },
        }).catch((err) => {
          console.warn('[onboarding] Failed to save regenerated banner:', err)
          setSaveWarning(true)
        })
      }
    } catch (err: any) {
      console.error('Banner regeneration failed:', err)
      // Check if limit was reached - error data is nested under err.data
      if (err?.data?.limitReached) {
        setGenerationsRemaining(0) // Update local state
        setError('You\'ve used all AI generations. Upload your own banner below!')
        // Scroll to upload option by clicking file input
        setTimeout(() => fileInputRef.current?.click(), 500)
      }
    } finally {
      setIsRegeneratingBanner(false)
    }
  }

  // Handle custom banner file selection - upload immediately for persistence
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file')
      return
    }

    // Validate file size (max 10MB - matches backend)
    if (file.size > 10 * 1024 * 1024) {
      setError('Image must be less than 10MB')
      return
    }

    setError(null)
    setSelectedBannerIndex('custom')

    // Show preview immediately
    const localPreview = URL.createObjectURL(file)
    setCustomBannerPreview(localPreview)

    // Upload immediately so it persists across navigation
    setIsUploadingCustom(true)
    try {
      const url = await uploadFile(file, 'banner')
      setBannerUrl(url) // Persist to store
      setCustomBannerPreview(url) // Update preview to uploaded URL

      // Persist to backend
      api.auth.saveOnboardingProgress({
        step: currentStep,
        stepKey: 'ai-gen',
        data: {
          servicePerks,
          bannerUrl: url,
          bannerOptions,
          purpose: purpose || 'service',
          serviceDescription,
        },
      }).catch((err) => {
        console.warn('[onboarding] Failed to save custom banner:', err)
        setSaveWarning(true)
      })
    } catch (err) {
      console.error('Custom banner upload failed:', err)
      setError('Failed to upload banner. Please try again.')
      setCustomBannerPreview(null)
      setSelectedBannerIndex(bannerOptions.length > 0 ? 0 : null)
    } finally {
      setIsUploadingCustom(false)
      URL.revokeObjectURL(localPreview)
    }
  }, [currentStep, servicePerks, bannerOptions, purpose, serviceDescription, setBannerUrl])

  const handleRetry = () => {
    setError(null)
    hasStarted.current = false
    setPhase('starting')
    setServicePerks([])
    clearBannerOptions()
    setSelectedBannerIndex(null)
    setCustomBannerPreview(null)
    setTimeout(() => {
      runGeneration()
    }, 50)
  }

  const handleSkip = () => {
    nextStep()
  }

  const handleContinue = async () => {
    let finalBannerUrl: string | null = null

    if (selectedBannerIndex === 'custom') {
      // Custom banner was already uploaded on selection, use stored URL
      finalBannerUrl = bannerUrl
    } else if (typeof selectedBannerIndex === 'number' && bannerOptions[selectedBannerIndex]) {
      finalBannerUrl = bannerOptions[selectedBannerIndex].url
      // Update store with selected AI banner
      setBannerUrl(finalBannerUrl)
    }

    // Persist final selection
    // Save NEXT step key so resume lands on the step user is going to
    api.auth.saveOnboardingProgress({
      step: currentStep + 1,
      stepKey: 'review', // After ai-gen is always review
      data: {
        servicePerks,
        bannerUrl: finalBannerUrl,
        bannerOptions,
        purpose: purpose || 'service',
        serviceDescription,
      },
    }).catch((err) => {
      console.warn('[onboarding] Failed to save final selection:', err)
      setSaveWarning(true)
    })

    nextStep()
  }

  // AI Unavailable state - guide user to manual entry
  if (phase === 'ai_unavailable') {
    return (
      <div className="onboarding">
        <div className="onboarding-logo-header">
          <img src="/logo.svg" alt="NatePay" />
        </div>

        <div className="ai-generating-container">
          <div className="ai-generating-error">
            <Sparkles size={48} style={{ opacity: 0.5 }} />
            <h2>AI Generation Unavailable</h2>
            <p>AI-powered content generation is temporarily unavailable. You can add your perks and banner manually.</p>
            <div className="ai-generating-error-actions">
              <Button variant="primary" size="lg" onClick={handleSkip}>
                Continue to Review
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

  // Preview state - show generated content for review
  if (phase === 'preview') {
    const hasBannerOptions = bannerOptions.length > 0 || customBannerPreview

    return (
      <div className="onboarding">
        <div className="onboarding-logo-header">
          <img src="/logo.svg" alt="NatePay" />
        </div>

        <div className="onboarding-content">
          <div className="step-header">
            <h1>Your page is ready</h1>
            <p>Review what we've created for you</p>
          </div>

          {/* Warning if backend save failed */}
          {saveWarning && (
            <div className="ai-save-warning" style={{
              background: '#FFF3CD',
              border: '1px solid #FFECB5',
              borderRadius: 8,
              padding: '12px 16px',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              fontSize: 14,
              color: '#664D03',
            }}>
              <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>Your progress may not sync across devices. Complete setup on this device.</span>
            </div>
          )}

          <div className="step-body ai-preview">
            {/* Banner Section */}
            <div className="ai-preview-section">
              <div className="ai-preview-header">
                <h3>Banner</h3>
                {generationsRemaining !== null && generationsRemaining > 0 && (
                  <span className="ai-generations-remaining">
                    {generationsRemaining} generation{generationsRemaining !== 1 ? 's' : ''} left
                  </span>
                )}
              </div>

              {/* Banner Selection Grid - always show when we have options */}
              {hasBannerOptions ? (
                <div className="ai-banner-selection">
                  {/* AI Generated Options */}
                  {bannerOptions.map((option, index) => (
                    <Pressable
                      key={option.url}
                      className={`ai-banner-option ${selectedBannerIndex === index ? 'selected' : ''}`}
                      onClick={() => setSelectedBannerIndex(index)}
                    >
                      <img src={option.url} alt={`Banner option ${index + 1}`} />
                      <div className="ai-banner-option-label">
                        {option.variant === 'fallback' ? 'Your Photo' : option.variant === 'artistic' ? 'Creative' : 'Professional'}
                      </div>
                      {selectedBannerIndex === index && (
                        <div className="ai-banner-option-check">
                          <Check size={16} />
                        </div>
                      )}
                    </Pressable>
                  ))}

                  {/* Generate Another Style Option (if under limit) */}
                  {canRegenerate && (
                    <Pressable
                      className={`ai-banner-option ai-banner-generate ${isRegeneratingBanner ? 'generating' : ''}`}
                      onClick={handleRegenerateBanner}
                      disabled={isRegeneratingBanner}
                    >
                      {isRegeneratingBanner ? (
                        <div className="ai-banner-generating">
                          <Loader2 size={24} className="spin" />
                          <span>Creating banner...</span>
                          <span className="ai-banner-generating-hint">This may take up to 30 seconds</span>
                        </div>
                      ) : (
                        <div className="ai-banner-upload-placeholder">
                          <Sparkles size={24} />
                          <span>Try Another Style</span>
                        </div>
                      )}
                    </Pressable>
                  )}

                  {/* Custom Upload Option - always available */}
                  <Pressable
                    className={`ai-banner-option ai-banner-upload ${selectedBannerIndex === 'custom' ? 'selected' : ''} ${isUploadingCustom ? 'uploading' : ''}`}
                    onClick={() => !isUploadingCustom && fileInputRef.current?.click()}
                    disabled={isUploadingCustom}
                  >
                    {isUploadingCustom ? (
                      <div className="ai-banner-generating">
                        <RefreshCw size={24} className="spin" />
                        <span>Uploading...</span>
                      </div>
                    ) : customBannerPreview ? (
                      <>
                        <img src={customBannerPreview} alt="Custom banner" />
                        <div className="ai-banner-option-label">Custom</div>
                      </>
                    ) : (
                      <div className="ai-banner-upload-placeholder">
                        <Upload size={24} />
                        <span>Upload Your Own</span>
                      </div>
                    )}
                    {selectedBannerIndex === 'custom' && customBannerPreview && !isUploadingCustom && (
                      <div className="ai-banner-option-check">
                        <Check size={16} />
                      </div>
                    )}
                  </Pressable>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                  />
                </div>
              ) : (
                /* No banner yet - show empty state with upload */
                <div className="ai-banner-selection">
                  <Pressable
                    className={`ai-banner-option ai-banner-upload ${isUploadingCustom ? 'uploading' : ''}`}
                    onClick={() => !isUploadingCustom && fileInputRef.current?.click()}
                    disabled={isUploadingCustom}
                  >
                    {isUploadingCustom ? (
                      <div className="ai-banner-generating">
                        <RefreshCw size={24} className="spin" />
                        <span>Uploading...</span>
                      </div>
                    ) : (
                      <div className="ai-banner-upload-placeholder">
                        <Upload size={24} />
                        <span>Upload a Banner</span>
                      </div>
                    )}
                  </Pressable>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                  />
                </div>
              )}

              {error && (
                <div className="ai-preview-error">
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Perks Preview */}
            <div className="ai-preview-section">
              <div className="ai-preview-header">
                <h3>Your Perks</h3>
              </div>
              <div className="ai-preview-perks">
                {servicePerks.map((perk, index) => (
                  <div key={perk.id || index} className="ai-preview-perk">
                    <Check size={16} />
                    <span>{perk.title}</span>
                  </div>
                ))}
              </div>
              <p className="ai-preview-hint">You can edit these on the next screen</p>
            </div>

            {error && (
              <div className="ai-preview-error">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}
          </div>

          <div className="step-footer">
            <Button
              variant="primary"
              size="lg"
              fullWidth
              onClick={handleContinue}
              disabled={isUploadingCustom || (selectedBannerIndex === 'custom' && !bannerUrl)}
            >
              {isUploadingCustom ? 'Uploading...' : 'Continue'}
            </Button>
            {bannerOptions.length < MAX_BANNER_OPTIONS && (
              <Button variant="ghost" size="md" onClick={handleRetry} style={{ marginTop: 12 }}>
                Regenerate Everything
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Step completion states for checklist
  const steps = [
    { id: 'analyze', label: 'Analyzing your service', done: phase !== 'starting' && phase !== 'analyzing' },
    { id: 'perks', label: 'Crafting your perks', done: ['banner', 'finishing', 'preview'].includes(phase), active: phase === 'perks' },
    { id: 'banner', label: 'Creating your banner', done: ['finishing', 'preview'].includes(phase), active: phase === 'banner' },
  ]

  // Loading state with step checklist
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
        </div>

        {/* Step checklist */}
        <div className="ai-generating-steps">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={`ai-step ${step.done ? 'done' : ''} ${step.active ? 'active' : ''}`}
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="ai-step-icon">
                {step.done ? (
                  <CheckCircle2 size={20} className="ai-step-check" />
                ) : step.active ? (
                  <Loader2 size={20} className="ai-step-spinner" />
                ) : (
                  <Circle size={20} className="ai-step-pending" />
                )}
              </div>
              <span className="ai-step-label">{step.label}</span>
            </div>
          ))}
        </div>

        <div className="ai-generating-progress">
          <div className="ai-generating-progress-track">
            <div
              className="ai-generating-progress-fill"
              style={{ width: `${getProgressPercent(phase)}%` }}
            />
          </div>
        </div>

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
    case 'preview': return 100
    default: return 0
  }
}
