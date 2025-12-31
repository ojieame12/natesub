import { useState, useEffect, useRef } from 'react'
import { ChevronLeft, AlertCircle, Loader2 } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button, Pressable } from './components'
import { getCurrencySymbol, getMinimumAmount } from '../utils/currency'
import { useSaveOnboardingProgress } from '../api/hooks'
import './onboarding.css'

const PLACEHOLDER_EXAMPLES = [
  'I help entrepreneurs build their personal brand through 1-on-1 coaching...',
  'Weekly fitness coaching with personalized meal plans and workout routines...',
  'Monthly design retainer for startups - logos, social media, and branding...',
  'Private music lessons and feedback on your compositions...',
]

export default function ServiceDescriptionStep() {
  const {
    serviceDescription,
    setServiceDescription,
    singleAmount,
    setPricing,
    currency,
    nextStep,
    prevStep,
    firstName,
    currentStep,
  } = useOnboardingStore()

  const { mutateAsync: saveProgress } = useSaveOnboardingProgress()
  const [localDescription, setLocalDescription] = useState(serviceDescription)
  const [localPrice, setLocalPrice] = useState(String(singleAmount || ''))
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Track if user has manually edited - don't override their input with hydrated values
  const userHasEditedPrice = useRef(false)
  const userHasEditedDescription = useRef(false)

  // Sync local state when store is hydrated from server (only if user hasn't edited)
  useEffect(() => {
    if (!userHasEditedPrice.current && singleAmount && singleAmount !== parseFloat(localPrice)) {
      setLocalPrice(String(singleAmount))
    }
  }, [singleAmount])

  useEffect(() => {
    if (!userHasEditedDescription.current && serviceDescription && serviceDescription !== localDescription) {
      setLocalDescription(serviceDescription)
    }
  }, [serviceDescription])

  // Rotate placeholder on mount
  const [placeholderIndex] = useState(() => Math.floor(Math.random() * PLACEHOLDER_EXAMPLES.length))
  const placeholder = PLACEHOLDER_EXAMPLES[placeholderIndex]

  const currencySymbol = getCurrencySymbol(currency)
  const minAmount = getMinimumAmount(currency)
  const priceNum = parseFloat(localPrice) || 0

  const handlePriceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    userHasEditedPrice.current = true
    const val = e.target.value.replace(/[^0-9.]/g, '')
    // Allow only one decimal point
    const parts = val.split('.')
    if (parts.length > 2) return
    setLocalPrice(val)
  }

  const handleContinue = async () => {
    if (!localDescription.trim()) return
    if (priceNum < minAmount) return

    // Block navigation until save succeeds
    setIsSaving(true)
    setSaveError(null)
    setServiceDescription(localDescription.trim())
    setPricing('single', [], priceNum)

    try {
      // Persist service description and price to backend for cross-device resume
      // Include purpose redundantly to ensure backend knows this is service flow
      // Save NEXT step key so resume lands on the step user is going to
      await saveProgress({
        step: currentStep + 1,
        stepKey: 'ai-gen', // After service-desc is always ai-gen
        data: {
          serviceDescription: localDescription.trim(),
          singleAmount: priceNum,
          purpose: 'service', // Redundant - ensures backend knows service flow
        },
      })
      // Only advance on success
      nextStep()
    } catch (err) {
      console.warn('[ServiceDescriptionStep] Failed to save progress:', err)
      setSaveError('Failed to save. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  const MAX_DESCRIPTION_LENGTH = 500 // Backend caps bio at 500
  const descLength = localDescription.trim().length
  const isDescriptionValid = descLength >= 20 && descLength <= MAX_DESCRIPTION_LENGTH
  const isPriceValid = priceNum >= minAmount
  const isValid = isDescriptionValid && isPriceValid

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
        {/* Save error - shown if save failed */}
        {saveError && (
          <div className="ai-save-warning" style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            background: '#FEE2E2',
            borderRadius: 10,
            marginBottom: 16,
            fontSize: 13,
            color: '#DC2626',
          }}>
            <AlertCircle size={18} />
            <span>{saveError}</span>
          </div>
        )}

        <div className="step-header">
          <h1>Describe your service</h1>
          <p>
            {firstName ? `${firstName}, tell` : 'Tell'} us what you offer so we can create your page.
          </p>
        </div>

        <div className="step-body">
          <div className="service-description-step-card">
            <textarea
              className="service-description-step-input"
              value={localDescription}
              onChange={(e) => {
                userHasEditedDescription.current = true
                setLocalDescription(e.target.value)
              }}
              placeholder={placeholder}
              rows={4}
              autoFocus
            />
            <div className="service-description-step-hint">
              {descLength < 20 ? (
                <span className="hint-warning">At least 20 characters needed</span>
              ) : descLength > MAX_DESCRIPTION_LENGTH ? (
                <span className="hint-warning">{descLength}/{MAX_DESCRIPTION_LENGTH} - Too long</span>
              ) : (
                <span className="hint-success">{descLength}/{MAX_DESCRIPTION_LENGTH}</span>
              )}
            </div>
          </div>

          {/* Price input - collected before AI to calibrate perks */}
          <div className="service-description-step-card">
            <label className="service-price-label">Monthly price</label>
            <div className="service-price-input-wrapper">
              <span className="service-price-currency">{currencySymbol}</span>
              <input
                type="text"
                inputMode="decimal"
                className="service-price-input"
                value={localPrice}
                onChange={handlePriceChange}
                placeholder={String(minAmount)}
              />
              <span className="service-price-period">/month</span>
            </div>
            {localPrice && !isPriceValid && (
              <div className="service-description-step-hint">
                <span className="hint-warning">
                  Minimum {currencySymbol}{minAmount.toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="step-footer">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={handleContinue}
            disabled={!isValid || isSaving}
          >
            {isSaving ? (
              <Loader2 size={20} className="spin" />
            ) : (
              'Continue'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
