import { type ReactNode } from 'react'
import { useParams, Navigate, useSearchParams } from 'react-router-dom'
import { Lock, Clock, AlertCircle } from 'lucide-react'
import { isReservedUsername } from '../utils/constants'
import { usePublicProfile } from '../api/hooks'
import { Pressable } from '../components'

// This component handles vanity URLs like natepay.co/username
// It checks if the username is valid and renders the subscribe page

import SubscribeBoundary from './SubscribeBoundary'
import AlreadySubscribed from './AlreadySubscribed'


export default function UserPage() {
  const { username } = useParams<{ username: string }>()
  const [searchParams] = useSearchParams()

  // Check for checkout result query params (canceled state shown in SubscribeBoundary)
  const isCanceled = searchParams.get('canceled') === 'true'

  // Fetch real profile data from API (includes viewerSubscription if logged in)
  // Hook must be called before any early returns (Rules of Hooks)
  const { data, isLoading, error, refetch } = usePublicProfile(username || '')

  // If no username or it's a reserved route, redirect to onboarding
  if (!username || isReservedUsername(username)) {
    return <Navigate to="/onboarding" replace />
  }

  // Loading state - matches SubscribeBoundary background for seamless transition
  if (isLoading) {
    return (
      <div style={{
        minHeight: '100dvh',
        background: 'url("/Vector87.svg") center center / cover no-repeat, linear-gradient(180deg, #FFE7A0 0%, #FFF5D6 100%)',
      }} />
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

  // Currently only 'boundary' template is implemented
  // The template field is stored in profile for future expansion
  if (isOwner) {
    content = <SubscribeBoundary profile={data.profile} canceled={isCanceled} isOwner={true} />
  } else if (data.viewerSubscription?.isActive) {
    content = (
      <AlreadySubscribed
        profile={data.profile}
        subscription={data.viewerSubscription}
      />
    )
  } else {
    content = <SubscribeBoundary profile={data.profile} canceled={isCanceled} isOwner={false} />
  }

  return <>{content}</>
}
