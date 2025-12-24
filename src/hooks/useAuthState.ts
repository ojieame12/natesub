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
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { api } from '../api/client'
import { getAuthToken, hasAuthSession, clearAuthSession } from '../api/client'
import { hasRecentPaymentConfirmation } from '../utils/paymentConfirmed'

export type AuthStatus =
  | 'unknown'        // Initial state, haven't checked yet
  | 'checking'       // API call in progress
  | 'authenticated'  // Valid session
  | 'unauthenticated' // No session or invalid (401)
  | 'error'          // Network/server error - don't redirect, show retry

export interface AuthState {
  /** Current auth status */
  status: AuthStatus

  /** User data (only available when authenticated) */
  user: {
    id: string
    email: string
    profile: any | null
    createdAt: string | null
  } | null

  /** Onboarding state for routing decisions */
  onboarding: {
    hasProfile: boolean
    hasActivePayment: boolean
    step: number | null
    branch: 'personal' | 'service' | null
    data: Record<string, any> | null
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
  const queryClient = useQueryClient()
  const hasToken = !!getAuthToken()
  const hasSession = hasAuthSession()
  // Enable auth check if we have either a token or a session flag (cookie-based auth)
  const shouldCheckAuth = hasToken || hasSession

  const {
    data: user,
    isLoading,
    error,
    refetch,
    failureCount,
  } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      const result = await api.auth.me()
      return result
    },
    // Keep previous data while refetching to prevent UI flickering
    // This ensures status stays 'authenticated' during background refetches
    placeholderData: keepPreviousData,
    // Retry transient errors (500, network) once only, but not 401s
    retry: (failureCount, err) => {
      const status = (err as any)?.status
      // Don't retry 401s - they're definitive
      if (status === 401) {
        // Clear session flag and cached data on 401 - session is invalid
        clearAuthSession()
        queryClient.removeQueries({ queryKey: ['currentUser'] })
        return false
      }
      // Retry other errors once only (reduced from 2)
      return failureCount < 1
    },
    retryDelay: () => 1000, // Fixed 1s delay for quick retry
    // Cache for 5 minutes - token is cleared on cold start anyway
    staleTime: 5 * 60 * 1000,
    // Fetch if we have a token OR a session flag (cookie-based auth)
    enabled: shouldCheckAuth,
    // Don't refetch on window focus to avoid flickering
    refetchOnWindowFocus: false,
  })

  // Compute status based on query state
  // With keepPreviousData, `user` retains previous value during refetch,
  // so we stay 'authenticated' instead of flashing to 'checking'
  const status = useMemo<AuthStatus>(() => {
    // No token or session = definitely unauthenticated
    if (!shouldCheckAuth) {
      return 'unauthenticated'
    }

    // Have user data = authenticated (even during refetch with keepPreviousData)
    if (user) {
      return 'authenticated'
    }

    // No user data yet + loading = true initial load, show 'checking'
    if (isLoading) {
      return 'checking'
    }

    // Have token/session, not loading, but got an error
    if (error) {
      const errStatus = (error as any)?.status
      // 401 = definitely unauthenticated
      if (errStatus === 401) {
        return 'unauthenticated'
      }
      // Other errors (500, network) after retry exhausted = show error state
      // This prevents redirecting users during outages. User can retry.
      if (failureCount >= 1) {
        return 'error'
      }
      // Still retrying
      return 'checking'
    }

    // Shouldn't reach here, but default to checking
    return 'checking'
  }, [shouldCheckAuth, isLoading, error, user, failureCount])

  // Derive convenience booleans
  const isReady = status === 'authenticated' || status === 'unauthenticated' || status === 'error'
  const hasProfile = user?.onboarding?.hasProfile ?? false
  // In Stripe/Paystack onboarding flows, webhooks can lag the user return redirect.
  // Treat a recent local "payment confirmed" flag as active payment to avoid yo-yo UX.
  const hasActivePayment = (user?.onboarding?.hasActivePayment ?? false) || hasRecentPaymentConfirmation()
  const isFullySetUp = hasProfile && hasActivePayment
  const needsPaymentSetup = hasProfile && !hasActivePayment
  const needsOnboarding = !hasProfile

  return {
    status,
    user: user ? {
      id: user.id,
      email: user.email,
      profile: user.profile,
      createdAt: user.createdAt ?? null,
    } : null,
    onboarding: user?.onboarding ? {
      hasProfile: user.onboarding.hasProfile,
      hasActivePayment: user.onboarding.hasActivePayment,
      step: user.onboarding.step ?? null,
      branch: user.onboarding.branch ?? null,
      data: user.onboarding.data ?? null,
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
