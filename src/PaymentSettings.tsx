import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Building2, Plus, Check, Loader2, AlertCircle, CreditCard, ExternalLink } from 'lucide-react'
import { Pressable } from './components'
import { api } from './api'
import type { PaystackConnectionStatus } from './api/client'
import { useProfile } from './api/hooks'
import './PaymentSettings.css'

const payoutSchedules = [
  { id: 'instant', label: 'Instant', desc: 'Get paid immediately (1.5% fee)' },
  { id: 'daily', label: 'Daily', desc: 'Next business day' },
  { id: 'weekly', label: 'Weekly', desc: 'Every Monday' },
  { id: 'monthly', label: 'Monthly', desc: 'First of the month' },
]

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

  // Get profile to know which provider they use
  const { data: profileData } = useProfile()
  const paymentProvider = profileData?.profile?.paymentProvider

  // Real data from API
  const [stripeStatus, setStripeStatus] = useState<{
    connected: boolean
    status: string
    details?: any
  } | null>(null)
  const [paystackStatus, setPaystackStatus] = useState<PaystackConnectionStatus | null>(null)
  const [balance, setBalance] = useState({ available: 0, pending: 0 })
  const [payoutHistory, setPayoutHistory] = useState<Payout[]>([])

  useEffect(() => {
    loadPaymentData()
  }, [paymentProvider])

  async function loadPaymentData() {
    setLoading(true)
    setError(null)

    try {
      // Check status based on payment provider
      if (paymentProvider === 'paystack') {
        const status = await api.paystack.getStatus()
        setPaystackStatus(status)
      } else {
        // Default to Stripe
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

  // Show Paystack connected account
  if (paymentProvider === 'paystack' && paystackStatus?.connected) {
    const details = paystackStatus.details
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
          {/* Connected Status */}
          <section className="settings-section">
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 16px',
              background: 'rgba(34, 197, 94, 0.1)',
              borderRadius: 12,
              marginBottom: 16,
            }}>
              <Check size={18} color="var(--success)" />
              <span style={{ fontSize: 14, color: 'var(--success)' }}>
                Paystack connected and active
              </span>
            </div>
          </section>

          {/* Bank Account Info */}
          <section className="settings-section">
            <h3 className="section-title">Connected Bank Account</h3>
            <div className="method-card">
              <div className="method-row" style={{ cursor: 'default' }}>
                <div className="method-icon">
                  <Building2 size={20} />
                </div>
                <div className="method-info">
                  <span className="method-name">{details?.bank || 'Bank Account'}</span>
                  <span className="method-detail">
                    {details?.accountNumber ? `****${details.accountNumber.slice(-4)}` : '****'}
                    {details?.accountName && ` - ${details.accountName}`}
                  </span>
                </div>
                <div className="method-default">
                  <Check size={16} />
                </div>
              </div>
            </div>
          </section>

          {/* Info about Paystack payouts */}
          <section className="settings-section">
            <div style={{
              padding: '16px',
              background: 'var(--surface)',
              borderRadius: 12,
            }}>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Paystack automatically settles funds to your bank account. Settlement times vary by country:
              </p>
              <ul style={{ fontSize: 13, color: 'var(--text-tertiary)', paddingLeft: 20, margin: 0 }}>
                <li>Nigeria: Next business day</li>
                <li>Kenya: T+1 to T+2 business days</li>
                <li>South Africa: T+2 business days</li>
              </ul>
            </div>
          </section>
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
    const requirements = stripeStatus.details?.requirements
    const hasMissingInfo = requirements?.currentlyDue?.length > 0

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
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 16 }}>
              {stripeStatus.status === 'pending'
                ? 'Your account is being verified. This usually takes a few minutes.'
                : 'Additional information is required to complete your account setup.'}
            </p>

            {/* Show missing requirements */}
            {hasMissingInfo && (
              <div style={{
                textAlign: 'left',
                padding: '12px 16px',
                background: 'var(--surface-secondary)',
                borderRadius: 12,
                marginBottom: 16,
              }}>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Missing Information:</p>
                <ul style={{ fontSize: 13, color: 'var(--text-secondary)', paddingLeft: 16, margin: 0 }}>
                  {requirements.currentlyDue.slice(0, 5).map((item: string) => (
                    <li key={item} style={{ marginBottom: 4 }}>
                      {formatRequirement(item)}
                    </li>
                  ))}
                  {requirements.currentlyDue.length > 5 && (
                    <li>And {requirements.currentlyDue.length - 5} more...</li>
                  )}
                </ul>
              </div>
            )}

            {/* Deadline warning */}
            {requirements?.currentDeadline && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                background: 'rgba(239, 68, 68, 0.1)',
                borderRadius: 8,
                marginBottom: 16,
              }}>
                <AlertCircle size={16} color="var(--error)" />
                <span style={{ fontSize: 13, color: 'var(--error)' }}>
                  Complete by {new Date(requirements.currentDeadline).toLocaleDateString()}
                </span>
              </div>
            )}

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
            justifyContent: 'space-between',
            gap: 8,
            padding: '12px 16px',
            background: 'rgba(34, 197, 94, 0.1)',
            borderRadius: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Check size={18} color="var(--success)" />
              <span style={{ fontSize: 14, color: 'var(--success)' }}>
                Stripe connected and active
              </span>
            </div>
            <Pressable
              onClick={async () => {
                try {
                  const result = await api.stripe.getDashboardLink()
                  if (result.url) {
                    window.open(result.url, '_blank')
                  }
                } catch (err) {
                  setError('Failed to open dashboard')
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 13,
                color: 'var(--primary)',
                fontWeight: 500,
              }}
            >
              Stripe Dashboard
              <ExternalLink size={14} />
            </Pressable>
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
