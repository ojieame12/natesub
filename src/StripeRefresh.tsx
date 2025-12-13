import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, AlertCircle, ArrowLeft } from 'lucide-react'
import { api } from './api'
import { Pressable } from './components'
import './StripeComplete.css'

type FlowSource = 'onboarding' | 'settings' | 'unknown'

export default function StripeRefresh() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [source, setSource] = useState<FlowSource>('unknown')

  // Read source from sessionStorage on mount
  useEffect(() => {
    const storedSource = sessionStorage.getItem('stripe_onboarding_source') as FlowSource | null
    setSource(storedSource || 'unknown')
    // Don't clear it - we'll pass it along to the new redirect
  }, [])

  useEffect(() => {
    refreshOnboarding()
  }, [])

  async function refreshOnboarding() {
    try {
      const result = await api.stripe.refreshOnboarding()
      if (result.onboardingUrl) {
        // Preserve the source for when user returns from Stripe
        // Source is already in sessionStorage from original redirect
        window.location.href = result.onboardingUrl
      }
    } catch (err: any) {
      setError(err?.error || 'Failed to refresh onboarding link')
    }
  }

  const destinationText = source === 'settings' ? 'Payment Settings' : 'Dashboard'
  const backDestination = source === 'settings' ? '/settings/payments' : '/dashboard'

  if (error) {
    return (
      <div className="stripe-complete-page">
        <div className="stripe-complete-header">
          <img src="/logo.svg" alt="NatePay" className="stripe-complete-logo" />
        </div>
        <div className="stripe-complete-card">
          <div className="status-content">
            <div className="status-icon error">
              <AlertCircle size={32} />
            </div>
            <h2>Unable to Continue</h2>
            <p>{error}</p>
            <div className="cta-section">
              <Pressable className="btn-primary" onClick={() => refreshOnboarding()}>
                Try Again
              </Pressable>
              <Pressable className="btn-text" onClick={() => navigate(backDestination)}>
                <ArrowLeft size={16} />
                <span>Back to {destinationText}</span>
              </Pressable>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="stripe-complete-page">
      <div className="stripe-complete-header">
        <img src="/logo.svg" alt="NatePay" className="stripe-complete-logo" />
      </div>
      <div className="stripe-complete-card">
        <div className="status-content">
          <div className="status-icon loading">
            <RefreshCw size={32} className="spin" />
          </div>
          <h2>Redirecting to Stripe...</h2>
          <p>Please wait while we redirect you to complete your payment setup.</p>
        </div>
      </div>
    </div>
  )
}
