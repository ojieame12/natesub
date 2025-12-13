/**
 * useAuthState - Centralized auth state management
 *
 * Implements the "Patient State Machine" pattern:
 * - unknown: Initial state, no check performed yet
 * - checking: API call in progress to verify token
 * - authenticated: Valid session confirmed by server
 * - unauthenticated: No token or invalid token
 *
 * This hook is the SINGLE SOURCE OF TRUTH for auth state.
 * All routing decisions should be based on this state.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { getAuthToken } from '../api/client'

export type AuthStatus =
  | 'unknown'        // Initial state, haven't checked yet
  | 'checking'       // API call in progress
  | 'authenticated'  // Valid session
  | 'unauthenticated' // No session or invalid

export interface AuthState {
  /** Current auth status */
  status: AuthStatus

  /** User data (only available when authenticated) */
  user: {
    id: string
    email: string
    profile: any | null
  } | null

  /** Onboarding state for routing decisions */
  onboarding: {
    hasProfile: boolean
    hasActivePayment: boolean
    step: number | null
    branch: 'personal' | 'service' | null
    redirectTo: string
  } | null

  /** Whether auth check is complete (status is not unknown/checking) */
  isReady: boolean

  /** Whether user is fully set up (profile + payment) */
  isFullySetUp: boolean

  /** Whether user has profile but needs payment setup */
  needsPaymentSetup: boolean

  /** Whether user needs to complete onboarding */
  needsOnboarding: boolean

  /** Error from auth check (if any) */
  error: Error | null

  /** Force a refresh of auth state */
  refetch: () => void
}

export function useAuthState(): AuthState {
  const hasToken = !!getAuthToken()

  const {
    data: user,
    isLoading,
    error,
    refetch,
    failureCount,
  } = useQuery({
    queryKey: ['currentUser'],
    queryFn: api.auth.me,
    // Retry transient errors (500, network) up to 2 times, but not 401s
    retry: (failureCount, err) => {
      const status = (err as any)?.status
      // Don't retry 401s - they're definitive
      if (status === 401) return false
      // Retry other errors up to 2 times
      return failureCount < 2
    },
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 5000),
    // Cache for 5 minutes - token is cleared on cold start anyway
    staleTime: 5 * 60 * 1000,
    // Only fetch if we have a token
    enabled: hasToken,
    // Don't refetch on window focus to avoid flickering
    refetchOnWindowFocus: false,
  })

  // Compute status based on query state
  const status = useMemo<AuthStatus>(() => {
    // No token = definitely unauthenticated
    if (!hasToken) {
      return 'unauthenticated'
    }

    // Have token but still loading = checking
    if (isLoading) {
      return 'checking'
    }

    // Have token, not loading, but got an error
    if (error) {
      const errStatus = (error as any)?.status
      // 401 = definitely unauthenticated
      if (errStatus === 401) {
        return 'unauthenticated'
      }
      // Other errors (500, network) after retries exhausted = treat as unauthenticated
      // This prevents infinite "checking" state. User can refetch to try again.
      // failureCount >= 2 means we've retried twice and still failed
      if (failureCount >= 2) {
        return 'unauthenticated'
      }
      // Still retrying
      return 'checking'
    }

    // Have token, have user data = authenticated
    if (user) {
      return 'authenticated'
    }

    // Shouldn't reach here, but default to checking
    return 'checking'
  }, [hasToken, isLoading, error, user, failureCount])

  // Derive convenience booleans
  const isReady = status === 'authenticated' || status === 'unauthenticated'
  const hasProfile = user?.onboarding?.hasProfile ?? false
  const hasActivePayment = user?.onboarding?.hasActivePayment ?? false
  const isFullySetUp = hasProfile && hasActivePayment
  const needsPaymentSetup = hasProfile && !hasActivePayment
  const needsOnboarding = !hasProfile

  return {
    status,
    user: user ? {
      id: user.id,
      email: user.email,
      profile: user.profile,
    } : null,
    onboarding: user?.onboarding ? {
      hasProfile: user.onboarding.hasProfile,
      hasActivePayment: user.onboarding.hasActivePayment,
      step: user.onboarding.step ?? null,
      branch: user.onboarding.branch ?? null,
      redirectTo: user.onboarding.redirectTo ?? '/onboarding',
    } : null,
    isReady,
    isFullySetUp,
    needsPaymentSetup,
    needsOnboarding,
    error: error as Error | null,
    refetch,
  }
}

export default useAuthState
