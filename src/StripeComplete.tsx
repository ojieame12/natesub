import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle, AlertCircle, Loader2, Building2, Calendar, Copy, Share2, ExternalLink, ArrowRight, ArrowLeft } from 'lucide-react'
import { api } from './api'
import { useProfile } from './api/hooks'
import { useOnboardingStore } from './onboarding/store'
import { setPaymentConfirmed } from './App'
import { Pressable } from './components'
import './StripeComplete.css'

// Format Stripe requirement keys into readable text
function formatRequirement(key: string): string {
  const map: Record<string, string> = {
    'individual.address.city': 'City',
    'individual.address.line1': 'Street address',
    'individual.address.postal_code': 'Postal code',
    'individual.address.state': 'State/Province',
    'individual.dob.day': 'Date of birth',
    'individual.dob.month': 'Date of birth',
    'individual.dob.year': 'Date of birth',
    'individual.email': 'Email address',
    'individual.first_name': 'First name',
    'individual.last_name': 'Last name',
    'individual.phone': 'Phone number',
    'individual.id_number': 'ID number (SSN/Tax ID)',
    'individual.ssn_last_4': 'Last 4 digits of SSN',
    'individual.verification.document': 'Identity document',
    'individual.verification.additional_document': 'Additional document',
    'business_profile.url': 'Business website',
    'business_profile.mcc': 'Business category',
    'external_account': 'Bank account',
    'tos_acceptance.date': 'Terms of service acceptance',
    'tos_acceptance.ip': 'Terms of service acceptance',
  }
  return map[key] || key.replace(/[._]/g, ' ').replace(/individual /i, '')
}

interface StripeDetails {
  detailsSubmitted: boolean
  chargesEnabled: boolean
  payoutsEnabled: boolean
  requirements: {
    currentlyDue: string[]
    eventuallyDue: string[]
    pendingVerification: string[]
    disabledReason: string | null
    currentDeadline: string | null
  }
}

type FlowSource = 'onboarding' | 'settings' | 'unknown'

