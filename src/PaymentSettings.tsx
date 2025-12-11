import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Building2, Plus, Check, Loader2, AlertCircle, CreditCard, ExternalLink } from 'lucide-react'
import { Pressable } from './components'
import { api } from './api'
import './PaymentSettings.css'

const payoutSchedules = [
  { id: 'instant', label: 'Instant', desc: 'Get paid immediately (1.5% fee)' },
  { id: 'daily', label: 'Daily', desc: 'Next business day' },
  { id: 'weekly', label: 'Weekly', desc: 'Every Monday' },
  { id: 'monthly', label: 'Monthly', desc: 'First of the month' },
]

interface Payout {
  id: string
  amount: number
  currency: string
  status: string
  arrivalDate: string
  createdAt: string
}

export default function PaymentSettings() {
  const navigate = useNavigate()
  const [payoutSchedule, setPayoutSchedule] = useState('daily')
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Real data from API
  const [stripeStatus, setStripeStatus] = useState<{
    connected: boolean
    status: string
    details?: any
  } | null>(null)
  const [balance, setBalance] = useState({ available: 0, pending: 0 })
  const [payoutHistory, setPayoutHistory] = useState<Payout[]>([])

  useEffect(() => {
    loadPaymentData()
  }, [])

  async function loadPaymentData() {
    setLoading(true)
    setError(null)

    try {
      // Check Stripe connection status
      const status = await api.stripe.getStatus()
      setStripeStatus(status)

      if (status.connected && status.status === 'active') {
        // Fetch balance and payouts
        const [balanceResult, payoutsResult] = await Promise.all([
          api.stripe.getBalance().catch(() => ({ balance: { available: 0, pending: 0 } })),
          api.stripe.getPayouts().catch(() => ({ payouts: [] })),
        ])
        setBalance(balanceResult.balance)
        setPayoutHistory(payoutsResult.payouts)
      }
    } catch (err: any) {
      console.error('Failed to load payment data:', err)
      // Don't show error for unconnected accounts
      if (err?.status !== 404) {
        setError(err?.error || 'Failed to load payment data')
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleConnectStripe() {
    setConnecting(true)
    setError(null)

    try {
      const result = await api.stripe.connect()

      if (result.error) {
        setError(result.error)
        if (result.suggestion) {
          setError(`${result.error}. ${result.suggestion}`)
        }
      } else if (result.onboardingUrl) {
        window.location.href = result.onboardingUrl
      } else if (result.alreadyOnboarded) {
        // Refresh status
        loadPaymentData()
      }
    } catch (err: any) {
      setError(err?.error || 'Failed to connect Stripe')
    } finally {
      setConnecting(false)
    }
  }

  if (loading) {
    return (
      <div className="payment-settings-page">
        <header className="payment-settings-header">
          <Pressable className="back-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={20} />
          </Pressable>
          <span className="payment-settings-title">Payment Settings</span>
          <div className="header-spacer" />
        </header>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
          <Loader2 size={32} className="spin" />
        </div>
      </div>
    )
  }

  // Show connect screen if not connected
  if (!stripeStatus?.connected || stripeStatus.status === 'not_connected') {
    return (
      <div className="payment-settings-page">
        <header className="payment-settings-header">
          <Pressable className="back-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={20} />
          </Pressable>
          <span className="payment-settings-title">Payment Settings</span>
          <div className="header-spacer" />
        </header>

        <div className="payment-settings-content">
          <section className="connect-card" style={{
            textAlign: 'center',
            padding: '32px 24px',
            background: 'var(--surface)',
            borderRadius: 16,
            marginBottom: 16,
          }}>
            <div style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #635bff, #7c3aed)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <CreditCard size={28} color="white" />
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Connect Payments</h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
              Connect your Stripe account to start accepting payments and receiving payouts.
            </p>

            {error && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 16px',
                background: 'rgba(239, 68, 68, 0.1)',
                borderRadius: 12,
                marginBottom: 16,
                textAlign: 'left',
              }}>
                <AlertCircle size={18} color="var(--error)" />
                <span style={{ fontSize: 14, color: 'var(--error)' }}>{error}</span>
              </div>
            )}

            <Pressable
              className="connect-btn"
              onClick={handleConnectStripe}
              disabled={connecting}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: '100%',
                padding: '14px 24px',
                background: 'linear-gradient(135deg, #635bff, #7c3aed)',
                color: 'white',
                borderRadius: 12,
                fontWeight: 600,
                fontSize: 16,
              }}
            >
              {connecting ? (
                <>
                  <Loader2 size={18} className="spin" />
                  Connecting...
                </>
              ) : (
                <>
                  Connect with Stripe
                  <ExternalLink size={16} />
                </>
              )}
            </Pressable>
          </section>

          <p style={{ fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center', padding: '0 16px' }}>
            Stripe is available in 40+ countries. We handle all payment processing and security.
          </p>
        </div>
      </div>
    )
  }

  // Show pending status
  if (stripeStatus.status === 'pending' || stripeStatus.status === 'restricted') {
    return (
      <div className="payment-settings-page">
        <header className="payment-settings-header">
          <Pressable className="back-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={20} />
          </Pressable>
          <span className="payment-settings-title">Payment Settings</span>
          <div className="header-spacer" />
        </header>

        <div className="payment-settings-content">
          <section className="status-card" style={{
            textAlign: 'center',
            padding: '32px 24px',
            background: 'var(--surface)',
            borderRadius: 16,
          }}>
            <AlertCircle size={48} color="var(--warning)" style={{ marginBottom: 16 }} />
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
              {stripeStatus.status === 'pending' ? 'Verification Pending' : 'Action Required'}
            </h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
              {stripeStatus.status === 'pending'
                ? 'Your account is being verified. This usually takes a few minutes.'
                : 'Additional information is required to complete your account setup.'}
            </p>

            <Pressable
              className="action-btn"
              onClick={async () => {
                try {
                  const result = await api.stripe.refreshOnboarding()
                  if (result.onboardingUrl) {
                    window.location.href = result.onboardingUrl
                  }
                } catch (err) {
                  setError('Failed to get onboarding link')
                }
              }}
              style={{
                padding: '12px 24px',
                background: 'var(--primary)',
                color: 'white',
                borderRadius: 12,
                fontWeight: 600,
              }}
            >
              {stripeStatus.status === 'pending' ? 'Check Status' : 'Complete Setup'}
            </Pressable>
          </section>
        </div>
      </div>
    )
  }

  // Full dashboard for connected accounts
  return (
    <div className="payment-settings-page">
      {/* Header */}
      <header className="payment-settings-header">
        <Pressable className="back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </Pressable>
        <span className="payment-settings-title">Payment Settings</span>
        <div className="header-spacer" />
      </header>

      <div className="payment-settings-content">
        {/* Balance Card */}
        <section className="balance-card">
          <div className="balance-row">
            <div className="balance-item">
              <span className="balance-label">Available</span>
              <span className="balance-value">${(balance.available / 100).toFixed(2)}</span>
            </div>
            <div className="balance-item">
              <span className="balance-label">Pending</span>
              <span className="balance-value pending">${(balance.pending / 100).toFixed(2)}</span>
            </div>
          </div>
          <Pressable className="cashout-btn">
            Cash Out
          </Pressable>
        </section>

        {/* Connected Status */}
        <section className="settings-section">
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 16px',
            background: 'rgba(34, 197, 94, 0.1)',
            borderRadius: 12,
          }}>
            <Check size={18} color="var(--success)" />
            <span style={{ fontSize: 14, color: 'var(--success)' }}>
              Stripe connected and active
            </span>
          </div>
        </section>

        {/* Payout Method */}
        <section className="settings-section">
          <h3 className="section-title">Payout Method</h3>
          <div className="method-card">
            <Pressable className="method-row">
              <div className="method-icon">
                <Building2 size={20} />
              </div>
              <div className="method-info">
                <span className="method-name">Chase Bank</span>
                <span className="method-detail">••••4521 · Checking</span>
              </div>
              <div className="method-default">
                <Check size={16} />
              </div>
            </Pressable>
          </div>
          <Pressable className="add-method-btn">
            <Plus size={18} />
            <span>Add Payment Method</span>
          </Pressable>
        </section>

        {/* Payout Schedule */}
        <section className="settings-section">
          <h3 className="section-title">Payout Schedule</h3>
          <div className="schedule-card">
            {payoutSchedules.map((schedule) => (
              <Pressable
                key={schedule.id}
                className={`schedule-row ${payoutSchedule === schedule.id ? 'selected' : ''}`}
                onClick={() => setPayoutSchedule(schedule.id)}
              >
                <div className="schedule-info">
                  <span className="schedule-label">{schedule.label}</span>
                  <span className="schedule-desc">{schedule.desc}</span>
                </div>
                {payoutSchedule === schedule.id && (
                  <div className="schedule-check">
                    <Check size={16} />
                  </div>
                )}
              </Pressable>
            ))}
          </div>
        </section>

        {/* Payout History */}
        <section className="settings-section">
          <h3 className="section-title">Payout History</h3>
          <div className="history-card">
            {payoutHistory.length === 0 ? (
              <p style={{ padding: '16px', color: 'var(--text-tertiary)', textAlign: 'center', fontSize: 14 }}>
                No payouts yet
              </p>
            ) : (
              payoutHistory.map((payout) => (
                <Pressable key={payout.id} className="history-row">
                  <div className="history-info">
                    <span className="history-amount">
                      ${(payout.amount / 100).toFixed(2)} {payout.currency?.toUpperCase()}
                    </span>
                    <span className="history-date">
                      {new Date(payout.arrivalDate).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                  <span className={`history-status ${payout.status}`}>{payout.status}</span>
                </Pressable>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
