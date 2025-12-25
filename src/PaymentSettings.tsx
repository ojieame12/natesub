import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Building2, Check, CreditCard, ExternalLink, History, Loader2, RefreshCw, TriangleAlert, Zap, Clock, TrendingUp } from 'lucide-react'
import { InlineError, Pressable, Skeleton, SwiftCodeLookup } from './components'
import { api } from './api'
import type { PaystackConnectionStatus } from './api/client'
import { useProfile } from './api/hooks'
import { formatCurrencyFromCents } from './utils/currency'
import { needsSwiftCodeHelp } from './utils/swiftCodes'
import './PaymentSettings.css'

type StripeStatus = Awaited<ReturnType<typeof api.stripe.getStatus>>

const STRIPE_ONBOARDING_RETURN_MAX_AGE_MS = 30 * 60 * 1000

// Helper to format payout schedule for display
function formatPayoutSchedule(schedule: {
  interval: string
  delayDays: number
  weeklyAnchor: string | null
  monthlyAnchor: number | null
} | undefined): { intervalText: string; delayText: string; availableDate: string } {
  if (!schedule) {
    return { intervalText: 'Daily', delayText: '2 business days', availableDate: '' }
  }

  // Format interval
  let intervalText = 'Daily'
  if (schedule.interval === 'weekly' && schedule.weeklyAnchor) {
    const day = schedule.weeklyAnchor.charAt(0).toUpperCase() + schedule.weeklyAnchor.slice(1)
    intervalText = `Weekly (${day}s)`
  } else if (schedule.interval === 'monthly' && schedule.monthlyAnchor) {
    intervalText = `Monthly (${schedule.monthlyAnchor}${getOrdinalSuffix(schedule.monthlyAnchor)})`
  } else if (schedule.interval === 'manual') {
    intervalText = 'Manual'
  }

  // Format delay - T+1 is "1 business day", T+2 is "2 business days"
  const days = schedule.delayDays || 2
  const delayText = days === 1 ? '1 business day' : `${days} business days`

  // Calculate when today's payments become available
  const today = new Date()
  const availableDate = addBusinessDays(today, days)
  const availableDateText = availableDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })

  return { intervalText, delayText, availableDate: availableDateText }
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return s[(v - 20) % 10] || s[v] || s[0]
}

function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date)
  let added = 0
  while (added < days) {
    result.setDate(result.getDate() + 1)
    const dayOfWeek = result.getDay()
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      added++
    }
  }
  return result
}

function getErrorMessage(err: unknown): string {
  const anyErr = err as any
  return anyErr?.error || anyErr?.message || 'Something went wrong. Please try again.'
}

// Format Stripe requirement keys into readable text (matches StripeComplete)
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

function getLocationReturnTo(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null
  const maybeReturnTo = (state as any).returnTo
  if (typeof maybeReturnTo !== 'string') return null
  // Only allow internal paths
  if (!maybeReturnTo.startsWith('/')) return null
  return maybeReturnTo
}