export default function StripeComplete() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: profileData } = useProfile()
  const profile = profileData?.profile
  const { reset: resetOnboarding } = useOnboardingStore()

  const [status, setStatus] = useState<'loading' | 'success' | 'pending' | 'error'>('loading')
  const [details, setDetails] = useState<StripeDetails | null>(null)
  const [copied, setCopied] = useState(false)
  const [isNavigating, setIsNavigating] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [pollAttempts, setPollAttempts] = useState(0)
  const [pollTimedOut, setPollTimedOut] = useState(false)

  // Track where the user came from
  const [source, setSource] = useState<FlowSource>('unknown')

  // Prevent duplicate processing
  const hasProcessedSuccess = useRef(false)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Read source from sessionStorage on mount
  useEffect(() => {
    const storedSource = sessionStorage.getItem('stripe_onboarding_source') as FlowSource | null
    setSource(storedSource || 'unknown')
    // Clear it so we don't reuse stale state
    sessionStorage.removeItem('stripe_onboarding_source')
  }, [])

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [])

  // Check Stripe status
  const checkStatus = useCallback(async () => {
    try {
      const result = await api.stripe.getStatus()
      setDetails(result.details || null)

      if (result.status === 'active') {
        setStatus('success')
      } else if (result.status === 'pending') {
        setStatus('pending')
      } else if (result.status === 'restricted') {
        setStatus('error')
      } else {
        setStatus('pending')
      }
    } catch (err) {
      setStatus('error')
    }
  }, [])

  // Initial status check
  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  // Handle success state - optimistic cache update to prevent webhook race condition
  useEffect(() => {
    if (status === 'success' && !hasProcessedSuccess.current) {
      hasProcessedSuccess.current = true

      // Only reset onboarding store if user came from onboarding flow
      if (source === 'onboarding') {
        resetOnboarding()
      }

      // Set flag so AuthRedirect knows payment is active (even if webhook hasn't arrived)
      // This survives page refreshes and prevents yo-yo redirects
      setPaymentConfirmed()

      // CRITICAL: Optimistic cache update to prevent AuthRedirect bounce
      // This "tricks" the frontend into knowing payments are active before webhook arrives
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

      // Also update profile cache
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
  }, [status, source, resetOnboarding, queryClient])

  // Auto-poll when pending (but don't auto-redirect)
  useEffect(() => {
    if (status === 'pending') {
      setPollAttempts(0)
      setPollTimedOut(false)

      pollIntervalRef.current = setInterval(async () => {
        setPollAttempts(prev => {
          const newAttempts = prev + 1
          if (newAttempts > 12) { // Max 1 minute of polling
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
            setPollTimedOut(true)
            return prev
          }
          return newAttempts
        })

        try {
          const result = await api.stripe.getStatus()
          setDetails(result.details || null)
          if (result.status === 'active') {
            setStatus('success')
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
          } else if (result.status === 'restricted') {
            setStatus('error')
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
          }
        } catch {
          // Continue polling on error
        }
      }, 5000)

      return () => {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
      }
    }
  }, [status])

  const shareUrl = profile?.username ? `natepay.co/${profile.username}` : null
  const fullShareUrl = shareUrl ? `https://${shareUrl}` : null

  const handleCopy = async () => {
    if (fullShareUrl) {
      await navigator.clipboard.writeText(fullShareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 3000) // 3 seconds for better visibility
    }
  }

  const handleShare = async () => {
    if (fullShareUrl && navigator.share) {
      try {
        await navigator.share({
          title: `Support ${profile?.displayName || 'me'} on NatePay`,
          url: fullShareUrl,
        })
      } catch (err) {
        // User cancelled or error
      }
    }
  }

  // Manual continue - trust the optimistic update, don't refetch
  // Refetching would overwrite optimistic cache with stale DB data (webhook race)
  const handleContinue = () => {
    setIsNavigating(true)
    const destination = source === 'settings' ? '/settings/payments' : '/dashboard'
    navigate(destination, { replace: true })
  }

  // Allow user to proceed to dashboard even while pending
  const handleProceedAnyway = async () => {
    setIsNavigating(true)
    // Set optimistic state so they don't get bounced
    queryClient.setQueryData(['currentUser'], (oldData: any) => {
      if (!oldData) return oldData
      return {
        ...oldData,
        onboarding: {
          ...oldData.onboarding,
          hasActivePayment: true, // Optimistic - webhook will confirm
        },
      }
    })
    navigate('/dashboard', { replace: true })
  }

  const handleRetrySetup = async () => {
    setIsRetrying(true)
    setRetryError(null)
    try {
      const result = await api.stripe.refreshOnboarding()
      if (result.onboardingUrl) {
        // Preserve the source for when they return
        sessionStorage.setItem('stripe_onboarding_source', source)
        window.location.href = result.onboardingUrl
      } else {
        setRetryError('Unable to get onboarding link. Please try again.')
        setIsRetrying(false)
      }
    } catch (err: any) {
      setRetryError(err?.error || 'Failed to connect to Stripe. Please try again.')
      setIsRetrying(false)
    }
  }

  // Destination text based on source
  const destinationText = source === 'settings' ? 'Payment Settings' : 'Dashboard'
  const backDestination = source === 'settings' ? '/settings/payments' : '/dashboard'

  return (
    <div className="stripe-complete-page">
      <div className="stripe-complete-header">
        <img src="/logo.svg" alt="NatePay" className="stripe-complete-logo" />
      </div>
      <div className="stripe-complete-card">
        {status === 'loading' && (
          <div className="status-content">
            <div className="status-icon loading">
              <Loader2 size={32} className="spin" />
            </div>
            <h2>Verifying your account...</h2>
            <p>This will only take a moment</p>
          </div>
        )}

        {status === 'success' && (
          <>
            {/* Success Header */}
            <div className="status-content">
              <div className="status-icon success">
                <CheckCircle size={32} />
              </div>
              <h2>You're ready to get paid!</h2>
              <p>Your payment account is now active</p>
            </div>

            {/* What's Connected */}
            <div className="connected-details">
              <div className="detail-item">
                <div className="detail-icon">
                  <Building2 size={18} />
                </div>
                <div className="detail-info">
                  <span className="detail-label">Bank Account</span>
                  <span className="detail-value">Connected via Stripe</span>
                </div>
                <CheckCircle size={16} className="detail-check" />
              </div>

              <div className="detail-item">
                <div className="detail-icon">
                  <Calendar size={18} />
                </div>
                <div className="detail-info">
                  <span className="detail-label">Payouts</span>
                  <span className="detail-value">Daily automatic deposits</span>
                </div>
                <CheckCircle size={16} className="detail-check" />
              </div>
            </div>

            {/* Fee Breakdown - only show if from onboarding (first time) */}
            {source === 'onboarding' && (() => {
              // Fee rate varies by purpose: 8% for service, 10% for personal
              const feeRate = profile?.purpose === 'service' ? 8 : 10
              const examplePrice = 10
              const exampleFee = examplePrice * feeRate / 100
              const exampleTotal = examplePrice + exampleFee
              return (
                <div className="fee-breakdown">
                  <div className="fee-header">How pricing works</div>
                  <div className="fee-flow">
                    <div className="fee-step highlight">
                      <span className="fee-amount">${examplePrice}</span>
                      <span className="fee-label">You set</span>
                    </div>
                    <ArrowRight size={16} className="fee-arrow" />
                    <div className="fee-step">
                      <span className="fee-amount addition">+${exampleFee.toFixed(2).replace(/\.00$/, '')}</span>
                      <span className="fee-label">{feeRate}% fee added</span>
                    </div>
                    <ArrowRight size={16} className="fee-arrow" />
                    <div className="fee-step">
                      <span className="fee-amount">${exampleTotal.toFixed(2).replace(/\.00$/, '')}</span>
                      <span className="fee-label">Subscriber pays</span>
                    </div>
                  </div>
                  <p className="fee-note">You receive your full price. Service fee is added at checkout.</p>
                </div>
              )
            })()}

            {/* Share Your Page - only show if from onboarding */}
            {source === 'onboarding' && shareUrl && (
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

            {/* CTAs - NO auto-redirect, user must click */}
            <div className="cta-section">
              <Pressable
                className="btn-primary"
                onClick={handleContinue}
                disabled={isNavigating}
              >
                {isNavigating ? (
                  <>
                    <Loader2 size={18} className="spin" style={{ marginRight: 8 }} />
                    Loading...
                  </>
                ) : (
                  `Continue to ${destinationText}`
                )}
              </Pressable>
              <Pressable
                className="btn-secondary"
                onClick={async () => {
                  try {
                    const result = await api.stripe.getDashboardLink()
                    if (result.url) window.open(result.url, '_blank')
                  } catch {}
                }}
              >
                <span>Stripe Dashboard</span>
                <ExternalLink size={16} />
              </Pressable>
            </div>
          </>
        )}

        {status === 'pending' && (
          <div className="status-content">
            <div className="status-icon pending">
              <Loader2 size={32} className="spin" />
            </div>
            <h2>Verification in Progress</h2>
            <p>Stripe is reviewing your details. This usually takes a few minutes but can take up to 24 hours for some accounts.</p>

            {!pollTimedOut ? (
              <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 8 }}>
                Checking automatically... (attempt {pollAttempts + 1} of 12)
              </p>
            ) : (
              <div style={{
                padding: '12px 16px',
                background: 'rgba(245, 158, 11, 0.1)',
                borderRadius: 12,
                marginTop: 16,
              }}>
                <p style={{ fontSize: 14, color: 'var(--warning)', margin: 0 }}>
                  Verification is taking longer than expected. You can continue to the dashboard and we'll notify you when it's complete.
                </p>
              </div>
            )}

            <div className="cta-section">
              <Pressable
                className="btn-primary"
                onClick={handleProceedAnyway}
                disabled={isNavigating}
              >
                {isNavigating ? (
                  <>
                    <Loader2 size={18} className="spin" style={{ marginRight: 8 }} />
                    Loading...
                  </>
                ) : (
                  'Continue to Dashboard'
                )}
              </Pressable>
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 8 }}>
                You can use the app while verification completes. We'll notify you when you're ready to accept payments.
              </p>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="status-content">
            <div className="status-icon error">
              <AlertCircle size={32} />
            </div>
            <h2>Action Required</h2>
            <p>Additional information is needed to complete your account setup.</p>

            {details?.requirements?.currentlyDue && details.requirements.currentlyDue.length > 0 && (
              <div className="requirements-list">
                <span className="requirements-label">Missing information:</span>
                <ul>
                  {/* Deduplicate requirements (e.g., dob.day/month/year all become "Date of birth") */}
                  {[...new Set(details.requirements.currentlyDue.slice(0, 5).map(formatRequirement))].map((req, i) => (
                    <li key={i}>{req}</li>
                  ))}
                  {details.requirements.currentlyDue.length > 5 && (
                    <li>+{details.requirements.currentlyDue.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}

            {retryError && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 16px',
                background: 'rgba(239, 68, 68, 0.1)',
                borderRadius: 12,
                marginBottom: 16,
              }}>
                <AlertCircle size={18} color="var(--error)" />
                <span style={{ fontSize: 14, color: 'var(--error)' }}>{retryError}</span>
              </div>
            )}

            <div className="cta-section">
              <Pressable
                className="btn-primary"
                onClick={handleRetrySetup}
                disabled={isRetrying}
              >
                {isRetrying ? (
                  <>
                    <Loader2 size={18} className="spin" style={{ marginRight: 8 }} />
                    Connecting...
                  </>
                ) : (
                  'Complete Setup'
                )}
              </Pressable>
              <Pressable className="btn-text" onClick={() => navigate(backDestination)}>
                <ArrowLeft size={16} />
                <span>Back to {destinationText}</span>
              </Pressable>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
