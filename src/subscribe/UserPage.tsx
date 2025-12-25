import { type ReactNode } from 'react'
import { useParams, Navigate, useSearchParams } from 'react-router-dom'
import { Lock, Clock, AlertCircle } from 'lucide-react'
import { isReservedUsername } from '../utils/constants'
import { usePublicProfile } from '../api/hooks'
import { Pressable } from '../components'

// This component handles vanity URLs like natepay.co/username
// It checks if the username is valid and renders the subscribe page

import SubscribeBoundary from './SubscribeBoundary'
import SubscriptionSuccess from './SubscriptionSuccess'
import AlreadySubscribed from './AlreadySubscribed'


export default function UserPage() {
  const { username } = useParams<{ username: string }>()
  const [searchParams] = useSearchParams()

  // Check for checkout result query params
  const isSuccess = searchParams.get('success') === 'true'
  const isCanceled = searchParams.get('canceled') === 'true'
  const provider = searchParams.get('provider')

  // Fetch real profile data from API (includes viewerSubscription if logged in)
  // Hook must be called before any early returns (Rules of Hooks)
  const { data, isLoading, error, refetch } = usePublicProfile(username || '')

  // If no username or it's a reserved route, redirect to onboarding
  if (!username || isReservedUsername(username)) {
    return <Navigate to="/onboarding" replace />
  }

  // Loading state - minimal to avoid jarring skeleton flash
  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #fff8f0 0%, #fff 50%)' }} />
    )
  }

  // Error handling - differentiate by status code
  if (error || !data?.profile) {
    const errorStatus = (error as any)?.status

    // 403 - Profile is private
    if (errorStatus === 403) {
      return (
        <div className="sub-page template-boundary">
          <div className="sub-not-found">
            <Lock size={48} style={{ marginBottom: 16, opacity: 0.6 }} />
            <h1>Private Profile</h1>
            <p>@{username} has made their page private.</p>
          </div>
        </div>
      )
    }

    // 429 - Rate limited
    if (errorStatus === 429) {
      return (
        <div className="sub-page template-boundary">
          <div className="sub-not-found">
            <Clock size={48} style={{ marginBottom: 16, opacity: 0.6 }} />
            <h1>Too Many Requests</h1>
            <p>Please wait a moment and try again.</p>
            <Pressable
              className="sub-retry-btn"
              onClick={() => refetch()}
              style={{ marginTop: 24 }}
            >
              Try Again
            </Pressable>
          </div>
        </div>
      )
    }

    // 500+ - Server error
    if (errorStatus >= 500) {
      return (
        <div className="sub-page template-boundary">
          <div className="sub-not-found">
            <AlertCircle size={48} style={{ marginBottom: 16, opacity: 0.6 }} />
            <h1>Something went wrong</h1>
            <p>We're having trouble loading this page. Please try again.</p>
            <Pressable
              className="sub-retry-btn"
              onClick={() => refetch()}
              style={{ marginTop: 24 }}
            >
              Try Again
            </Pressable>
          </div>
        </div>
      )
    }

    // Default: 404 not found (or unknown error)
    return (
      <div className="sub-page template-boundary">
        <div className="sub-not-found">
          <h1>Page not found</h1>
          <p>The user @{username} doesn't exist or hasn't set up their page yet.</p>
        </div>
      </div>
    )
  }

  let content: ReactNode
  const isOwner = Boolean(data.isOwner)
  const templateToUse = data.profile.template || 'boundary' // Restored

  // Determine template component
  // Only 'boundary' is currently implemented - 'minimal' and 'editorial' coming soon
  const renderTemplate = (_tpl: string | null, isOwnerMode: boolean = false) => {
    // All templates currently use Boundary until others are implemented
    return <SubscribeBoundary profile={data.profile} canceled={isCanceled} isOwner={isOwnerMode} />
  }

  if (isSuccess && templateToUse !== 'boundary') {
    // Legacy success page for non-boundary templates (if any)
    // Since boundary handles its own success, we might eventually remove SubscriptionSuccess entirely
    content = <SubscriptionSuccess profile={data.profile} provider={provider} />
  } else if (isOwner) {
    content = renderTemplate(templateToUse, true)
  } else if (data.viewerSubscription?.isActive) {
    content = (
      <AlreadySubscribed
        profile={data.profile}
        subscription={data.viewerSubscription}
      />
    )
  } else {
    content = renderTemplate(templateToUse, false)
  }

  return <>{content}</>
}
