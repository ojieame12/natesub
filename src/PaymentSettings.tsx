import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Building2, Check, ChevronDown, CreditCard, ExternalLink, History, Info, Loader2, Lock, RefreshCw, TriangleAlert, Zap, Clock, TrendingUp, Calendar } from 'lucide-react'
import { InlineError, Pressable, Skeleton, SwiftCodeLookup, BottomDrawer } from './components'
import { api } from './api'
// PaystackConnectionStatus type - now handled by React Query
import { useProfile, useSalaryMode, useUpdateSalaryMode, useStripeStatus, usePaystackStatus, useStripeBalance } from './api/hooks'
import { useDelayedLoading } from './hooks'
import { formatCurrencyFromCents } from './utils/currency'
import { needsSwiftCodeHelp } from './utils/swiftCodes'
import { formatStripeCurrencies, formatPaystackCurrencies, isStripeCrossBorderCountry } from './utils/regionConfig'
import './PaymentSettings.css'

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

  // Use React Query hooks for payment status (benefits from prefetch + caching)
  const {
    data: stripeStatusData,
    isLoading: stripeLoading,
    error: stripeQueryError,
    refetch: refetchStripeStatus,
  } = useStripeStatus()
  const {
    data: paystackStatusData,
    isLoading: paystackLoading,
    error: paystackQueryError,
    refetch: refetchPaystackStatus,
  } = usePaystackStatus()
  const {
    data: stripeBalanceData,
    isLoading: stripeBalanceLoading,
    refetch: refetchStripeBalance,
  } = useStripeBalance()

  // Derive loading state from React Query - delay to prevent skeleton flash
  const isInitialLoading = stripeLoading || paystackLoading
  const showSkeleton = useDelayedLoading(isInitialLoading, 200)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Map React Query data to local state shape for backwards compatibility
  const stripeStatus = stripeStatusData ?? null
  const paystackStatus = paystackStatusData ?? null
  const stripeBalance = stripeBalanceData?.balance ?? null

  // Error states - suppress "not supported" errors for unsupported regions
  const [stripeError, setStripeError] = useState<string | null>(null)
  const [paystackError, setPaystackError] = useState<string | null>(null)

  // Sync query errors to local state (for display + mutation errors)
  useEffect(() => {
    if (stripeQueryError) {
      const errorMsg = getErrorMessage(stripeQueryError)
      if (!errorMsg.toLowerCase().includes('not currently supported')) {
        setStripeError(errorMsg)
      }
    }
  }, [stripeQueryError])

  useEffect(() => {
    if (paystackQueryError) {
      setPaystackError(getErrorMessage(paystackQueryError))
    }
  }, [paystackQueryError])

  const [stripeConnecting, setStripeConnecting] = useState(false)
  const [stripeFixing, setStripeFixing] = useState(false)
  const [stripeRefreshing, setStripeRefreshing] = useState(false)
  const [stripeOpeningDashboard, setStripeOpeningDashboard] = useState(false)
  const [showSwiftLookup, setShowSwiftLookup] = useState(false)
  const [pendingStripeUrl, setPendingStripeUrl] = useState<string | null>(null)

  // Salary Mode state
  const { data: salaryMode, isLoading: salaryModeLoading } = useSalaryMode()
  const updateSalaryMode = useUpdateSalaryMode()
  const [showPaydayDrawer, setShowPaydayDrawer] = useState(false)

  // Payday options (1-28)
  const PAYDAY_OPTIONS = [1, 15, 28] // Common payday options

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

  // Check for Stripe return redirect on mount
  useEffect(() => {
    redirectIfStripeReturnedHere()
  }, [redirectIfStripeReturnedHere])

  // Manual refresh handler using React Query refetch
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    setStripeError(null)
    setPaystackError(null)
    await Promise.all([
      refetchStripeStatus(),
      refetchPaystackStatus(),
      refetchStripeBalance(),
    ])
    setIsRefreshing(false)
  }, [refetchStripeStatus, refetchPaystackStatus, refetchStripeBalance])

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
        void handleRefresh()
      }
    } catch (err) {
      const errorMsg = getErrorMessage(err)
      if (!errorMsg.toLowerCase().includes('not currently supported')) {
        setStripeError(errorMsg)
      }
    } finally {
      if (isMountedRef.current) setStripeConnecting(false)
    }
  }, [handleRefresh, returnTo, userCountryCode])

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
      await refetchStripeStatus()
      await refetchStripeBalance()
    } catch (err) {
      if (!isMountedRef.current) return
      setStripeError(getErrorMessage(err))
    } finally {
      if (isMountedRef.current) setStripeRefreshing(false)
    }
  }, [refetchStripeStatus, refetchStripeBalance])

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

  if (showSkeleton) {
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
        <Pressable className="back-btn" onClick={handleRefresh} disabled={isInitialLoading || isRefreshing}>
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

        {/* Salary Mode - Only show for Stripe users */}
        {stripeIsActive && salaryMode?.available && (
          <section className="settings-section">
            <h3 className="section-title">Payout Schedule</h3>
            <div className="method-card">
              {salaryModeLoading ? (
                <div className="method-row">
                  <Skeleton width={200} height={20} />
                </div>
              ) : !salaryMode?.unlocked ? (
                // Locked state - show progress
                <div className="salary-mode-locked">
                  <div className="salary-mode-locked-icon">
                    <Lock size={24} />
                  </div>
                  <div className="salary-mode-locked-content">
                    <div className="salary-mode-locked-title">Salary Mode</div>
                    <div className="salary-mode-locked-desc">
                      Set a fixed payday and get paid like an employee. Unlocks after 2 successful payments.
                    </div>
                    <div className="salary-mode-locked-progress">
                      <div className="salary-mode-progress-bar">
                        <div
                          className="salary-mode-progress-fill"
                          style={{ width: `${((salaryMode?.successfulPayments || 0) / 2) * 100}%` }}
                        />
                      </div>
                      <span className="salary-mode-progress-text">
                        {salaryMode?.successfulPayments || 0}/2 payments
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                // Unlocked state - show toggle and settings
                <>
                  <div className="method-row">
                    <div className="method-icon">
                      <Calendar size={20} color={salaryMode?.enabled ? 'var(--primary)' : undefined} />
                    </div>
                    <div className="method-info">
                      <span className="method-name">Salary Mode</span>
                      <span className="method-detail">
                        {salaryMode?.enabled
                          ? `Payday: ${salaryMode.preferredPayday}${getOrdinalSuffix(salaryMode.preferredPayday || 1)} of each month`
                          : 'Get paid on a fixed date each month'}
                      </span>
                    </div>
                    <Pressable
                      className={`toggle ${salaryMode?.enabled ? 'on' : ''}`}
                      onClick={() => {
                        if (salaryMode?.enabled) {
                          // Disable
                          updateSalaryMode.mutate({ enabled: false })
                        } else {
                          // Enable - show payday picker if no payday set
                          if (salaryMode?.preferredPayday) {
                            updateSalaryMode.mutate({ enabled: true })
                          } else {
                            setShowPaydayDrawer(true)
                          }
                        }
                      }}
                      disabled={updateSalaryMode.isPending}
                    >
                      <div className="toggle-knob" />
                    </Pressable>
                  </div>

                  {salaryMode?.enabled && (
                    <div className="salary-mode-details">
                      <Pressable
                        className="salary-mode-payday-btn"
                        onClick={() => setShowPaydayDrawer(true)}
                      >
                        <span>Change payday</span>
                        <ChevronDown size={16} />
                      </Pressable>
                      <div className="salary-mode-info">
                        <div className="salary-mode-info-row">
                          <span className="salary-mode-info-label">Subscribers billed</span>
                          <span className="salary-mode-info-value">
                            ~{salaryMode.billingDay}{getOrdinalSuffix(salaryMode.billingDay || 1)} of each month
                          </span>
                        </div>
                        <div className="salary-mode-info-row">
                          <span className="salary-mode-info-label">Target payday</span>
                          <span className="salary-mode-info-value">
                            ~{salaryMode.preferredPayday}{getOrdinalSuffix(salaryMode.preferredPayday || 1)} of each month
                          </span>
                        </div>
                      </div>
                      <div className="salary-mode-note">
                        New subscribers pay immediately on signup, then renew ~7 days before your payday each month. Existing subscribers keep their current billing date.
                      </div>
                    </div>
                  )}
                </>
              )}
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
                        : `Accept global cards (${formatStripeCurrencies()})`}
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
                      : `Accept local cards (${formatPaystackCurrencies()})`}
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

        {/* Fee Explainer - Only show for active Stripe users */}
        {stripeIsActive && (
          <section className="settings-section">
            <h3 className="section-title">Fee Structure</h3>
            <div className="fee-explainer-card">
              <div className="fee-explainer-header">
                <Info size={18} className="fee-explainer-icon" />
                <span className="fee-explainer-title">How fees work</span>
              </div>

              {isStripeCrossBorderCountry(userCountryCode) ? (
                // Cross-border country (NG, KE, GH) - Destination charges with higher buffer
                <div className="fee-explainer-content">
                  <p className="fee-explainer-intro">
                    NatePay charges a <strong>10.5% total fee</strong> for cross-border creators, split between you and your subscribers (5.25% each). This covers all Stripe processing and international transfer costs.
                  </p>

                  <div className="fee-explainer-breakdown">
                    <div className="fee-explainer-section">
                      <span className="fee-explainer-section-title">Fee Split</span>
                      <div className="fee-explainer-row">
                        <span>Subscriber pays extra</span>
                        <span className="fee-explainer-value">+5.25%</span>
                      </div>
                      <div className="fee-explainer-row">
                        <span>Deducted from you</span>
                        <span className="fee-explainer-value">-5.25%</span>
                      </div>
                    </div>

                    <div className="fee-explainer-section platform">
                      <span className="fee-explainer-section-title">What&apos;s Covered</span>
                      <div className="fee-explainer-row">
                        <span>Card processing</span>
                        <span className="fee-explainer-value muted">Included</span>
                      </div>
                      <div className="fee-explainer-row">
                        <span>Currency conversion</span>
                        <span className="fee-explainer-value muted">Included</span>
                      </div>
                      <div className="fee-explainer-row">
                        <span>International transfers</span>
                        <span className="fee-explainer-value muted">Included</span>
                      </div>
                    </div>
                  </div>

                  <div className="fee-explainer-example">
                    <span className="fee-explainer-example-title">Example: $100 subscription</span>
                    <div className="fee-explainer-example-calc">
                      <div className="fee-explainer-row">
                        <span>Subscriber pays</span>
                        <span>$105.25</span>
                      </div>
                      <div className="fee-explainer-row">
                        <span>Total fees (10.5%)</span>
                        <span className="muted">-$10.50</span>
                      </div>
                      <div className="fee-explainer-row total">
                        <span>You receive</span>
                        <span className="highlight">$94.75</span>
                      </div>
                    </div>
                  </div>

                  <p className="fee-explainer-note">
                    <TrendingUp size={14} />
                    <span>All Stripe fees are absorbed by NatePay. You always receive your set price minus 5.25%.</span>
                  </p>
                </div>
              ) : (
                // Domestic country (US, UK, EU) - Destination charges
                <div className="fee-explainer-content">
                  <p className="fee-explainer-intro">
                    NatePay charges a <strong>9% total fee</strong>, split between you and your subscribers (4.5% each). This covers all Stripe processing.
                  </p>

                  <div className="fee-explainer-breakdown">
                    <div className="fee-explainer-section">
                      <span className="fee-explainer-section-title">Fee Split</span>
                      <div className="fee-explainer-row">
                        <span>Subscriber pays extra</span>
                        <span className="fee-explainer-value">+4.5%</span>
                      </div>
                      <div className="fee-explainer-row">
                        <span>Deducted from you</span>
                        <span className="fee-explainer-value">-4.5%</span>
                      </div>
                    </div>
                  </div>

                  <div className="fee-explainer-example">
                    <span className="fee-explainer-example-title">Example: $100 subscription</span>
                    <div className="fee-explainer-example-calc">
                      <div className="fee-explainer-row">
                        <span>Subscriber pays</span>
                        <span>$104.50</span>
                      </div>
                      <div className="fee-explainer-row">
                        <span>Total fees (9%)</span>
                        <span className="muted">-$9.00</span>
                      </div>
                      <div className="fee-explainer-row total">
                        <span>You receive</span>
                        <span className="highlight">$95.50</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {/* SWIFT Code Lookup Modal for cross-border countries */}
      {showSwiftLookup && userCountryCode && (
        <SwiftCodeLookup
          countryCode={userCountryCode}
          onContinue={handleSwiftLookupContinue}
          onClose={handleSwiftLookupClose}
        />
      )}

      {/* Payday Picker Drawer */}
      <BottomDrawer
        open={showPaydayDrawer}
        onClose={() => setShowPaydayDrawer(false)}
        title="Choose your payday"
      >
        <div className="payday-picker">
          <p className="payday-picker-desc">
            Choose when you want to get paid each month. New subscribers pay immediately on signup, then renew ~7 days before your chosen payday.
          </p>
          <div className="payday-picker-options">
            {PAYDAY_OPTIONS.map((day) => (
              <Pressable
                key={day}
                className={`payday-option ${salaryMode?.preferredPayday === day ? 'selected' : ''}`}
                onClick={() => {
                  updateSalaryMode.mutate(
                    { enabled: true, preferredPayday: day },
                    { onSuccess: () => setShowPaydayDrawer(false) }
                  )
                }}
                disabled={updateSalaryMode.isPending}
              >
                <span className="payday-option-day">{day}{getOrdinalSuffix(day)}</span>
                <span className="payday-option-label">of each month</span>
                {salaryMode?.preferredPayday === day && (
                  <Check size={18} className="payday-option-check" />
                )}
              </Pressable>
            ))}
          </div>
          <div className="payday-picker-custom">
            <span className="payday-picker-custom-label">Or pick a specific day:</span>
            <select
              className="payday-picker-select"
              value={salaryMode?.preferredPayday || ''}
              onChange={(e) => {
                const day = parseInt(e.target.value, 10)
                if (day >= 1 && day <= 28) {
                  updateSalaryMode.mutate(
                    { enabled: true, preferredPayday: day },
                    { onSuccess: () => setShowPaydayDrawer(false) }
                  )
                }
              }}
              disabled={updateSalaryMode.isPending}
            >
              <option value="">Select day</option>
              {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
                <option key={day} value={day}>
                  {day}{getOrdinalSuffix(day)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </BottomDrawer>
    </div>
  )
}