export default function PaymentSettings() {
  const navigate = useNavigate()
  const location = useLocation()
  const { data: profileData } = useProfile()
  const isMountedRef = useRef(true)

  const defaultProvider = profileData?.profile?.paymentProvider || null
  const userCountryCode = profileData?.profile?.countryCode || null

  const returnTo = useMemo(() => getLocationReturnTo(location.state), [location.state])

  const [loading, setLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [stripeStatus, setStripeStatus] = useState<StripeStatus | null>(null)
  const [paystackStatus, setPaystackStatus] = useState<PaystackConnectionStatus | null>(null)

  const [stripeBalance, setStripeBalance] = useState<{
    available: number;
    pending: number;
    currency?: string;
    nextPayoutDate?: string | null;
    nextPayoutAmount?: number | null;
  } | null>(null)
  const [stripeBalanceLoading, setStripeBalanceLoading] = useState(false)

  const [stripeError, setStripeError] = useState<string | null>(null)
  const [paystackError, setPaystackError] = useState<string | null>(null)

  const [stripeConnecting, setStripeConnecting] = useState(false)
  const [stripeFixing, setStripeFixing] = useState(false)
  const [stripeRefreshing, setStripeRefreshing] = useState(false)
  const [stripeOpeningDashboard, setStripeOpeningDashboard] = useState(false)
  const [showSwiftLookup, setShowSwiftLookup] = useState(false)
  const [pendingStripeUrl, setPendingStripeUrl] = useState<string | null>(null)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const redirectIfStripeReturnedHere = useCallback((): boolean => {
    // Stripe return is a full page reload; if RETURN_URL is misconfigured to /settings/payments,
    // redirect immediately to the dedicated completion handler for a reliable post-onboarding boot.
    const onboardingSource = sessionStorage.getItem('stripe_onboarding_source')
    const startedAtMs = Number.parseInt(sessionStorage.getItem('stripe_onboarding_started_at') || '', 10)
    const isRecent =
      Boolean(onboardingSource) &&
      Number.isFinite(startedAtMs) &&
      (Date.now() - startedAtMs) < STRIPE_ONBOARDING_RETURN_MAX_AGE_MS

    if (isRecent) {
      navigate('/settings/payments/complete', { replace: true })
      return true
    }

    // Clear stale flags so manual visits don’t cause surprising redirects.
    if (onboardingSource) {
      const isStale = !Number.isFinite(startedAtMs) || (Date.now() - startedAtMs) >= STRIPE_ONBOARDING_RETURN_MAX_AGE_MS
      if (isStale) {
        sessionStorage.removeItem('stripe_onboarding_source')
        sessionStorage.removeItem('stripe_onboarding_started_at')
      }
    }

    return false
  }, [navigate])

  const fetchStripeBalance = useCallback(async () => {
    setStripeBalanceLoading(true)
    try {
      const result = await api.stripe.getBalance()
      if (!isMountedRef.current) return
      setStripeBalance(result.balance)
    } catch (err) {
      if (!isMountedRef.current) return
      setStripeError((prev) => prev || getErrorMessage(err))
    } finally {
      if (isMountedRef.current) setStripeBalanceLoading(false)
    }
  }, [])

  const loadPaymentData = useCallback(async (isManualRefresh = false) => {
    if (redirectIfStripeReturnedHere()) return

    // Only show full skeleton on initial load, not manual refresh
    if (isManualRefresh) {
      setIsRefreshing(true)
    } else {
      setLoading(true)
    }
    setStripeError(null)
    setPaystackError(null)
    // Don't clear balance on refresh - keep showing stale data
    if (!isManualRefresh) {
      setStripeBalance(null)
    }

    const [stripeResult, paystackResult] = await Promise.allSettled([
      api.stripe.getStatus({ quick: true, refresh: false }),
      api.paystack.getStatus(),
    ])

    if (!isMountedRef.current) return

    if (stripeResult.status === 'fulfilled') {
      setStripeStatus(stripeResult.value)
      if (stripeResult.value.connected && stripeResult.value.status === 'active') {
        // Balance is helpful, but keep the page responsive by fetching it separately.
        void fetchStripeBalance()
      }
    } else {
      setStripeStatus({ connected: false, status: 'not_started' } as StripeStatus)
      const errorMsg = getErrorMessage(stripeResult.reason)
      // Suppress "not supported" errors for users in unsupported regions (e.g. NG)
      // since they likely use Paystack instead.
      if (!errorMsg.toLowerCase().includes('not currently supported')) {
        setStripeError(errorMsg)
      }
    }

    if (paystackResult.status === 'fulfilled') {
      setPaystackStatus(paystackResult.value)
    } else {
      setPaystackStatus({ connected: false, status: 'not_started' })
      setPaystackError(getErrorMessage(paystackResult.reason))
    }

    setLoading(false)
    setIsRefreshing(false)
  }, [fetchStripeBalance, redirectIfStripeReturnedHere])

  useEffect(() => {
    void loadPaymentData()
  }, [loadPaymentData])

  const handleBack = useCallback(() => {
    if (returnTo) {
      navigate(returnTo)
      return
    }

    if (window.history.length > 1) {
      navigate(-1)
      return
    }

    navigate('/dashboard')
  }, [navigate, returnTo])

  const handleConnectStripe = useCallback(async () => {
    setStripeConnecting(true)
    setStripeError(null)

    try {
      const result = await api.stripe.connect()

      if (result.error) {
        setStripeError(result.suggestion ? `${result.error}. ${result.suggestion}` : result.error)
        return
      }

      if (result.onboardingUrl) {
        // Set sessionStorage only after successful API call, before redirect
        // Always return to payment settings after Stripe onboarding from settings
        sessionStorage.setItem('stripe_return_to', returnTo || '/settings/payments')
        sessionStorage.setItem('stripe_onboarding_source', 'settings')
        sessionStorage.setItem('stripe_onboarding_started_at', Date.now().toString())

        // For cross-border countries, show SWIFT code helper first
        if (needsSwiftCodeHelp(userCountryCode)) {
          setPendingStripeUrl(result.onboardingUrl)
          setShowSwiftLookup(true)
          return
        }

        window.location.href = result.onboardingUrl
        return
      }

      if (result.alreadyOnboarded) {
        void loadPaymentData()
      }
    } catch (err) {
      const errorMsg = getErrorMessage(err)
      if (!errorMsg.toLowerCase().includes('not currently supported')) {
        setStripeError(errorMsg)
      }
    } finally {
      if (isMountedRef.current) setStripeConnecting(false)
    }
  }, [loadPaymentData, returnTo, userCountryCode])

  const handleSwiftLookupContinue = useCallback(() => {
    if (pendingStripeUrl) {
      window.location.href = pendingStripeUrl
    }
  }, [pendingStripeUrl])

  const handleSwiftLookupClose = useCallback(() => {
    setShowSwiftLookup(false)
    setPendingStripeUrl(null)
    setStripeConnecting(false)
  }, [])

  const handleFixStripe = useCallback(async () => {
    setStripeFixing(true)
    setStripeError(null)

    try {
      const result = await api.stripe.refreshOnboarding()
      if (result.onboardingUrl) {
        // Set sessionStorage only after successful API call, before redirect
        if (returnTo) sessionStorage.setItem('stripe_return_to', returnTo)
        sessionStorage.setItem('stripe_onboarding_source', 'settings')
        sessionStorage.setItem('stripe_onboarding_started_at', Date.now().toString())

        // For cross-border countries, show SWIFT code helper first
        if (needsSwiftCodeHelp(userCountryCode)) {
          setPendingStripeUrl(result.onboardingUrl)
          setShowSwiftLookup(true)
          return
        }

        window.location.href = result.onboardingUrl
      } else {
        setStripeError('Unable to get onboarding link. Please try again.')
      }
    } catch (err) {
      setStripeError(getErrorMessage(err))
    } finally {
      if (isMountedRef.current) setStripeFixing(false)
    }
  }, [returnTo, userCountryCode])

  const handleRefreshStripeStatus = useCallback(async () => {
    setStripeRefreshing(true)
    setStripeError(null)

    try {
      const result = await api.stripe.getStatus({ quick: true, refresh: true })
      if (!isMountedRef.current) return
      setStripeStatus(result)
      if (result.connected && result.status === 'active') {
        void fetchStripeBalance()
      }
    } catch (err) {
      if (!isMountedRef.current) return
      setStripeError(getErrorMessage(err))
    } finally {
      if (isMountedRef.current) setStripeRefreshing(false)
    }
  }, [fetchStripeBalance])

  const handleOpenStripeDashboard = useCallback(async () => {
    setStripeOpeningDashboard(true)
    setStripeError(null)

    try {
      const result = await api.stripe.getDashboardLink()
      if (!result?.url) {
        throw new Error('No dashboard URL returned')
      }
      // Navigate in same window - Stripe requires 2FA verification anyway
      window.location.href = result.url
    } catch (err) {
      if (isMountedRef.current) {
        setStripeError(getErrorMessage(err))
        setStripeOpeningDashboard(false)
      }
    }
    // Don't reset loading state - we're navigating away
  }, [])

  const stripeIsConnected = stripeStatus?.connected === true
  const stripeIsActive = stripeIsConnected && stripeStatus?.status === 'active'
  const stripeIsRestricted = stripeIsConnected && stripeStatus?.status === 'restricted'
  const stripeIsPending = stripeIsConnected && stripeStatus?.status === 'pending'

  const paystackIsConnected = paystackStatus?.connected === true
  const paystackIsActive = paystackIsConnected && paystackStatus?.status === 'active'
  const paystackIsInactive = paystackIsConnected && paystackStatus?.status === 'inactive'

  const stripeRequirements = stripeStatus?.details?.requirements?.currentlyDue || []

  if (loading) {
    return (
      <div className="payment-settings-page">
        <header className="payment-settings-header">
          <Pressable className="back-btn" onClick={handleBack}>
            <ArrowLeft size={20} />
          </Pressable>
          <div className="payment-settings-title">Payments</div>
          <div className="header-spacer" />
        </header>

        <div className="payment-settings-content">
          <section className="settings-section">
            <Skeleton height={110} borderRadius="var(--radius-xl)" />
          </section>
          <section className="settings-section">
            <Skeleton height={92} borderRadius="var(--radius-xl)" />
            <Skeleton height={92} borderRadius="var(--radius-xl)" />
          </section>
        </div>
      </div>
    )
  }

  return (
    <div className="payment-settings-page">
      <header className="payment-settings-header">
        <Pressable className="back-btn" onClick={handleBack}>
          <ArrowLeft size={20} />
        </Pressable>
        <div className="payment-settings-title">Payments</div>
        <Pressable className="back-btn" onClick={() => loadPaymentData(true)} disabled={loading || isRefreshing}>
          <RefreshCw size={20} className={isRefreshing ? 'spin' : ''} />
        </Pressable>
      </header>

      <div className="payment-settings-content">
        {/* Stripe Balance */}
        {stripeIsActive && (
          <section className="balance-card">
            <div className="balance-row">
              <div className="balance-item">
                <div className="balance-label">Available</div>
                <div className="balance-value">
                  {stripeBalanceLoading ? '…' : formatCurrencyFromCents(stripeBalance?.available || 0, stripeBalance?.currency || 'USD')}
                </div>
              </div>
              <div className="balance-item">
                <div className="balance-label">Pending</div>
                <div className="balance-value pending">
                  {stripeBalanceLoading ? '…' : formatCurrencyFromCents(stripeBalance?.pending || 0, stripeBalance?.currency || 'USD')}
                </div>
              </div>
            </div>

            {/* Payout Schedule Info */}
            {stripeStatus?.details?.payoutSchedule && (
              <div className="payout-schedule-info">
                {(() => {
                  const schedule = formatPayoutSchedule(stripeStatus.details.payoutSchedule)
                  const delayDays = stripeStatus.details.payoutSchedule.delayDays || 2
                  return (
                    <>
                      <div className="payout-schedule-row">
                        <Zap size={14} className="payout-schedule-icon" />
                        <span className="payout-schedule-text">
                          {schedule.intervalText} payouts
                        </span>
                        <span className="payout-schedule-separator">·</span>
                        <span className="payout-schedule-delay">
                          {schedule.delayText} to settle
                        </span>
                      </div>
                      {schedule.availableDate && (
                        <div className="payout-schedule-estimate">
                          <Clock size={12} />
                          <span>Today's payments available {schedule.availableDate}</span>
                        </div>
                      )}
                      {delayDays > 1 && (
                        <div className="payout-schedule-note">
                          <TrendingUp size={12} />
                          <span>Speeds up automatically as you grow</span>
                        </div>
                      )}
                    </>
                  )
                })()}
              </div>
            )}

            {/* Next payout estimate */}
            {stripeBalance?.nextPayoutDate && stripeBalance?.pending > 0 && (
              <div className="payout-estimate">
                <span className="payout-estimate-label">Next payout</span>
                <span className="payout-estimate-date">
                  {new Date(stripeBalance.nextPayoutDate).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
            )}

            <div className="balance-actions">
              <Pressable
                className="cashout-btn"
                onClick={handleOpenStripeDashboard}
                disabled={stripeOpeningDashboard}
              >
                {stripeOpeningDashboard ? 'Opening Stripe…' : 'View Stripe Dashboard'}
              </Pressable>
              <Pressable
                className="payout-history-btn"
                onClick={() => navigate('/settings/payouts')}
              >
                <History size={16} />
                <span>Payout History</span>
              </Pressable>
            </div>
          </section>
        )}

        {/* Global (Stripe) */}
        <section className="settings-section">
          <h3 className="section-title">Global (Stripe)</h3>
          <div className="method-card">
            <div className="method-row">
              <div className="method-icon">
                <CreditCard size={20} color={stripeIsConnected ? '#635bff' : undefined} />
              </div>
              <div className="method-info">
                <span className="method-name">Stripe</span>
                <span className="method-detail">
                  {stripeIsActive
                    ? `Connected${defaultProvider === 'stripe' ? ' · Default' : ''}`
                    : stripeIsRestricted
                      ? 'Action required to receive payouts'
                      : stripeIsPending
                        ? 'Setup in progress'
                        : 'Accept global cards (USD, EUR, GBP)'}
                </span>
              </div>

              {!stripeIsConnected ? (
                <Pressable
                  className="provider-connect-btn primary"
                  onClick={handleConnectStripe}
                  disabled={stripeConnecting}
                >
                  {stripeConnecting ? (
                    <>
                      <Loader2 size={16} className="spin" />
                      <span>Connecting</span>
                    </>
                  ) : (
                    'Connect'
                  )}
                </Pressable>
              ) : (
                <div
                  className={[
                    'method-status',
                    stripeIsActive ? 'success' : stripeIsRestricted ? 'error' : 'warning',
                  ].join(' ')}
                >
                  {stripeIsActive ? <Check size={14} /> : <TriangleAlert size={14} />}
                  <span>{stripeIsActive ? 'Connected' : stripeIsRestricted ? 'Restricted' : 'Pending'}</span>
                </div>
              )}
            </div>

            {stripeIsConnected && !stripeIsActive && (
              <div className="provider-actions">
                <Pressable
                  className="provider-connect-btn primary"
                  onClick={handleFixStripe}
                  disabled={stripeFixing}
                >
                  {stripeFixing ? (
                    <>
                      <Loader2 size={16} className="spin" />
                      <span>Opening</span>
                    </>
                  ) : (
                    'Continue setup'
                  )}
                </Pressable>
                <Pressable
                  className="provider-connect-btn secondary"
                  onClick={handleRefreshStripeStatus}
                  disabled={stripeRefreshing}
                >
                  {stripeRefreshing ? (
                    <>
                      <Loader2 size={16} className="spin" />
                      <span>Checking</span>
                    </>
                  ) : (
                    'Refresh status'
                  )}
                </Pressable>
              </div>
            )}

            {stripeIsActive && (
              <div className="provider-actions">
                <Pressable
                  className="provider-connect-btn secondary"
                  onClick={handleRefreshStripeStatus}
                  disabled={stripeRefreshing}
                >
                  {stripeRefreshing ? (
                    <>
                      <Loader2 size={16} className="spin" />
                      <span>Checking</span>
                    </>
                  ) : (
                    'Refresh status'
                  )}
                </Pressable>
                <Pressable className="provider-link" onClick={handleOpenStripeDashboard} disabled={stripeOpeningDashboard}>
                  <span>Stripe Dashboard</span>
                  <ExternalLink size={14} />
                </Pressable>
              </div>
            )}

            {stripeIsRestricted && stripeRequirements.length > 0 && (
              <div className="provider-requirements">
                <div className="provider-requirements-title">Needed to finish setup</div>
                <ul className="provider-requirements-list">
                  {stripeRequirements.slice(0, 6).map((req) => (
                    <li key={req}>{formatRequirement(req)}</li>
                  ))}
                </ul>
                {stripeRequirements.length > 6 && (
                  <div className="provider-requirements-more">+{stripeRequirements.length - 6} more</div>
                )}
              </div>
            )}

            {stripeError && <InlineError message={stripeError} className="provider-inline-error" />}
          </div>
        </section>

        {/* Africa (Paystack) */}
        <section className="settings-section">
          <h3 className="section-title">Africa (Paystack)</h3>
          <div className="method-card">
            <div className="method-row">
              <div className="method-icon">
                <Building2 size={20} color={paystackIsConnected ? '#0AA5C2' : undefined} />
              </div>
              <div className="method-info">
                <span className="method-name">Paystack</span>
                <span className="method-detail">
                  {paystackIsActive
                    ? `Connected${defaultProvider === 'paystack' ? ' · Default' : ''}`
                    : paystackIsInactive
                      ? 'Inactive subaccount (contact support)'
                      : 'Accept local cards (NGN, KES, ZAR)'}
                </span>
              </div>

              {!paystackIsConnected ? (
                <Pressable
                  className="provider-connect-btn secondary"
                  onClick={() => navigate('/onboarding/paystack')}
                >
                  Connect
                </Pressable>
              ) : (
                <div className={['method-status', paystackIsActive ? 'success' : 'warning'].join(' ')}>
                  {paystackIsActive ? <Check size={14} /> : <TriangleAlert size={14} />}
                  <span>{paystackIsActive ? 'Connected' : 'Inactive'}</span>
                </div>
              )}
            </div>

            {paystackIsConnected && paystackStatus?.details && (
              <div className="provider-details">
                <div className="provider-details-row">
                  <span className="provider-details-label">Bank</span>
                  <span className="provider-details-value">{paystackStatus.details.bank}</span>
                </div>
                <div className="provider-details-row">
                  <span className="provider-details-label">Account</span>
                  <span className="provider-details-value">{paystackStatus.details.accountNumber || '****'}</span>
                </div>
                {paystackStatus.details.accountName && (
                  <div className="provider-details-row">
                    <span className="provider-details-label">Name</span>
                    <span className="provider-details-value">{paystackStatus.details.accountName}</span>
                  </div>
                )}
                {typeof paystackStatus.details.percentageCharge === 'number' && (
                  <div className="provider-details-row">
                    <span className="provider-details-label">Paystack fee</span>
                    <span className="provider-details-value">{paystackStatus.details.percentageCharge}%</span>
                  </div>
                )}
              </div>
            )}

            {paystackError && <InlineError message={paystackError} className="provider-inline-error" />}
          </div>
        </section>
      </div>

      {/* SWIFT Code Lookup Modal for cross-border countries */}
      {showSwiftLookup && userCountryCode && (
        <SwiftCodeLookup
          countryCode={userCountryCode}
          onContinue={handleSwiftLookupContinue}
          onClose={handleSwiftLookupClose}
        />
      )}
    </div>
  )
}
