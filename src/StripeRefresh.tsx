import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, AlertCircle } from 'lucide-react'
import { api } from './api'

export default function StripeRefresh() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    refreshOnboarding()
  }, [])

  async function refreshOnboarding() {
    try {
      const result = await api.stripe.refreshOnboarding()
      if (result.onboardingUrl) {
        window.location.href = result.onboardingUrl
      }
    } catch (err: any) {
      setError(err?.error || 'Failed to refresh onboarding link')
    }
  }

  if (error) {
    return (
      <div className="stripe-complete-page">
        <div className="stripe-complete-card">
          <AlertCircle size={48} className="error-icon" />
          <h2>Unable to Continue</h2>
          <p>{error}</p>
          <button className="primary-btn" onClick={() => navigate('/settings/payments')}>
            Back to Settings
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="stripe-complete-page">
      <div className="stripe-complete-card">
        <RefreshCw size={48} className="spin" />
        <h2>Redirecting to Stripe...</h2>
        <p>Please wait while we redirect you to complete your payment setup.</p>
      </div>
    </div>
  )
}
