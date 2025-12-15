import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useOnboardingStore } from '../store'
import { api } from '../../api'
import { useAuthState } from '../../hooks/useAuthState'

export default function CreateProfileStep() {
  const navigate = useNavigate()
  const { refetch } = useAuthState()
  const [error, setError] = useState<string | null>(null)

  // Get data from store
  const username = useOnboardingStore(state => state.username)
  const name = useOnboardingStore(state => state.name)
  const country = useOnboardingStore(state => state.country)
  const countryCode = useOnboardingStore(state => state.countryCode)
  const currency = useOnboardingStore(state => state.currency)
  const goToStep = useOnboardingStore(state => state.goToStep)

  useEffect(() => {
    const createProfile = async () => {
      try {
        if (!countryCode) {
          // Missing country - go back to IdentityStep (index 3)
          goToStep(3)
          return
        }

        if (!username) {
          // Missing username - go back to UsernameStep (index 4)
          goToStep(4)
          return
        }

        // 1. Create profile with safe defaults
        // purpose='support' satisfies backend enum validation
        await api.profile.update({
          username,
          displayName: name || username,
          country: country || 'United States',
          countryCode,
          currency: currency || 'USD',
          purpose: 'support',
          pricingModel: 'single',
          bio: '',
        })

        // 2. Set as Private/Draft (must be a separate call)
        await api.profile.updateSettings({ isPublic: false })

        // Force auth refresh to pick up new profile
        await refetch()

        // Clear onboarding state
        await api.auth.saveOnboardingProgress({ step: 4, data: {} }) // Mark as done on backend

        // Redirect to dashboard
        navigate('/dashboard', { replace: true })

      } catch (err: any) {
        console.error('Failed to create profile:', err)
        setError(err?.error || err?.message || 'Failed to create account')
      }
    }

    createProfile()
  }, [username, name, country, countryCode, currency, navigate, refetch, goToStep])

  if (error) {
    return (
      <div className="onboarding-step">
        <div className="onboarding-error">
          <p>{error}</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16, flexWrap: 'wrap' }}>
            <button onClick={() => goToStep(4)} className="btn-secondary">
              Back
            </button>
            <button onClick={() => window.location.reload()} className="btn-primary">
              Try Again
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="onboarding-step centered">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <Loader2 size={48} className="spin" style={{ opacity: 0.5 }} />
        <h2>Setting up your dashboard...</h2>
      </div>
    </div>
  )
}
