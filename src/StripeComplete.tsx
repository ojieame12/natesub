import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, AlertCircle, Loader2, Building2, Calendar, Copy, Share2, ExternalLink, ArrowRight } from 'lucide-react'
import { api } from './api'
import { useProfile } from './api/hooks'
import { Pressable } from './components'
import './StripeComplete.css'

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

export default function StripeComplete() {
  const navigate = useNavigate()
  const { data: profileData } = useProfile()
  const profile = profileData?.profile

  const [status, setStatus] = useState<'loading' | 'success' | 'pending' | 'error'>('loading')
  const [details, setDetails] = useState<StripeDetails | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    checkStatus()
  }, [])

  async function checkStatus() {
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
  }

  const shareUrl = profile?.username ? `natepay.co/${profile.username}` : null
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
      } catch (err) {
        // User cancelled or error
      }
    }
  }

  return (
    <div className="stripe-complete-page">
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
                  <span className="fee-amount deduction">-$1</span>
                  <span className="fee-label">10% platform</span>
                </div>
                <ArrowRight size={16} className="fee-arrow" />
                <div className="fee-step highlight">
                  <span className="fee-amount">$9</span>
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

            {/* CTAs */}
            <div className="cta-section">
              <Pressable className="btn-primary" onClick={() => navigate('/dashboard')}>
                Go to Dashboard
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
            <h2>Almost there!</h2>
            <p>Your account is being verified. This usually takes a few minutes.</p>

            <div className="cta-section">
              <Pressable className="btn-secondary" onClick={() => checkStatus()}>
                Check Status
              </Pressable>
              <Pressable className="btn-text" onClick={() => navigate('/dashboard')}>
                Continue to Dashboard
              </Pressable>
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
                  {details.requirements.currentlyDue.slice(0, 3).map((req, i) => (
                    <li key={i}>{req.replace(/[._]/g, ' ').replace(/individual /i, '')}</li>
                  ))}
                  {details.requirements.currentlyDue.length > 3 && (
                    <li>+{details.requirements.currentlyDue.length - 3} more</li>
                  )}
                </ul>
              </div>
            )}

            <div className="cta-section">
              <Pressable
                className="btn-primary"
                onClick={async () => {
                  try {
                    const result = await api.stripe.refreshOnboarding()
                    if (result.onboardingUrl) {
                      window.location.href = result.onboardingUrl
                    }
                  } catch {}
                }}
              >
                Complete Setup
              </Pressable>
              <Pressable className="btn-text" onClick={() => navigate('/settings/payments')}>
                Back to Settings
              </Pressable>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
