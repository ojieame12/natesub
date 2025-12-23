import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle, AlertCircle, Loader2, Building2, Calendar, Copy, Share2, ExternalLink, ArrowRight, ArrowLeft } from 'lucide-react'
import { api } from './api'
import { useProfile } from './api/hooks'
import { useOnboardingStore } from './onboarding/store'
import { setPaymentConfirmed } from './utils/paymentConfirmed'
import { Pressable, LoadingButton } from './components'
import { getShareableLink } from './utils/constants'
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

// Countries that skip the address step (cross-border recipients)
const SKIP_ADDRESS_COUNTRIES = ['NG', 'GH', 'KE']

// Calculate review step based on country (6 for 7-step flow, 7 for 8-step flow)
function getReviewStep(countryCode: string | null): number {
  const skipAddress = SKIP_ADDRESS_COUNTRIES.includes((countryCode || '').toUpperCase())
  return skipAddress ? 6 : 7
}

export default function StripeComplete() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: profileData } = useProfile()
  const profile = profileData?.profile
  const { reset: resetOnboarding, countryCode } = useOnboardingStore()

  const [status, setStatus] = useState<'loading' | 'success' | 'pending' | 'restricted' | 'network_error'>('loading')
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
    sessionStorage.removeItem('stripe_onboarding_started_at')
  }, [])

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [])

  // Check Stripe status
  // refresh: bypass cache (critical after returning from Stripe onboarding)
  // quick: skip bank details expansion (faster response)
  const checkStatus = useCallback(async (options: { quick?: boolean; refresh?: boolean } = {}) => {
    const result = await api.stripe.getStatus(options)
    setDetails(result.details || null)

    if (result.status === 'active') {
      setStatus('success')
    } else if (result.status === 'restricted') {
      setStatus('restricted')
    } else {
      // pending or any other state → treat as pending
      setStatus('pending')
    }

    return result
  }, [])

  // Initial status check
  // 1) Quick, DB/cached status to render immediately (fast even on cold starts)
  // 2) Forced refresh from Stripe (authoritative) if not already active
  useEffect(() => {
    let cancelled = false
    setRetryError(null)

      ; (async () => {
        try {
          const quickResult = await checkStatus({ quick: true, refresh: false })
          if (cancelled) return
          if (quickResult.status !== 'active') {
            try {
              await checkStatus({ quick: true, refresh: true })
            } catch (err: any) {
              // Don't downgrade a valid quick status just because the refresh call failed.
              setRetryError(err?.error || 'Unable to verify Stripe status right now. Please try again.')
            }
          }
        } catch (err: any) {
          if (cancelled) return
          setStatus('network_error')
          setRetryError(err?.error || 'Unable to verify Stripe status right now. Please try again.')
        }
      })()

    return () => {
      cancelled = true
    }
  }, [checkStatus])

  // Safety Timeout: If loading takes too long (e.g. API hang), force 'pending' state
  // This triggers the polling loop which is more robust and gives feedback
  useEffect(() => {
    if (status !== 'loading') return

    const timer = setTimeout(() => {
      if (status === 'loading') {
        console.warn('[StripeComplete] Safety timeout triggered - forcing pending state')
        setStatus('pending')
      }
    }, 6000) // 6 seconds

    return () => clearTimeout(timer)
  }, [status])

  // Handle success state - optimistic cache update to prevent webhook race condition
  useEffect(() => {
    if (status === 'success' && !hasProcessedSuccess.current) {
      hasProcessedSuccess.current = true

      // NOTE: If source === 'onboarding', we do NOT resetOnboarding() here anymore.
      // We want to preserve the state so they can review it in the final 'Launch' step.
      // The reset will happen in PersonalReviewStep after they click "Launch My Page".
      // if (source === 'onboarding') {
      //   resetOnboarding()
      // }

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
          // Polling: always refresh to get latest status, quick to skip bank details
          const result = await api.stripe.getStatus({ quick: true, refresh: true })
          setDetails(result.details || null)
          if (result.status === 'active') {
            setStatus('success')
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
          } else if (result.status === 'restricted') {
            setStatus('restricted')
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

  const shareUrl = profile?.username ? getShareableLink(profile.username) : null
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
  const handleContinue = useCallback(() => {
    setIsNavigating(true)
    const returnTo = sessionStorage.getItem('stripe_return_to')

    if (returnTo) {
      sessionStorage.removeItem('stripe_return_to')
      navigate(returnTo, { replace: true })
    } else if (source === 'onboarding') {
      // Return to Review step (dynamic based on country/flow length)
      const reviewStep = getReviewStep(countryCode)
      navigate(`/onboarding?step=${reviewStep}`, { replace: true })
    } else if (profile && !profile.isPublic) {
      // Fallback: If source is unknown (lost session) but profile is not public,
      // assume we are in onboarding flow and need to launch.
      const reviewStep = getReviewStep(countryCode)
      navigate(`/onboarding?step=${reviewStep}`, { replace: true })
    } else {
      navigate('/dashboard', { replace: true })
    }
  }, [navigate, source, profile, countryCode])

  // Auto-continue after success for a smoother flow (especially on mobile).
  // Only do this when user came from a known flow, so manual visits don't instantly redirect away.
  useEffect(() => {
    if (status !== 'success') return
    if (source === 'unknown') return
    if (isNavigating) return

    const timer = window.setTimeout(() => {
      handleContinue()
    }, 1200)

    return () => window.clearTimeout(timer)
  }, [status, source, isNavigating, handleContinue])

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

    const returnTo = sessionStorage.getItem('stripe_return_to')
    if (returnTo) {
      sessionStorage.removeItem('stripe_return_to')
      navigate(returnTo, { replace: true })
    } else if (source === 'onboarding') {
      const reviewStep = getReviewStep(countryCode)
      navigate(`/onboarding?step=${reviewStep}`, { replace: true })
    } else {
      navigate('/dashboard', { replace: true })
    }
  }

  const handleRetrySetup = async () => {
    setIsRetrying(true)
    setRetryError(null)
    try {
      const result = await api.stripe.refreshOnboarding()
      if (result.onboardingUrl) {
        // Preserve the source for when they return
        sessionStorage.setItem('stripe_onboarding_source', source)
        sessionStorage.setItem('stripe_onboarding_started_at', Date.now().toString())
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

  const destinationText = 'Dashboard'
  const backDestination = '/dashboard'

  return (
    <div className="stripe-complete-page">
      <div className="stripe-complete-header">
        <Pressable className="stripe-complete-back" onClick={() => navigate(backDestination, { replace: true })}>
          <ArrowLeft size={20} />
        </Pressable>
        <img src="/logo.svg" alt="NatePay" className="stripe-complete-logo" />
        <div className="stripe-complete-spacer" />
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
              <div className="status-icon success success-bounce">
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
              // Split model: 4% subscriber + 4% creator = 8% total
              const examplePrice = 10
              const subscriberFee = examplePrice * 0.04  // 4%
              const creatorFee = examplePrice * 0.04     // 4%
              const subscriberPays = examplePrice + subscriberFee
              const creatorReceives = examplePrice - creatorFee
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
                      <span className="fee-amount">${subscriberPays.toFixed(2).replace(/\.00$/, '')}</span>
                      <span className="fee-label">Subscriber pays</span>
                    </div>
                    <ArrowRight size={16} className="fee-arrow" />
                    <div className="fee-step">
                      <span className="fee-amount">${creatorReceives.toFixed(2).replace(/\.00$/, '')}</span>
                      <span className="fee-label">You receive</span>
                    </div>
                  </div>
                  <p className="fee-note">Secure payment (4%) + Instant payout (4%) = 8% total</p>
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
              <LoadingButton
                className="btn-primary"
                onClick={handleContinue}
                loading={isNavigating}
                fullWidth
              >
                Continue to {destinationText}
              </LoadingButton>
              <Pressable
                className="btn-secondary"
                onClick={async () => {
                  try {
                    const result = await api.stripe.getDashboardLink()
                    if (result.url) window.open(result.url, '_blank', 'noopener,noreferrer')
                  } catch (err) {
                    if (import.meta.env.DEV) console.debug('[stripe] open dashboard failed', err)
                  }
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
            <h2>Almost There!</h2>
            <p>Stripe is verifying your identity. This typically completes within a few minutes.</p>

            {/* What's happening section */}
            <div style={{
              background: 'var(--surface)',
              borderRadius: 12,
              padding: 16,
              marginTop: 16,
              textAlign: 'left',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <CheckCircle size={16} style={{ color: 'var(--success)' }} />
                <span style={{ fontSize: 14 }}>Account created successfully</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <CheckCircle size={16} style={{ color: 'var(--success)' }} />
                <span style={{ fontSize: 14 }}>Details submitted to Stripe</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Loader2 size={16} className="spin" style={{ color: 'var(--warning)' }} />
                <span style={{ fontSize: 14 }}>Identity verification in progress</span>
              </div>
            </div>

            {!pollTimedOut ? (
              <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 12 }}>
                Checking status... ({pollAttempts + 1}/12)
              </p>
            ) : (
              <div style={{
                padding: '12px 16px',
                background: 'rgba(245, 158, 11, 0.1)',
                borderRadius: 12,
                marginTop: 16,
              }}>
                <p style={{ fontSize: 14, color: 'var(--warning)', margin: 0, fontWeight: 500 }}>
                  Taking longer than expected
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0' }}>
                  Some accounts need extra review (up to 24 hours). We'll send you an email the moment you're approved!
                </p>
              </div>
            )}

            <div className="cta-section">
              <LoadingButton
                className="btn-primary"
                onClick={handleProceedAnyway}
                loading={isNavigating}
                fullWidth
              >
                Continue to Dashboard
              </LoadingButton>
              <p style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 8 }}>
                Start setting up your page while we wait. You'll be notified by email when payments are active.
              </p>
            </div>
          </div>
        )}

        {status === 'network_error' && (
          <div className="status-content">
            <div className="status-icon error">
              <AlertCircle size={32} />
            </div>
            <h2>Couldn't verify right now</h2>
            <p>We’re having trouble reaching our servers. Please try again.</p>

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
              <LoadingButton
                className="btn-primary"
                onClick={async () => {
                  setIsRetrying(true)
                  setRetryError(null)
                  try {
                    await checkStatus({ quick: true, refresh: true })
                  } catch (err: any) {
                    setStatus('network_error')
                    setRetryError(err?.error || 'Unable to verify Stripe status right now. Please try again.')
                  } finally {
                    setIsRetrying(false)
                  }
                }}
                loading={isRetrying}
                fullWidth
              >
                Try Again
              </LoadingButton>
              <Pressable className="btn-text" onClick={() => navigate(backDestination)}>
                <ArrowLeft size={16} />
                <span>Back to {destinationText}</span>
              </Pressable>
            </div>
          </div>
        )}

        {status === 'restricted' && (
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
              <LoadingButton
                className="btn-primary"
                onClick={handleRetrySetup}
                loading={isRetrying}
                fullWidth
              >
                Complete Setup
              </LoadingButton>
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
