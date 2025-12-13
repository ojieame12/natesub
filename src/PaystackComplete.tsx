import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle, AlertCircle, Loader2, Copy, Share2 } from 'lucide-react'
import { api } from './api'
import { Pressable } from './components'
import { getCurrencySymbol, formatAmountWithSeparators } from './utils/currency'
import './StripeComplete.css' // Reuse Stripe complete styles

interface VerificationResult {
  verified: boolean
  status: string
  amount?: number
  currency?: string
  creatorUsername?: string
  customerEmail?: string
  error?: string
}

export default function PaystackComplete() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [verification, setVerification] = useState<VerificationResult | null>(null)
  const [copied, setCopied] = useState(false)

  // Get reference from URL (Paystack adds ?reference=xxx or ?trxref=xxx)
  const reference = searchParams.get('reference') || searchParams.get('trxref')
  const creatorUsername = searchParams.get('creator')

  useEffect(() => {
    async function verifyPayment() {
      if (!reference) {
        setStatus('error')
        setVerification({ verified: false, status: 'error', error: 'No payment reference found' })
        return
      }

      try {
        const result = await api.paystack.verifyTransaction(reference)
        setVerification(result)
        setStatus(result.verified ? 'success' : 'error')
      } catch (err: any) {
        setStatus('error')
        setVerification({
          verified: false,
          status: 'error',
          error: err?.error || 'Failed to verify payment',
        })
      }
    }

    verifyPayment()
  }, [reference])

  const shareUrl = verification?.creatorUsername || creatorUsername
    ? `natepay.co/${verification?.creatorUsername || creatorUsername}`
    : null
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
          title: 'NatePay Subscription',
          url: fullShareUrl,
        })
      } catch {
        // User cancelled
      }
    }
  }

  const handleDone = () => {
    // Navigate back to creator's page with success context (consistent with Stripe flow)
    if (verification?.creatorUsername || creatorUsername) {
      const username = verification?.creatorUsername || creatorUsername
      navigate(`/${username}?success=true&provider=paystack`)
    } else {
      navigate('/')
    }
  }

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
            <h2>Verifying payment...</h2>
            <p>Please wait while we confirm your subscription</p>
          </div>
        )}

        {status === 'success' && verification && (
          <>
            <div className="status-content">
              <div className="status-icon success">
                <CheckCircle size={32} />
              </div>
              <h2>Payment Successful!</h2>
              <p>Your subscription is now active</p>
            </div>

            {verification.amount && verification.currency && (
              <div className="connected-details">
                <div className="detail-item" style={{ justifyContent: 'center' }}>
                  <div className="detail-info" style={{ textAlign: 'center' }}>
                    <span className="detail-label">Amount Paid</span>
                    <span className="detail-value" style={{ fontSize: 24, fontWeight: 600 }}>
                      {getCurrencySymbol(verification.currency)}
                      {formatAmountWithSeparators(verification.amount / 100, verification.currency)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {shareUrl && (
              <div className="share-section">
                <div className="share-header">Share this page</div>
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

            <div className="cta-section">
              <Pressable className="btn-primary" onClick={handleDone}>
                Done
              </Pressable>
            </div>
          </>
        )}

        {status === 'error' && (
          <div className="status-content">
            <div className="status-icon error">
              <AlertCircle size={32} />
            </div>
            <h2>Payment Issue</h2>
            <p>{verification?.error || 'We could not verify your payment. Please try again or contact support.'}</p>

            <div className="cta-section" style={{ marginTop: 24 }}>
              <Pressable className="btn-primary" onClick={() => window.history.length > 2 ? navigate(-1) : navigate('/')}>
                Try Again
              </Pressable>
              <Pressable
                className="btn-secondary"
                onClick={() => navigate('/')}
                style={{ marginTop: 12 }}
              >
                Go Home
              </Pressable>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
