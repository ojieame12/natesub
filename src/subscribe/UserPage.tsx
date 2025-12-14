import { lazy, Suspense, type ReactNode } from 'react'
import { useParams, Navigate, useSearchParams } from 'react-router-dom'
import { Lock, Clock, AlertCircle } from 'lucide-react'
import { isReservedUsername } from '../utils/constants'
import { usePublicProfile } from '../api/hooks'
import { Skeleton, SkeletonAvatar, Pressable } from '../components'

// This component handles vanity URLs like natepay.co/username
// It checks if the username is valid and renders the subscribe page

const SubscribeBoundary = lazy(() => import('./SubscribeBoundary'))
const SubscriptionLiquid = lazy(() => import('./SubscriptionLiquid'))
const SubscriptionSuccess = lazy(() => import('./SubscriptionSuccess'))
const AlreadySubscribed = lazy(() => import('./AlreadySubscribed'))

/**
 * SubscriptionPageSkeleton - Matches exact layout of subscription card
 * Prevents layout shift (CLS) by reserving the correct space
 */
function SubscriptionPageSkeleton() {
  return (
    <div className="sub-page template-boundary">
      <div className="sub-skeleton">
        {/* Avatar area */}
        <div className="sub-skeleton-avatar">
          <SkeletonAvatar size={80} />
        </div>
        {/* Name */}
        <Skeleton width={160} height={24} style={{ marginTop: 16 }} />
        {/* Username */}
        <Skeleton width={100} height={14} style={{ marginTop: 8 }} />
        {/* Bio area */}
        <div className="sub-skeleton-bio">
          <Skeleton width="90%" height={14} />
          <Skeleton width="70%" height={14} style={{ marginTop: 8 }} />
        </div>
        {/* Card area placeholder */}
        <div className="sub-skeleton-card">
          <Skeleton width="100%" height={200} borderRadius="var(--radius-xl)" />
        </div>
      </div>
    </div>
  )
}

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

  // Fetch real profile data from API (includes viewerSubscription if logged in)
  const { data, isLoading, error, refetch } = usePublicProfile(username)

  // Loading state - use skeleton that matches final layout
  if (isLoading) {
    return <SubscriptionPageSkeleton />
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

  // Show success page after payment
  if (isSuccess) {
    content = <SubscriptionSuccess profile={data.profile} provider={provider} />
  } else if (data.viewerSubscription?.isActive) {
    // Show "Already Subscribed" if viewer has active subscription
    content = (
      <AlreadySubscribed
        profile={data.profile}
        subscription={data.viewerSubscription}
      />
    )
  } else {
    // Use the profile's saved template preference (default to 'boundary')
    const templateToUse = data.profile.template || 'boundary'
    content = templateToUse === 'liquid'
      ? <SubscriptionLiquid profile={data.profile} canceled={isCanceled} />
      : <SubscribeBoundary profile={data.profile} canceled={isCanceled} />
  }

  return (
    <Suspense fallback={<SubscriptionPageSkeleton />}>
      {content}
    </Suspense>
  )
}
