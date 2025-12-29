import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { setPaymentConfirmed } from './utils/paymentConfirmed'
import { useOnboardingStore, useShallow, type OnboardingStepKey } from './onboarding/store'
import { useProfile, useCurrentUser } from './api/hooks'
import './StripeComplete.css'

/**
 * PaystackOnboardingComplete - Handles redirect after Paystack bank setup
 *
 * For non-service users: redirects to review step
 * For service users: redirects to the appropriate service step based on progress:
 *   - No service description → service-desc
 *   - Has description, no perks → ai-gen
 *   - Has perks → review
 */
export default function PaystackOnboardingComplete() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Use shallow selector to prevent unnecessary re-renders
  const {
    countryCode,
    purpose,
    serviceDescription,
    servicePerks,
    hydrateFromServer,
  } = useOnboardingStore(useShallow((s) => ({
    countryCode: s.countryCode,
    purpose: s.purpose,
    serviceDescription: s.serviceDescription,
    servicePerks: s.servicePerks,
    hydrateFromServer: s.hydrateFromServer,
  })))

  const { data: profileData } = useProfile()
  const { data: userData } = useCurrentUser()
  const profile = profileData?.profile
  const hasProcessed = useRef(false)
  const hasHydrated = useRef(false)

  // Use store → profile → backend onboardingData fallback chain (most robust)
  // This handles cases where localStorage is cleared (Safari, storage reset)
  const resolvedPurpose = purpose || profile?.purpose || userData?.onboarding?.data?.purpose

  // Hydrate store from server if store is empty but server has data
  useEffect(() => {
    if (!hasHydrated.current && !purpose && userData?.onboarding?.data?.purpose) {
      hasHydrated.current = true
      hydrateFromServer({
        step: userData.onboarding.step || 0,
        data: userData.onboarding.data,
      })
    }
  }, [userData, purpose, hydrateFromServer])

  /**
   * Determine the correct return step key based on purpose and existing data.
   * For service mode, we need to ensure users complete service-desc and ai-gen steps.
   */
  const getReturnStepKey = (): OnboardingStepKey => {
    // 1. Check sessionStorage first (set by PaymentMethodStep before navigation)
    const sessionReturnTo = sessionStorage.getItem('paystack_return_to')
    if (sessionReturnTo) {
      // Extract step key from URL like "/onboarding?step=service-desc"
      const match = sessionReturnTo.match(/[?&]step=([^&]+)/)
      if (match) {
        sessionStorage.removeItem('paystack_return_to') // Clean up
        return match[1] as OnboardingStepKey
      }
    }

    // 2. Non-service users go straight to review
    if (resolvedPurpose !== 'service') {
      return 'review'
    }

    // 3. Service users: determine based on existing data
    const hasDescription = serviceDescription?.trim()
    const hasPerks = servicePerks?.length >= 3

    if (!hasDescription) return 'service-desc'
    if (!hasPerks) return 'ai-gen'
    return 'review'
  }

  useEffect(() => {
    if (!hasProcessed.current) {
      hasProcessed.current = true

      // Set flag so AuthRedirect knows payment is active (survives page refresh)
      setPaymentConfirmed()

      // Optimistic cache update for payment status
      queryClient.setQueryData(['currentUser'], (oldData: any) => {
        if (!oldData) return oldData
        return {
          ...oldData,
          onboarding: {
            ...oldData.onboarding,
            hasActivePayment: true,
          },
        }
      })

      queryClient.setQueryData(['profile'], (oldData: any) => {
        if (!oldData?.profile) return oldData
        return {
          ...oldData,
          profile: {
            ...oldData.profile,
            payoutStatus: 'active',
          },
        }
      })

      // Navigate to the correct step using step key (not numeric index)
      // This ensures service users go through service-desc and ai-gen steps
      const returnStepKey = getReturnStepKey()
      navigate(`/onboarding?step=${returnStepKey}`, { replace: true })
    }
  }, [navigate, queryClient, resolvedPurpose, serviceDescription, servicePerks])

  // Show minimal loading state while redirecting
  return (
    <div className="stripe-complete-page">
      <div className="stripe-complete-header">
        <img src="/logo.svg" alt="NatePay" className="stripe-complete-logo" />
      </div>
      <div className="stripe-complete-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
        <Loader2 size={32} className="spin" style={{ color: 'var(--primary)' }} />
      </div>
    </div>
  )
}
