import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { setPaymentConfirmed } from './utils/paymentConfirmed'
import { getReviewStepIndex } from './utils/constants'
import { useOnboardingStore } from './onboarding/store'
import './StripeComplete.css'

/**
 * PaystackOnboardingComplete - Handles redirect after Paystack bank setup
 *
 * This page auto-redirects to the review/launch step (dynamic based on flow).
 * No intermediate UI is shown - users go straight to setting up their page.
 */
export default function PaystackOnboardingComplete() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { countryCode } = useOnboardingStore()
  const hasProcessed = useRef(false)

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

      // Immediately redirect to review/launch step (dynamic based on country)
      const reviewStep = getReviewStepIndex(countryCode)
      navigate(`/onboarding?step=${reviewStep}`, { replace: true })
    }
  }, [navigate, queryClient, countryCode])

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
