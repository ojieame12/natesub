import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Building2, Calendar, Copy, Share2, ArrowRight } from 'lucide-react'
import { useProfile } from './api/hooks'
import { useOnboardingStore } from './onboarding/store'
import { setPaymentConfirmed } from './App'
import { Pressable, LoadingButton } from './components'
import { getPricing } from './utils/pricing'
import { getShareableLink } from './utils/constants'
import './StripeComplete.css' // Reuse Stripe complete styles

export default function PaystackOnboardingComplete() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: profileData } = useProfile()
  const profile = profileData?.profile
  const { branch, reset: resetOnboarding } = useOnboardingStore()

  const [copied, setCopied] = useState(false)
  const [isNavigating, setIsNavigating] = useState(false)
  const hasProcessed = useRef(false)

  // Get fee label based on branch
  const pricing = getPricing(branch === 'service' ? 'service' : undefined)
  const feePercent = Math.round(pricing.transactionFee * 100)

  // On mount, reset onboarding and update cache
  useEffect(() => {
    if (!hasProcessed.current) {
      hasProcessed.current = true

      // Reset onboarding store
      resetOnboarding()

      // Set flag so AuthRedirect knows payment is active (survives page refresh)
      setPaymentConfirmed()

      // Optimistic cache update
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
    }
  }, [resetOnboarding, queryClient])

  const shareUrl = profile?.username ? getShareableLink(profile.username) : null
  const fullShareUrl = shareUrl ? `https://${shareUrl}` : null

  const handleCopy = async () => {
    if (fullShareUrl) {
      await navigator.clipboard.writeText(fullShareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleShare = async () => {
    if (fullShareUrl && navigator.share) {
      try {
        await navigator.share({
          title: `Support ${profile?.displayName || 'me'} on NatePay`,
          url: fullShareUrl,
        })
      } catch {
        // User cancelled
      }
    }
  }

  const handleContinue = () => {
    setIsNavigating(true)
    navigate('/dashboard', { replace: true })
  }

  return (
    <div className="stripe-complete-page">
      <div className="stripe-complete-header">
        <img src="/logo.svg" alt="NatePay" className="stripe-complete-logo" />
      </div>

      <div className="stripe-complete-card">
        {/* Success Header */}
        <div className="status-content">
          <div className="status-icon success success-bounce">
            <CheckCircle size={32} />
          </div>
          <h2>You're ready to get paid!</h2>
          <p>Your bank account is now connected</p>
        </div>

        {/* What's Connected */}
        <div className="connected-details">
          <div className="detail-item">
            <div className="detail-icon">
              <Building2 size={18} />
            </div>
            <div className="detail-info">
              <span className="detail-label">Bank Account</span>
              <span className="detail-value">Connected via Paystack</span>
            </div>
            <CheckCircle size={16} className="detail-check" />
          </div>

          <div className="detail-item">
            <div className="detail-icon">
              <Calendar size={18} />
            </div>
            <div className="detail-info">
              <span className="detail-label">Payouts</span>
              <span className="detail-value">Next business day (T+1)</span>
            </div>
            <CheckCircle size={16} className="detail-check" />
          </div>
        </div>

        {/* Fee Breakdown */}
        <div className="fee-breakdown">
          <div className="fee-header">How you earn</div>
          <div className="fee-flow">
            <div className="fee-step">
              <span className="fee-amount">$10</span>
              <span className="fee-label">Subscriber pays</span>
            </div>
            <ArrowRight size={16} className="fee-arrow" />
            <div className="fee-step">
              <span className="fee-amount deduction">-${10 * feePercent / 100}</span>
              <span className="fee-label">{feePercent}% platform</span>
            </div>
            <ArrowRight size={16} className="fee-arrow" />
            <div className="fee-step highlight">
              <span className="fee-amount">${10 - (10 * feePercent / 100)}</span>
              <span className="fee-label">You receive</span>
            </div>
          </div>
        </div>

        {/* Share Your Page */}
        {shareUrl && (
          <div className="share-section">
            <div className="share-header">Share your page</div>
            <div className="share-url-box">
              <span className="share-url">{shareUrl}</span>
              <div className="share-actions">
                <Pressable className="share-btn" onClick={handleCopy}>
                  {copied ? <CheckCircle size={18} /> : <Copy size={18} />}
                </Pressable>
                <Pressable className="share-btn primary" onClick={handleShare}>
                  <Share2 size={18} />
                </Pressable>
              </div>
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="cta-section">
          <LoadingButton
            className="btn-primary"
            onClick={handleContinue}
            loading={isNavigating}
            fullWidth
          >
            Continue to Dashboard
          </LoadingButton>
        </div>
      </div>
    </div>
  )
}
