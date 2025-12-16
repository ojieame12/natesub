import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Building2, Check, Loader2, AlertCircle, CreditCard, ExternalLink } from 'lucide-react'
import { Pressable } from './components'
import { Skeleton } from './components/Skeleton'
import { api } from './api'
import type { PaystackConnectionStatus } from './api/client'
import { useProfile } from './api/hooks'
import { getCurrencySymbol, formatNumberWithSeparators } from './utils/currency'
import { setPaymentConfirmed } from './utils/paymentConfirmed'
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
  const location = useLocation()
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [completingSetup, setCompletingSetup] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Get profile to know which provider they use
  const { data: profileData } = useProfile()
  const paymentProvider = profileData?.profile?.paymentProvider
  const currencySymbol = getCurrencySymbol(profileData?.profile?.currency || 'USD')

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
    // AbortController to prevent race conditions when paymentProvider changes
    // or component unmounts while API calls are in flight
    const abortController = new AbortController()
    let isCancelled = false

    async function loadPaymentData() {
      setLoading(true)
      setError(null)

      try {
        // Check status based on payment provider
        if (paymentProvider === 'paystack') {
          const status = await api.paystack.getStatus()
          // Check if request was cancelled before updating state
          if (isCancelled) return
          setPaystackStatus(status)
        } else {
          // Default to Stripe
          const status = await api.stripe.getStatus()
          // Check if request was cancelled before updating state
          if (isCancelled) return
          setStripeStatus(status)

          // If Stripe returned us here (misconfigured return_url), redirect to the intended destination.
          const onboardingSource = sessionStorage.getItem('stripe_onboarding_source')
          const startedAtMs = Number.parseInt(sessionStorage.getItem('stripe_onboarding_started_at') || '', 10)
          const isRecentOnboardingReturn = Boolean(onboardingSource) && Number.isFinite(startedAtMs) && (Date.now() - startedAtMs) < 30 * 60 * 1000

          if (isRecentOnboardingReturn) {
            // If we land here, it means the Env var is misconfigured (pointing to Settings instead of Complete).
            // Forward immediately to StripeComplete to handle verification, polling, and final direction.
            navigate('/settings/payments/complete', { replace: true })
            return
          }

          // Clear stale onboarding flags (>30m old) to avoid surprising redirects
          if (onboardingSource && (!Number.isFinite(startedAtMs) || (Date.now() - startedAtMs) >= 30 * 60 * 1000)) {
            sessionStorage.removeItem('stripe_onboarding_source')
            sessionStorage.removeItem('stripe_onboarding_started_at')
          }

          if (status.connected && status.status === 'active') {
            // Fetch balance and payouts
            const [balanceResult, payoutsResult] = await Promise.all([
              api.stripe.getBalance().catch(() => ({ balance: { available: 0, pending: 0 } })),
              api.stripe.getPayouts().catch(() => ({ payouts: [] })),
            ])
            // Check again before updating state
            if (isCancelled) return
            setBalance(balanceResult.balance)
            setPayoutHistory(payoutsResult.payouts)
          }
        }
      } catch (err: any) {
        // Don't update state if cancelled
        if (isCancelled) return
        console.error('Failed to load payment data:', err)
        // Don't show error for unconnected accounts
        if (err?.status !== 404) {
          setError(err?.error || 'Failed to load payment data')
        }
      } finally {
        // Don't update state if cancelled
        if (!isCancelled) {
          setLoading(false)
        }
      }
    }

    loadPaymentData()

    // Cleanup: cancel pending operations when effect re-runs or component unmounts
    return () => {
      isCancelled = true
      abortController.abort()
    }
  }, [paymentProvider])

  async function handleConnectStripe() {
    // Persist return URL for post-Stripe redirection
    const returnTo = (location.state as any)?.returnTo
    if (returnTo) {
      sessionStorage.setItem('stripe_return_to', returnTo)
    }
    sessionStorage.setItem('stripe_onboarding_started_at', Date.now().toString())

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
        // Store source for redirect handling when user returns from Stripe
        sessionStorage.setItem('stripe_onboarding_source', 'settings')
        window.location.href = result.onboardingUrl
      } else if (result.alreadyOnboarded) {
        // Refresh status by reloading
        window.location.reload()
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
          <img src="/logo.svg" alt="NatePay" className="header-logo" />
          <div className="header-spacer" />
        </header>
        <div className="payment-settings-content">
          {/* Balance Card Skeleton */}
          <section className="balance-card" style={{ opacity: 0.6 }}>
            <div className="balance-row">
              <div className="balance-item">
                <Skeleton width={60} height={14} borderRadius="var(--radius-sm)" />
                <Skeleton width={100} height={28} borderRadius="var(--radius-sm)" style={{ marginTop: 4 }} />
              </div>
              <div className="balance-item">
                <Skeleton width={60} height={14} borderRadius="var(--radius-sm)" />
                <Skeleton width={80} height={28} borderRadius="var(--radius-sm)" style={{ marginTop: 4 }} />
              </div>
            </div>
            <Skeleton height={44} borderRadius="var(--radius-md)" style={{ marginTop: 16 }} />
          </section>

          {/* Status Skeleton */}
          <section className="settings-section">
            <Skeleton height={48} borderRadius="var(--radius-md)" />
          </section>

          {/* Payout Method Skeleton */}
          <section className="settings-section">
            <Skeleton width={120} height={16} borderRadius="var(--radius-sm)" style={{ marginBottom: 12 }} />
            <Skeleton height={72} borderRadius="var(--radius-lg)" />
          </section>

          {/* Payout Schedule Skeleton */}
          <section className="settings-section">
            <Skeleton width={140} height={16} borderRadius="var(--radius-sm)" style={{ marginBottom: 12 }} />
            <Skeleton height={200} borderRadius="var(--radius-lg)" />
          </section>
        </div>
      </div>
    )
  }

  // Show Paystack not connected or inactive
  if (paymentProvider === 'paystack' && (!paystackStatus?.connected || paystackStatus.status === 'not_started' || paystackStatus.status === 'inactive')) {
    const isInactive = paystackStatus?.status === 'inactive'
    return (
      <div className="payment-settings-page">
        <header className="payment-settings-header">
          <Pressable className="back-btn" onClick={() => navigate(-1)}>
            <ArrowLeft size={20} />
          </Pressable>
          <img src="/logo.svg" alt="NatePay" className="header-logo" />
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
              background: isInactive ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'linear-gradient(135deg, #00C3F7, #0AA5C2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              {isInactive ? <AlertCircle size={28} color="white" /> : <Building2 size={28} color="white" />}
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
              {isInactive ? 'Account Inactive' : 'Connect Payment Method'}
            </h2>
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
              {isInactive
                ? 'Your payment account has been deactivated. Please reconnect to receive payments.'
                : 'Connect your bank or mobile money via Paystack to receive payments.'}
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
              onClick={() => navigate('/onboarding/paystack')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: '100%',
                padding: '14px 24px',
                background: 'linear-gradient(135deg, #00C3F7, #0AA5C2)',
                color: 'white',
                borderRadius: 12,
                fontWeight: 600,
                fontSize: 16,
              }}
            >
              {isInactive ? 'Reconnect Payment Method' : 'Connect Payment Method'}
            </Pressable>
          </section>

          <p style={{ fontSize: 13, color: 'var(--text-tertiary)', textAlign: 'center', padding: '0 16px' }}>
            Paystack supports banks and mobile money in Nigeria, Kenya, and South Africa.
          </p>
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
          <img src="/logo.svg" alt="NatePay" className="header-logo" />
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
                When you receive a payment, we'll transfer your earnings to your bank account. Transfer times vary by country:
              </p>
              <ul style={{ fontSize: 13, color: 'var(--text-tertiary)', paddingLeft: 20, margin: 0 }}>
                <li>Nigeria: Same day or next business day</li>
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
          <Pressable className="back-btn" onClick={() => navigate('/dashboard')}>
            <ArrowLeft size={20} />
          </Pressable>
          <img src="/logo.svg" alt="NatePay" className="header-logo" />
          <div className="header-spacer" />
        </header>

        <div className="payment-settings-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', padding: '24px' }}>
          <div style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #1a1a1a, #2d2d2d)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 24,
          }}>
            <CreditCard size={28} color="white" />
          </div>

          <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8, textAlign: 'center' }}>
            Connect to start receiving payments
          </h2>

          <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 32, textAlign: 'center' }}>
            Stripe is available in 40+ countries. We handle all payment processing and security.
          </p>

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
              maxWidth: 320,
              padding: '16px 24px',
              background: 'linear-gradient(135deg, #1a1a1a, #2d2d2d)',
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
          <img src="/logo.svg" alt="NatePay" className="header-logo" />
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

            {/* Error message */}
            {error && (
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
                <span style={{ fontSize: 14, color: 'var(--error)' }}>{error}</span>
              </div>
            )}

            <Pressable
              className="action-btn"
              onClick={async () => {
                setCompletingSetup(true)
                setError(null)
                try {
                  // Pending usually means Stripe is verifying identity; don't bounce them back to Stripe.
                  // Instead, force-refresh status from Stripe.
                  if (stripeStatus.status === 'pending') {
                    const refreshed = await api.stripe.getStatus({ refresh: true })
                    setStripeStatus(refreshed)

                    if (refreshed.connected && refreshed.status === 'active') {
                      // Prevent AuthRedirect bounce while webhooks catch up
                      setPaymentConfirmed()

                      // Optimistically update caches (same approach as StripeComplete)
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

                      const [balanceResult, payoutsResult] = await Promise.all([
                        api.stripe.getBalance().catch(() => ({ balance: { available: 0, pending: 0 } })),
                        api.stripe.getPayouts().catch(() => ({ payouts: [] })),
                      ])
                      setBalance(balanceResult.balance)
                      setPayoutHistory(payoutsResult.payouts)
                    }

                    return
                  }

                  const result = await api.stripe.refreshOnboarding()
                  if (result.onboardingUrl) {
                    // Store source for redirect handling when user returns from Stripe
                    sessionStorage.setItem('stripe_onboarding_source', 'settings')
                    sessionStorage.setItem('stripe_onboarding_started_at', Date.now().toString())
                    window.location.href = result.onboardingUrl
                    return
                  }

                  setError('Unable to get onboarding link. Please try again.')
                } catch (err: any) {
                  setError(
                    err?.error || (stripeStatus.status === 'pending'
                      ? 'Failed to refresh Stripe status'
                      : 'Failed to get onboarding link')
                  )
                } finally {
                  setCompletingSetup(false)
                }
              }}
              disabled={completingSetup}
              style={{
                padding: '12px 24px',
                background: 'var(--primary)',
                color: 'white',
                borderRadius: 12,
                fontWeight: 600,
                opacity: completingSetup ? 0.7 : 1,
              }}
            >
              {completingSetup ? (
                <>
                  <Loader2 size={18} className="spin" style={{ marginRight: 8, display: 'inline' }} />
                  {stripeStatus.status === 'pending' ? 'Checking...' : 'Connecting...'}
                </>
              ) : (
                stripeStatus.status === 'pending' ? 'Check Status' : 'Complete Setup'
              )}
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
        <img src="/logo.svg" alt="NatePay" className="header-logo" />
        <div className="header-spacer" />
      </header>

      <div className="payment-settings-content">
        {/* Balance Card */}
        <section className="balance-card">
          <div className="balance-row">
            <div className="balance-item">
              <span className="balance-label">Available</span>
              <span className="balance-value">{currencySymbol}{formatNumberWithSeparators(balance.available / 100, true)}</span>
            </div>
            <div className="balance-item">
              <span className="balance-label">Pending</span>
              <span className="balance-value pending">{currencySymbol}{formatNumberWithSeparators(balance.pending / 100, true)}</span>
            </div>
          </div>
          <Pressable
            className="cashout-btn"
            onClick={async () => {
              try {
                const result = await api.stripe.getDashboardLink()
                if (result.url) window.open(result.url, '_blank', 'noopener,noreferrer')
              } catch { }
            }}
          >
            View in Stripe
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
                    window.open(result.url, '_blank', 'noopener,noreferrer')
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
            <div className="method-row" style={{ cursor: 'default' }}>
              <div className="method-icon">
                <Building2 size={20} />
              </div>
              <div className="method-info">
                <span className="method-name">
                  {stripeStatus?.details?.bankAccount?.bankName || 'Bank Account'}
                </span>
                <span className="method-detail">
                  {stripeStatus?.details?.bankAccount?.last4
                    ? `••••${stripeStatus.details.bankAccount.last4}`
                    : 'Connected via Stripe'}
                </span>
              </div>
              <div className="method-default">
                <Check size={16} />
              </div>
            </div>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 8 }}>
            Manage bank accounts in your{' '}
            <Pressable
              onClick={async () => {
                try {
                  const result = await api.stripe.getDashboardLink()
                  if (result.url) window.open(result.url, '_blank', 'noopener,noreferrer')
                } catch { }
              }}
              style={{ color: 'var(--primary)', fontWeight: 500, display: 'inline' }}
            >
              Stripe Dashboard
            </Pressable>
          </p>
        </section>

        {/* Payout Schedule */}
        <section className="settings-section">
          <h3 className="section-title">Payout Schedule</h3>
          <div className="schedule-card">
            {payoutSchedules.map((schedule) => {
              const isSelected = stripeStatus?.details?.payoutSchedule === schedule.id
              return (
                <div
                  key={schedule.id}
                  className={`schedule-row ${isSelected ? 'selected' : ''}`}
                  style={{ cursor: 'default', opacity: isSelected ? 1 : 0.5 }}
                >
                  <div className="schedule-info">
                    <span className="schedule-label">{schedule.label}</span>
                    <span className="schedule-desc">{schedule.desc}</span>
                  </div>
                  {isSelected && (
                    <div className="schedule-check">
                      <Check size={16} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 8 }}>
            Change payout schedule in your Stripe Dashboard
          </p>
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
                <div key={payout.id} className="history-row">
                  <div className="history-info">
                    <span className="history-amount">
                      {getCurrencySymbol(payout.currency || 'USD')}{formatNumberWithSeparators(payout.amount / 100, true)}
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
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
