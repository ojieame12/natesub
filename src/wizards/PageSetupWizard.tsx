import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Check,
  Loader2,
  X,
  CreditCard,
  ChevronRight
} from 'lucide-react'
import {
  Pressable,
  useToast
} from '../components'
import { useProfile, useUpdateProfile } from '../api'
import { useHaptics } from '../hooks'
import { useOnboardingStore } from '../onboarding/store'
import '../onboarding/onboarding.css'

export default function PageSetupWizard() {
  const navigate = useNavigate()
  const toast = useToast()
  const { impact } = useHaptics()
  const { data: profileData, refetch: refetchProfile } = useProfile()
  const { mutateAsync: updateProfile } = useUpdateProfile()

  // Use Store for persistence (survives Stripe redirect)
  const {
    setPricing,
  } = useOnboardingStore()

  // Local UI state
  const [isPublishing, setIsPublishing] = useState(false)
  const [showPayoutWall, setShowPayoutWall] = useState(false)

  // Sync price string for input
  const [priceInput, setPriceInput] = useState('10')

  useEffect(() => {
    // Debounce price update to store
    const timer = setTimeout(() => {
      // Allow decimals (e.g. 10.50)
      const val = parseFloat(priceInput)
      if (!isNaN(val) && val >= 0) setPricing('single', [], val)
    }, 500)
    return () => clearTimeout(timer)
  }, [priceInput, setPricing])

  // Publish Logic
  const handlePublishClick = () => {
    performPublish()
  }

  const performPublish = useCallback(async () => {
    setIsPublishing(true)
    try {
      await updateProfile({
        // Send display amount (dollars) - backend converts to cents
        singleAmount: parseFloat(priceInput) || 0,
        pricingModel: 'single',
        // Preserve existing purpose instead of forcing 'service'
        ...(profileData?.profile?.purpose ? {} : { purpose: 'service' }),
        isPublic: true // GO LIVE
      })

      impact('heavy')
      toast.success('Your page is live!')
      navigate('/dashboard')
    } catch (err) {
      console.error(err)
      toast.error('Failed to publish page.')
    } finally {
      setIsPublishing(false)
    }
  }, [impact, navigate, priceInput, profileData?.profile?.purpose, toast, updateProfile])

  const handleConnectPayouts = () => {
    // Store logic is already saving state.
    // Navigate to settings -> will redirect back or user returns manually.
    // Pass returnTo state so PaymentSettings knows where to send us back
    navigate('/settings/payments', { state: { returnTo: '/setup-page' } })
  }

  // Poll for payout status if wall is open (in case they returned from Stripe)
  useEffect(() => {
    if (showPayoutWall) {
      const check = async () => {
        const res = await refetchProfile()
        if (res.data?.profile?.payoutStatus === 'active') {
          setShowPayoutWall(false)
          performPublish() // Auto-publish on return/success
        }
      }
      check()
      // Also check on focus
      window.addEventListener('focus', check)
      return () => window.removeEventListener('focus', check)
    }
  }, [performPublish, refetchProfile, showPayoutWall])

  return (
    <div className="onboarding-wrapper" style={{ background: 'var(--bg-root)' }}>
      {/* Header */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        padding: '24px',
        display: 'flex',
        justifyContent: 'space-between',
        zIndex: 10
      }}>
        <Pressable onClick={() => navigate('/dashboard')}>
          <X size={24} />
        </Pressable>
        <div className="onboarding-step-indicator">
          Page Setup
        </div>
        <div style={{ width: 24 }} />
      </div>

      <div className="onboarding-content-centered">
        <h1 className="onboarding-title">Set your price</h1>
        <p className="onboarding-subtitle">
          How much should subscribers pay per month?
        </p>

        <div className="onboarding-input-group" style={{ marginTop: 32 }}>
          <label className="onboarding-label">Monthly Price ($)</label>
          <input
            type="text"
            inputMode="decimal"
            className="onboarding-input"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            placeholder="10"
            autoFocus
          />
        </div>

        <Pressable
          className="btn-primary"
          style={{ marginTop: 32, width: '100%' }}
          onClick={handlePublishClick}
          disabled={isPublishing}
        >
          {isPublishing ? <Loader2 size={20} className="spin" /> : <Check size={20} />}
          <span>Publish Page</span>
        </Pressable>
      </div>

      {/* PAYOUT WALL MODAL */}
      {showPayoutWall && (
        <div className="onboarding-content-centered" style={{
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'var(--bg-root)',
          zIndex: 20,
          maxWidth: '100%',
          padding: 24
        }}>
          <div style={{ maxWidth: 400, margin: '0 auto', textAlign: 'center' }}>
            <div className="onboarding-icon-circle" style={{ background: 'var(--surface)' }}>
              <CreditCard size={32} />
            </div>
            <h2 className="onboarding-title" style={{ marginTop: 24 }}>One last step</h2>
            <p className="onboarding-subtitle">
              To publish your page and receive payments, you need to connect a bank account.
            </p>

            <Pressable
              className="btn-primary"
              style={{ marginTop: 32, width: '100%' }}
              onClick={handleConnectPayouts}
            >
              <span>Connect Payouts</span>
              <ChevronRight size={20} />
            </Pressable>

            <Pressable
              className="btn-text"
              style={{ marginTop: 16 }}
              onClick={() => setShowPayoutWall(false)}
            >
              Cancel
            </Pressable>
          </div>
        </div>
      )}
    </div>
  )
}
