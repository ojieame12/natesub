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

  useEffect(() => {
    const createProfile = async () => {
      try {
        if (!username || !countryCode) {
          throw new Error('Missing required information')
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
        setError(err.message || 'Failed to create account')
      }
    }

    createProfile()
  }, [username, name, country, countryCode, currency, navigate, refetch])

  if (error) {
    return (
      <div className="onboarding-step">
         <div className="onboarding-error">
           <p>{error}</p>
           <button onClick={() => window.location.reload()} className="btn-primary" style={{ marginTop: 16 }}>
             Try Again
           </button>
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
