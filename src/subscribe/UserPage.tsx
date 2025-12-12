import { useParams, Navigate, useSearchParams } from 'react-router-dom'
import { isReservedUsername } from '../utils/constants'
import { usePublicProfile } from '../api/hooks'
import SubscribeBoundary from './SubscribeBoundary'
import SubscriptionSuccess from './SubscriptionSuccess'
import { Loader2 } from 'lucide-react'

// This component handles vanity URLs like nate.to/username
// It checks if the username is valid and renders the subscribe page

export default function UserPage() {
  const { username } = useParams<{ username: string }>()
  const [searchParams] = useSearchParams()

  // Check for checkout result query params
  const isSuccess = searchParams.get('success') === 'true'
  const isCanceled = searchParams.get('canceled') === 'true'
  const provider = searchParams.get('provider')

  // If no username or it's a reserved route, redirect to onboarding
  if (!username || isReservedUsername(username)) {
    return <Navigate to="/onboarding" replace />
  }

  // Fetch real profile data from API
  const { data, isLoading, error } = usePublicProfile(username)

  // Loading state
  if (isLoading) {
    return (
      <div className="sub-page template-boundary">
        <div className="sub-loading">
          <Loader2 className="sub-loading-spinner" size={32} />
          <p>Loading...</p>
        </div>
      </div>
    )
  }

  // Error or not found
  if (error || !data?.profile) {
    return (
      <div className="sub-page template-boundary">
        <div className="sub-not-found">
          <h1>Page not found</h1>
          <p>The user @{username} doesn't exist or hasn't set up their page yet.</p>
        </div>
      </div>
    )
  }

  // Show success page after payment
  if (isSuccess) {
    return <SubscriptionSuccess profile={data.profile} provider={provider} />
  }

  // Pass canceled state to show a message
  return <SubscribeBoundary profile={data.profile} canceled={isCanceled} />
}
