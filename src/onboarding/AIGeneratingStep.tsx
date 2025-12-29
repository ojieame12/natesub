import { useEffect, useState, useRef, useCallback } from 'react'
import { AlertCircle, Check, RefreshCw, Sparkles, Upload } from 'lucide-react'
import { useOnboardingStore } from './store'
import { useGeneratePerks, useGenerateBanner, uploadFile } from '../api/hooks'
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

const PHASE_MESSAGES: Record<GenerationPhase, string> = {
  starting: 'Getting ready...',
  analyzing: 'Analyzing your service...',
  perks: 'Crafting your perks...',
  banner: 'Creating your banner...',
  finishing: 'Almost ready...',
  preview: 'Review your page',
  error: 'Something went wrong',
}

// Max 2 AI-generated banners per user
const MAX_BANNER_OPTIONS = 2

export default function AIGeneratingStep() {
  const {
    serviceDescription,
    singleAmount,
    firstName,
    lastName,
    avatarUrl,
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
  const [customBannerFile, setCustomBannerFile] = useState<File | null>(null)
  const [customBannerPreview, setCustomBannerPreview] = useState<string | null>(null)
  const [isUploadingCustom, setIsUploadingCustom] = useState(false)
  const hasStarted = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const generatePerksMutation = useGeneratePerks()
  const generateBannerMutation = useGenerateBanner()

  const displayName = `${firstName} ${lastName}`.trim()

  // Idempotent checks
  const hasPerks = servicePerks.length >= 3
  const canRegenerate = bannerOptions.length < MAX_BANNER_OPTIONS && avatarUrl

  // Initialize selected banner from existing options
  useEffect(() => {
    if (bannerOptions.length > 0 && selectedBannerIndex === null) {
      // Auto-select first banner if available
      setSelectedBannerIndex(0)
    }
  }, [bannerOptions, selectedBannerIndex])

  // Run generation on mount
  // If we have perks but no banner, still try to generate banner
  useEffect(() => {
    if (hasStarted.current) return
    hasStarted.current = true

    // Check if we need to generate anything
    const needsBanner = avatarUrl && bannerOptions.length === 0

    // If we have perks but need banner, run generation for banner only
    if (hasPerks && needsBanner) {
      runGeneration()
      return
    }

    // If we have perks and banner (or no avatar), go straight to preview
    if (hasPerks) {
      setPhase('preview')
      return
    }

    // Otherwise, run full generation
    runGeneration()
  }, [hasPerks, avatarUrl, bannerOptions.length])

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
        if (bannerResult.status === 'fulfilled' && bannerResult.value?.wasGenerated) {
          const variant = bannerResult.value.variant || 'standard'
          addBannerOption({ url: bannerResult.value.bannerUrl, variant })
          generatedBanner = bannerResult.value.bannerUrl
          setSelectedBannerIndex(0)
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
      }).catch(() => {})

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
    if (!avatarUrl || isRegeneratingBanner || bannerOptions.length >= MAX_BANNER_OPTIONS) return

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
        }).catch(() => {})
      }
    } catch (err) {
      console.error('Banner regeneration failed:', err)
    } finally {
      setIsRegeneratingBanner(false)
    }
  }

  // Handle custom banner file selection
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file')
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be less than 5MB')
      return
    }

    setCustomBannerFile(file)
    setSelectedBannerIndex('custom')
    setError(null)

    // Create preview
    const reader = new FileReader()
    reader.onloadend = () => {
      setCustomBannerPreview(reader.result as string)
    }
    reader.readAsDataURL(file)
  }, [])

  // Upload custom banner when continuing
  const uploadCustomBanner = async (): Promise<string | null> => {
    if (!customBannerFile) return null

    setIsUploadingCustom(true)
    try {
      const url = await uploadFile(customBannerFile, 'banner')
      return url
    } catch (err) {
      console.error('Custom banner upload failed:', err)
      setError('Failed to upload custom banner')
      return null
    } finally {
      setIsUploadingCustom(false)
    }
  }

  const handleRetry = () => {
    setError(null)
    hasStarted.current = false
    setPhase('starting')
    setServicePerks([])
    clearBannerOptions()
    setSelectedBannerIndex(null)
    setCustomBannerFile(null)
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

    if (selectedBannerIndex === 'custom' && customBannerFile) {
      // Upload custom banner
      finalBannerUrl = await uploadCustomBanner()
      if (!finalBannerUrl) return // Error handled in uploadCustomBanner
    } else if (typeof selectedBannerIndex === 'number' && bannerOptions[selectedBannerIndex]) {
      finalBannerUrl = bannerOptions[selectedBannerIndex].url
    }

    // Set the selected banner as the final one
    setBannerUrl(finalBannerUrl)

    // Persist final selection
    api.auth.saveOnboardingProgress({
      step: currentStep,
      stepKey: 'ai-gen',
      data: {
        servicePerks,
        bannerUrl: finalBannerUrl,
        bannerOptions,
        purpose: purpose || 'service',
        serviceDescription,
      },
    }).catch(() => {})

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

  // Preview state - show generated content for review
  if (phase === 'preview') {
    const showBannerSelection = bannerOptions.length >= MAX_BANNER_OPTIONS || !canRegenerate

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

          <div className="step-body ai-preview">
            {/* Banner Section */}
            <div className="ai-preview-section">
              <div className="ai-preview-header">
                <h3>Banner</h3>
                {canRegenerate && !showBannerSelection && (
                  <Pressable
                    className="ai-preview-regenerate"
                    onClick={handleRegenerateBanner}
                    disabled={isRegeneratingBanner}
                  >
                    <RefreshCw size={14} className={isRegeneratingBanner ? 'spin' : ''} />
                    <span>{isRegeneratingBanner ? 'Generating...' : 'Try Another Style'}</span>
                  </Pressable>
                )}
              </div>

              {/* Banner Options Selection (after 2 generations OR no avatar) */}
              {showBannerSelection ? (
                <div className="ai-banner-selection">
                  {bannerOptions.map((option, index) => (
                    <Pressable
                      key={option.url}
                      className={`ai-banner-option ${selectedBannerIndex === index ? 'selected' : ''}`}
                      onClick={() => setSelectedBannerIndex(index)}
                    >
                      <img src={option.url} alt={`Banner option ${index + 1}`} />
                      <div className="ai-banner-option-label">
                        {option.variant === 'artistic' ? 'Artistic' : 'Professional'}
                      </div>
                      {selectedBannerIndex === index && (
                        <div className="ai-banner-option-check">
                          <Check size={16} />
                        </div>
                      )}
                    </Pressable>
                  ))}

                  {/* Custom Upload Option */}
                  <Pressable
                    className={`ai-banner-option ai-banner-upload ${selectedBannerIndex === 'custom' ? 'selected' : ''}`}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {customBannerPreview ? (
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
                    {selectedBannerIndex === 'custom' && customBannerPreview && (
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
                /* Single Banner Preview */
                <div className="ai-preview-banner">
                  {bannerOptions[0] ? (
                    <img src={bannerOptions[0].url} alt="Generated banner" />
                  ) : avatarUrl ? (
                    <div className="ai-preview-banner-fallback">
                      <img src={avatarUrl} alt="Avatar" className="ai-preview-avatar-fallback" />
                      <span>Banner will use your avatar</span>
                    </div>
                  ) : (
                    <div className="ai-preview-banner-empty">
                      <Sparkles size={24} />
                      <span>No banner - add an avatar first</span>
                    </div>
                  )}
                </div>
              )}

              {/* Generation limit notice */}
              {bannerOptions.length >= MAX_BANNER_OPTIONS && (
                <p className="ai-preview-hint">
                  Select a banner above or upload your own
                </p>
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
              disabled={isUploadingCustom || (selectedBannerIndex === 'custom' && !customBannerFile)}
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

  // Loading state
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
