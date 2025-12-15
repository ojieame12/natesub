import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  ArrowLeft, 
  Sparkles, 
  Check, 
  Loader2, 
  X,
  RefreshCw,
  CreditCard,
  ChevronRight
} from 'lucide-react'
import { 
  Pressable, 
  useToast 
} from '../components'
import { api, useProfile, useUpdateProfile } from '../api'
import { useHaptics } from '../hooks'
import { useOnboardingStore } from '../onboarding/store'
import { displayAmountToCents } from '../utils/currency'
import '../onboarding/onboarding.css'

// Types
type WizardStep = 'input' | 'generating' | 'review'

export default function PageSetupWizard() {
  const navigate = useNavigate()
  const toast = useToast()
  const { impact } = useHaptics()
  const { data: profileData, refetch: refetchProfile } = useProfile()
  const { mutateAsync: updateProfile } = useUpdateProfile()

  // Use Store for persistence (survives Stripe redirect)
  const {
    serviceDescription,
    setServiceDescription,
    singleAmount,
    setSingleAmount,
    generatedBio,
    generatedPerks,
    setGeneratedContent
  } = useOnboardingStore()

  // Local UI state
  const [step, setStep] = useState<WizardStep>(generatedBio ? 'review' : 'input')
  const [isPublishing, setIsPublishing] = useState(false)
  const [showPayoutWall, setShowPayoutWall] = useState(false)

  // Sync price string for input
  const [priceInput, setPriceInput] = useState(singleAmount ? singleAmount.toString() : '10')

  useEffect(() => {
    // Debounce price update to store
    const timer = setTimeout(() => {
      const val = parseInt(priceInput)
      if (!isNaN(val)) setSingleAmount(val)
    }, 500)
    return () => clearTimeout(timer)
  }, [priceInput, setSingleAmount])

  // AI Generation
  const handleGenerate = async () => {
    if (serviceDescription.length < 10) {
      toast.error('Please describe what you do in a bit more detail.')
      return
    }

    setStep('generating')
    
    try {
      const result = await api.ai.quick({
        description: serviceDescription,
        price: parseInt(priceInput),
        userName: profileData?.profile?.displayName || 'User',
        serviceType: 'professional'
      })

      if (result.success) {
        setGeneratedContent(result.bio, result.perks, [])
        impact('heavy')
        setStep('review')
      } else {
        throw new Error('AI generation failed')
      }
    } catch (err) {
      console.error(err)
      toast.error('Failed to generate content. Please try again.')
      setStep('input')
    }
  }

  // Publish Logic
  const handlePublishClick = () => {
    // Check payouts first
    const payoutStatus = profileData?.profile?.payoutStatus
    if (payoutStatus !== 'active') {
      setShowPayoutWall(true)
      return
    }
    
    performPublish()
  }

  const performPublish = async () => {
    setIsPublishing(true)
    try {
      await updateProfile({
        bio: generatedBio,
        perks: generatedPerks.map(p => ({ title: p, enabled: true, id: crypto.randomUUID() })),
        singleAmount: displayAmountToCents(parseInt(priceInput) || 0, profileData?.profile?.currency || 'USD'),
        pricingModel: 'single',
        purpose: 'service',
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
  }

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
  }, [showPayoutWall, refetchProfile])

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
        <Pressable onClick={() => step === 'input' ? navigate('/dashboard') : setStep('input')}>
          {step === 'input' ? <X size={24} /> : <ArrowLeft size={24} />}
        </Pressable>
        <div className="onboarding-step-indicator">
          Page Setup
        </div>
        <div style={{ width: 24 }} />
      </div>

      <>
        
        {/* STEP 1: INPUT */}
        {step === 'input' && (
          <div key="input" className="onboarding-content-centered">
            <h1 className="onboarding-title">What do you do?</h1>
            <p className="onboarding-subtitle">
              Describe your service or value in a sentence. We'll generate your page content for you.
            </p>

            <div className="onboarding-input-group">
              <textarea
                className="onboarding-textarea"
                placeholder="e.g. I design logos for startups, or I offer monthly coaching calls..."
                value={serviceDescription}
                onChange={(e) => setServiceDescription(e.target.value)}
                autoFocus
                rows={4}
              />
            </div>

            <div className="onboarding-input-group" style={{ marginTop: 24 }}>
              <label className="onboarding-label">Monthly Price ($)</label>
              <input
                type="number"
                className="onboarding-input"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                placeholder="10"
              />
            </div>

            <Pressable 
              className="btn-primary" 
              style={{ marginTop: 32, width: '100%' }}
              onClick={handleGenerate}
            >
              <Sparkles size={20} />
              <span>Generate Page</span>
            </Pressable>
          </div>
        )}

        {/* STEP 2: GENERATING */}
        {step === 'generating' && (
          <div key="generating" className="onboarding-content-centered">
            <div className="ai-generating-pulse">
              <Sparkles size={48} />
            </div>
            <h2 className="onboarding-title" style={{ marginTop: 32 }}>Crafting your page...</h2>
            <p className="onboarding-subtitle">Writing bio • Structuring perks • Optimizing for conversion</p>
          </div>
        )}

        {/* STEP 3: REVIEW */}
        {step === 'review' && !showPayoutWall && (
          <div key="review" className="onboarding-content-centered" style={{ maxWidth: 500 }}>
            <div className="onboarding-success-icon">
              <Check size={32} />
            </div>
            <h1 className="onboarding-title">Here's your draft</h1>

            {/* Preview Card */}
            <div style={{ 
              background: 'var(--surface)', 
              border: '1px solid var(--border)', 
              borderRadius: 16, 
              padding: 24,
              width: '100%',
              marginTop: 24,
              textAlign: 'left'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <span style={{ fontSize: 24, fontWeight: 700 }}>${priceInput}/mo</span>
                <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Standard Tier</span>
              </div>
              
              <div style={{ marginBottom: 24 }}>
                <label style={{ fontSize: 12, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 1 }}>Bio</label>
                <p style={{ fontSize: 16, lineHeight: 1.5 }}>{generatedBio}</p>
              </div>

              <div>
                <label style={{ fontSize: 12, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 1 }}>Perks</label>
                <ul style={{ marginTop: 8, paddingLeft: 0, listStyle: 'none' }}>
                  {generatedPerks.map((perk, i) => (
                    <li key={i} style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 15 }}>
                      <Check size={18} color="var(--success)" />
                      {perk}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 32, width: '100%' }}>
               <Pressable 
                className="btn-secondary" 
                style={{ flex: 1 }}
                onClick={() => setStep('input')}
              >
                <RefreshCw size={20} />
                <span>Try Again</span>
              </Pressable>
              
              <Pressable 
                className="btn-primary" 
                style={{ flex: 2 }}
                onClick={handlePublishClick}
                disabled={isPublishing}
              >
                {isPublishing ? <Loader2 size={20} className="spin" /> : <Check size={20} />}
                <span>Publish Page</span>
              </Pressable>
            </div>
          </div>
        )}

        {/* PAYOUT WALL MODAL */}
        {showPayoutWall && (
          <div key="payouts" className="onboarding-content-centered" style={{ maxWidth: 400 }}>
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
        )}

      </>
    </div>
  )
}
