/**
 * PublicRequestPage - Public view for payment/subscription requests
 *
 * Routes:
 * - /r/:token - View request (accept/decline)
 * - /r/:token/success - After successful payment
 */

import { useState } from 'react'
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom'
import { ArrowLeft, CheckCircle, XCircle, Loader2, DollarSign } from 'lucide-react'
import { Pressable, useToast, Skeleton, AmbientBackground } from '../components'
import { usePublicRequest, useAcceptRequest, useDeclineRequest } from '../api/hooks'
import { getCurrencySymbol } from '../utils/currency'
import '../subscribe/template-one.css'

export default function PublicRequestPage() {
  const { token } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const toast = useToast()

  // Only show back button if there's browser history (not a direct link)
  const canGoBack = typeof window !== 'undefined' && window.history.length > 1

  // Use useLocation for reliable path checks (HashRouter compatible)
  const location = useLocation()
  const isSuccess = location.pathname.endsWith('/success')
  const isCanceled = searchParams.get('canceled') === 'true'

  const { data, isLoading, isError } = usePublicRequest(token || '')
  const { mutateAsync: acceptRequest, isPending: isAccepting } = useAcceptRequest()
  const { mutateAsync: declineRequest, isPending: isDeclining } = useDeclineRequest()

  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')

  const request = data?.request

  const handleAccept = async () => {
    if (!token) return

    // For targeted requests (known recipient), email is optional (handled by backend)
    const isTargeted = request?.hasRecipientEmail

    // Only validate email if we're not in targeted mode
    if (!isTargeted) {
      if (!email.trim()) {
        setEmailError('Email is required')
        return
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setEmailError('Please enter a valid email')
        return
      }
    }
    setEmailError('')

    try {
      const result = await acceptRequest({
        token,
        email: isTargeted ? undefined : email // Send undefined if targeted (backend uses stored email)
      })
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl
      }
    } catch (err: any) {
      toast.error(err?.error || 'Failed to process request')
    }
  }

  const handleDecline = async () => {
    if (!token) return

    try {
      await declineRequest(token)
      toast.success('Request declined')
      // Go back if possible, otherwise just stay (user can close tab)
      if (canGoBack) {
        navigate(-1)
      }
    } catch (err: any) {
      toast.error(err?.error || 'Failed to decline request')
    }
  }

  // Success state
  if (isSuccess) {
    return (
      <>
        <AmbientBackground />
        <div className="sub-page template-boundary">
          <div className="sub-success-container">
            <div className="sub-success-icon">
              <CheckCircle size={48} />
            </div>
            <h1 className="sub-success-title">Payment Complete!</h1>
            <p className="sub-success-message">
              Thank you for your payment. You'll receive a confirmation email shortly.
            </p>
            {canGoBack && (
              <Pressable
                className="sub-payment-btn sub-payment-stripe"
                onClick={() => navigate(-1)}
              >
                Done
              </Pressable>
            )}
          </div>
        </div>
      </>
    )
  }

  // Canceled state
  if (isCanceled) {
    return (
      <>
        <AmbientBackground />
        <div className="sub-page template-boundary">
          <div className="sub-success-container">
            <div className="sub-success-icon" style={{ color: 'var(--text-tertiary)' }}>
              <XCircle size={48} />
            </div>
            <h1 className="sub-success-title">Payment Canceled</h1>
            <p className="sub-success-message">
              No worries! You can try again whenever you're ready.
            </p>
            <Pressable
              className="sub-payment-btn sub-payment-stripe"
              onClick={() => navigate(`/r/${token}`)}
            >
              Try Again
            </Pressable>
          </div>
        </div>
      </>
    )
  }

  // Loading state
  if (isLoading) {
    return (
      <>
        <AmbientBackground />
        <div className="sub-page template-boundary">
          <header className="sub-header">
            {canGoBack ? (
              <Pressable className="sub-back-btn" onClick={() => navigate(-1)}>
                <ArrowLeft size={20} />
              </Pressable>
            ) : (
              <div className="sub-header-spacer" />
            )}
          </header>
          <div className="sub-content">
            <div className="sub-profile">
              <Skeleton width={80} height={80} borderRadius="50%" />
              <Skeleton width={150} height={24} style={{ marginTop: 16 }} />
              <Skeleton width={200} height={16} style={{ marginTop: 8 }} />
            </div>
          </div>
        </div>
      </>
    )
  }

  // Error state
  if (isError || !request) {
    return (
      <>
        <AmbientBackground />
        <div className="sub-page template-boundary">
          <div className="sub-success-container">
            <div className="sub-success-icon" style={{ color: 'var(--error-500)' }}>
              <XCircle size={48} />
            </div>
            <h1 className="sub-success-title">Request Not Found</h1>
            <p className="sub-success-message">
              This request may have expired or been removed.
            </p>
            {canGoBack && (
              <Pressable
                className="sub-payment-btn sub-payment-stripe"
                onClick={() => navigate(-1)}
              >
                Go Back
              </Pressable>
            )}
          </div>
        </div>
      </>
    )
  }

  // Note: Backend returns 410 error for expired/accepted/declined requests,
  // which triggers isError case above. No need for status check here.

  /* TARGETED REQUEST LOGIC */
  // Use the privacy-safe boolean flag
  const isTargeted = request?.hasRecipientEmail
  const knownName = request?.recipientName

  // No auto-fill needed anymore since we don't show the input for targeted requests
  // and we don't need the email in frontend state to submit


  const currencySymbol = getCurrencySymbol(request.currency || 'USD')
  // Backend now returns raw cents (amount) - convert using utility or simple math
  // For display purposes, we assume standard 100-cent currencies for now unless currency utils handle it
  // TODO: Use a proper currency formatter that handles zero-decimal currencies (JPY, etc)
  const amountDollars = (request.amount || 0) / 100

  return (
    <>
      <AmbientBackground />
      <div className="sub-page template-boundary">
        <header className="sub-header">
          {canGoBack ? (
            <Pressable className="sub-back-btn" onClick={() => navigate(-1)}>
              <ArrowLeft size={20} />
            </Pressable>
          ) : (
            <div className="sub-header-spacer" />
          )}
        </header>

        <div className="sub-content">
          {/* Creator Profile */}
          <div className="sub-profile">
            <div className="sub-avatar">
              {request.creator?.avatarUrl ? (
                <img src={request.creator.avatarUrl} alt="" className="sub-avatar-img" />
              ) : (
                <span className="sub-avatar-letter">
                  {(request.creator?.displayName || 'U').charAt(0).toUpperCase()}
                </span>
              )}
            </div>

            {/* TARGETED GREETING */}
            {knownName ? (
              <>
                <h1 className="sub-name">Hi {knownName.split(' ')[0]}!</h1>
                <p className="sub-username">
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{request.creator?.displayName}</span> request
                </p>
              </>
            ) : (
              <>
                <h1 className="sub-name">{request.creator?.displayName || 'Someone'}</h1>
                <p className="sub-username">sent you a request</p>
              </>
            )}
          </div>

          {/* Request Details */}
          <div className="sub-card glass-card" style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{
                width: 40,
                height: 40,
                borderRadius: '50%',
                background: 'var(--primary-100)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--primary-600)'
              }}>
                <DollarSign size={20} />
              </div>
              <div>
                <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {currencySymbol}{amountDollars.toLocaleString()}
                </div>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                  {request.isRecurring ? 'Monthly' : 'One-time'}
                </div>
              </div>
            </div>

            {request.message && (
              <p style={{
                fontSize: 15,
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
                padding: 16,
                background: 'var(--bg-subtle)',
                borderRadius: 12,
                margin: '16px 0'
              }}>
                "{request.message}"
              </p>
            )}

            {/* Voice Note - render if creator included one */}
            {request.voiceUrl && (
              <div style={{ marginTop: 16 }}>
                <audio
                  controls
                  src={request.voiceUrl}
                  style={{
                    width: '100%',
                    borderRadius: 8,
                    background: 'var(--bg-subtle)',
                  }}
                  onError={(e) => console.error('Voice note playback error:', e)}
                />
              </div>
            )}
          </div>

          {/* Email Input - ONLY SHOW IF UNKNOWN (Public Mode) */}
          {!isTargeted && (
            <div className="sub-email-section" style={{ marginTop: 24 }}>
              <label className="sub-email-label">Your email</label>
              <input
                type="email"
                className={`sub-email-input ${emailError ? 'error' : ''}`}
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  if (emailError) setEmailError('')
                }}
              />
              {emailError && <span className="sub-email-error">{emailError}</span>}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Pressable
              className="sub-payment-btn sub-payment-stripe"
              onClick={handleAccept}
              disabled={isAccepting || isDeclining}
            >
              {isAccepting ? (
                <>
                  <Loader2 size={18} className="spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <span>Pay {currencySymbol}{amountDollars.toLocaleString()}</span>
              )}
            </Pressable>

            <Pressable
              className="sub-payment-btn"
              style={{
                background: 'transparent',
                border: '1px solid var(--border-default)',
                color: 'var(--text-secondary)'
              }}
              onClick={handleDecline}
              disabled={isAccepting || isDeclining}
            >
              {isDeclining ? (
                <>
                  <Loader2 size={18} className="spin" />
                  <span>Declining...</span>
                </>
              ) : (
                <span>Decline</span>
              )}
            </Pressable>
          </div>
        </div>
      </div>
    </>
  )
}
