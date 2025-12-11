import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { api } from './api'
import './StripeComplete.css'

export default function StripeComplete() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<'loading' | 'success' | 'pending' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    checkStatus()
  }, [])

  async function checkStatus() {
    try {
      const result = await api.stripe.getStatus()

      if (result.status === 'active') {
        setStatus('success')
        setMessage('Your payment account is now active! You can start accepting payments.')
      } else if (result.status === 'pending') {
        setStatus('pending')
        setMessage('Your account is being verified. This usually takes a few minutes.')
      } else if (result.status === 'restricted') {
        setStatus('error')
        setMessage('Additional information is required to complete your account setup.')
      } else {
        setStatus('pending')
        setMessage('Setting up your account...')
      }
    } catch (err) {
      setStatus('error')
      setMessage('Failed to verify account status. Please try again.')
    }
  }

  return (
    <div className="stripe-complete-page">
      <div className="stripe-complete-card">
        {status === 'loading' && (
          <>
            <Loader2 size={48} className="spin" />
            <h2>Verifying your account...</h2>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle size={48} className="success-icon" />
            <h2>Payment Setup Complete!</h2>
            <p>{message}</p>
            <button className="primary-btn" onClick={() => navigate('/dashboard')}>
              Go to Dashboard
            </button>
          </>
        )}

        {status === 'pending' && (
          <>
            <Loader2 size={48} className="pending-icon" />
            <h2>Almost There!</h2>
            <p>{message}</p>
            <button className="secondary-btn" onClick={() => checkStatus()}>
              Check Status
            </button>
            <button className="text-btn" onClick={() => navigate('/dashboard')}>
              Continue to Dashboard
            </button>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertCircle size={48} className="error-icon" />
            <h2>Action Required</h2>
            <p>{message}</p>
            <button
              className="primary-btn"
              onClick={async () => {
                try {
                  const result = await api.stripe.refreshOnboarding()
                  if (result.onboardingUrl) {
                    window.location.href = result.onboardingUrl
                  }
                } catch {
                  setMessage('Failed to get onboarding link. Please try again.')
                }
              }}
            >
              Complete Setup
            </button>
            <button className="text-btn" onClick={() => navigate('/settings/payments')}>
              Back to Settings
            </button>
          </>
        )}
      </div>
    </div>
  )
}
