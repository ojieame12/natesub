import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { CheckCircle, XCircle, Loader2, AlertCircle, Calendar, DollarSign } from 'lucide-react'
import { Pressable, AmbientBackground } from './components'
import { API_URL } from './api/client'
import './subscribe/template-one.css'

interface SubscriptionInfo {
  id: string
  providerName: string
  providerUsername?: string
  amount: string
  currency: string
  interval: string
  status: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  alreadyCanceled: boolean
}

type PageState = 'loading' | 'confirm' | 'canceling' | 'success' | 'error' | 'already_canceled'

export default function CancelSubscription() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [state, setState] = useState<PageState>('loading')
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    if (!token) {
      setState('error')
      setError('Invalid cancellation link')
      return
    }

    fetch(`${API_URL}/my-subscriptions/unsubscribe/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Invalid or expired link')
        }
        return res.json()
      })
      .then((data) => {
        setSubscription(data.subscription)
        if (data.subscription.alreadyCanceled) {
          setState('already_canceled')
        } else {
          setState('confirm')
        }
      })
      .catch((err) => {
        setState('error')
        setError(err.message || 'Failed to load subscription info')
      })
  }, [token])

  const handleCancel = async () => {
    if (!token) return

    setState('canceling')
    try {
      const res = await fetch(`${API_URL}/my-subscriptions/unsubscribe/${token}`, {
        method: 'POST',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to cancel subscription')
      }

      setState('success')
    } catch (err: any) {
      setState('error')
      setError(err.message || 'Failed to cancel subscription')
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A'
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  return (
    <>
      <AmbientBackground />
      <div className="sub-page template-boundary">
        {/* Loading State */}
        {state === 'loading' && (
          <div className="sub-success-container">
            <div className="sub-success-icon" style={{ color: 'var(--text-secondary)' }}>
              <Loader2 size={48} className="animate-spin" />
            </div>
            <p style={{ color: 'var(--text-secondary)' }}>Loading subscription info...</p>
          </div>
        )}

        {/* Error State */}
        {state === 'error' && (
          <div className="sub-success-container">
            <div className="sub-success-icon" style={{ color: 'var(--accent-red)' }}>
              <XCircle size={48} />
            </div>
            <h1 className="sub-success-title">Something went wrong</h1>
            <p className="sub-success-message" style={{ color: 'var(--accent-red)' }}>
              {error}
            </p>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '14px', marginTop: 'var(--space-lg)' }}>
              This link may have expired or already been used. Please check your email for a newer link,
              or contact the creator directly.
            </p>
          </div>
        )}

        {/* Already Canceled State */}
        {state === 'already_canceled' && subscription && (
          <div className="sub-success-container">
            <div className="sub-success-icon" style={{ color: 'var(--text-secondary)' }}>
              <AlertCircle size={48} />
            </div>
            <h1 className="sub-success-title">Already Canceled</h1>
            <p className="sub-success-message">
              Your subscription to <strong>{subscription.providerName}</strong> has already been canceled.
            </p>
            {subscription.currentPeriodEnd && (
              <p style={{ color: 'var(--text-secondary)', marginTop: 'var(--space-md)' }}>
                You'll continue to have access until {formatDate(subscription.currentPeriodEnd)}.
              </p>
            )}
          </div>
        )}

        {/* Confirmation State */}
        {state === 'confirm' && subscription && (
          <div className="sub-success-container" style={{ gap: 'var(--space-xl)' }}>
            <h1 className="sub-success-title" style={{ marginBottom: 0 }}>Cancel Subscription</h1>

            <div style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-xl)',
              width: '100%',
              maxWidth: '360px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              border: '1px solid var(--border-default)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--accent-primary-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--accent-primary)',
                }}>
                  <DollarSign size={20} />
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{subscription.providerName}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
                    {subscription.amount} {subscription.currency}/{subscription.interval === 'month' ? 'mo' : 'one-time'}
                  </div>
                </div>
              </div>

              {subscription.currentPeriodEnd && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-sm)',
                  padding: 'var(--space-md)',
                  background: 'var(--bg-base)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-secondary)',
                  fontSize: '14px',
                }}>
                  <Calendar size={16} />
                  <span>Next billing: {formatDate(subscription.currentPeriodEnd)}</span>
                </div>
              )}
            </div>

            <p style={{ color: 'var(--text-secondary)', textAlign: 'center', maxWidth: '320px', lineHeight: 1.5 }}>
              Are you sure you want to cancel? You'll continue to have access until the end of your current billing period.
            </p>

            <div style={{ display: 'flex', gap: 'var(--space-md)', width: '100%', maxWidth: '320px' }}>
              <Pressable
                onClick={() => navigate('/')}
                style={{
                  flex: 1,
                  padding: 'var(--space-md) var(--space-lg)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-default)',
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  fontWeight: 500,
                  textAlign: 'center',
                }}
              >
                Keep
              </Pressable>
              <Pressable
                onClick={handleCancel}
                style={{
                  flex: 1,
                  padding: 'var(--space-md) var(--space-lg)',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: 'var(--accent-red)',
                  color: 'white',
                  fontWeight: 500,
                  textAlign: 'center',
                }}
              >
                Cancel
              </Pressable>
            </div>

            <p style={{ color: 'var(--text-tertiary)', fontSize: '12px', textAlign: 'center' }}>
              Secure 1-click cancellation. No login required.
            </p>
          </div>
        )}

        {/* Canceling State */}
        {state === 'canceling' && (
          <div className="sub-success-container">
            <div className="sub-success-icon" style={{ color: 'var(--text-secondary)' }}>
              <Loader2 size={48} className="animate-spin" />
            </div>
            <p style={{ color: 'var(--text-secondary)' }}>Canceling your subscription...</p>
          </div>
        )}

        {/* Success State */}
        {state === 'success' && subscription && (
          <div className="sub-success-container">
            <div className="sub-success-icon" style={{ color: 'var(--accent-green)' }}>
              <CheckCircle size={48} />
            </div>
            <h1 className="sub-success-title">Subscription Canceled</h1>
            <p className="sub-success-message">
              Your subscription to <strong>{subscription.providerName}</strong> has been canceled.
            </p>
            {subscription.currentPeriodEnd && (
              <p style={{ color: 'var(--text-secondary)', marginTop: 'var(--space-md)' }}>
                You'll continue to have access until {formatDate(subscription.currentPeriodEnd)}.
              </p>
            )}
            <p style={{ color: 'var(--text-tertiary)', fontSize: '14px', marginTop: 'var(--space-xl)' }}>
              A confirmation email has been sent to you.
            </p>
          </div>
        )}
      </div>
    </>
  )
}
