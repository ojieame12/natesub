import { useState, useRef, useEffect } from 'react'
import { Check, ChevronRight, AlertCircle, LogOut, CreditCard, X, Receipt } from 'lucide-react'
import { api, type SubscriberSubscription, type SubscriberSubscriptionDetail, type CancelReason } from '../api/client'
import { formatCurrency } from '../utils/currency'

// Payment history item from detail endpoint
interface PaymentHistoryItem {
  id: string
  amount: number
  currency: string
  date: string
  status: string
}

// Colors matching design system
const COLORS = {
  neutral50: '#FAFAF9',
  neutral100: '#F5F5F4',
  neutral200: '#E7E5E4',
  neutral400: '#A8A29E',
  neutral500: '#78716C',
  neutral600: '#57534E',
  neutral700: '#44403C',
  neutral900: '#1C1917',
  white: '#FFFFFF',
  green: '#10b981',
  red: '#ef4444',
  yellow: '#f59e0b',
}

// Cancel reasons
const CANCEL_REASONS: { value: CancelReason; label: string }[] = [
  { value: 'too_expensive', label: 'Too expensive right now' },
  { value: 'not_enough_value', label: 'Not getting enough value' },
  { value: 'taking_break', label: 'Just need a break' },
  { value: 'found_alternative', label: 'Found an alternative' },
  { value: 'technical_issues', label: 'Technical issues' },
  { value: 'other', label: 'Other reason' },
]

type ViewState = 'email' | 'otp' | 'list' | 'detail' | 'cancel' | 'error'

export default function SubscriberPortal() {
  const [view, setView] = useState<ViewState>('email')
  const [email, setEmail] = useState('')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [subscriptions, setSubscriptions] = useState<SubscriberSubscription[]>([])
  const [selectedSub, setSelectedSub] = useState<SubscriberSubscriptionDetail | null>(null)
  const [payments, setPayments] = useState<PaymentHistoryItem[]>([])
  const [resubscribeUrl, setResubscribeUrl] = useState<string | null>(null)
  const [selectedReason, setSelectedReason] = useState<CancelReason | null>(null)
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  const [reactivating, setReactivating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])

  // Try to load existing session on mount
  useEffect(() => {
    loadSubscriptions()
  }, [])

  const loadSubscriptions = async () => {
    try {
      const data = await api.subscriberPortal.listSubscriptions()
      setSubscriptions(data.subscriptions)
      setMaskedEmail(data.maskedEmail)
      setView('list')
    } catch {
      // No session or expired - stay on email view
    }
  }

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !email.includes('@')) return

    setLoading(true)
    setError(null)

    try {
      await api.subscriberPortal.requestOtp(email.trim())
      setView('otp')
    } catch (err: any) {
      setError(err.message || 'Failed to send verification code')
    } finally {
      setLoading(false)
    }
  }

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return

    const newOtp = [...otp]
    newOtp[index] = value.slice(-1)
    setOtp(newOtp)

    // Auto-advance to next input
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus()
    }

    // Auto-submit when complete
    if (newOtp.every(d => d) && newOtp.join('').length === 6) {
      verifyOtp(newOtp.join(''))
    }
  }

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus()
    }
  }

  const verifyOtp = async (code: string) => {
    setLoading(true)
    setError(null)

    try {
      const result = await api.subscriberPortal.verifyOtp(email.trim(), code)
      if (result.success) {
        await loadSubscriptions()
      } else {
        setError(result.error || 'Invalid code')
        setOtp(['', '', '', '', '', ''])
        otpRefs.current[0]?.focus()
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed')
      setOtp(['', '', '', '', '', ''])
      otpRefs.current[0]?.focus()
    } finally {
      setLoading(false)
    }
  }

  const handleResendOtp = async () => {
    setLoading(true)
    setError(null)

    try {
      await api.subscriberPortal.requestOtp(email.trim())
      setSuccessMessage('Code sent!')
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err: any) {
      setError(err.message || 'Failed to resend code')
    } finally {
      setLoading(false)
    }
  }

  const handleSignOut = async () => {
    await api.subscriberPortal.signOut()
    setView('email')
    setEmail('')
    setOtp(['', '', '', '', '', ''])
    setSubscriptions([])
    setSelectedSub(null)
    setPayments([])
    setResubscribeUrl(null)
  }

  const handleManage = async (sub: SubscriberSubscription) => {
    setLoading(true)
    setError(null)

    try {
      const data = await api.subscriberPortal.getSubscription(sub.id)
      setSelectedSub(data.subscription)
      setPayments(data.payments)
      setResubscribeUrl(data.actions.resubscribeUrl)
      setView('detail')
    } catch (err: any) {
      setError(err.message || 'Failed to load subscription details')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdatePayment = async () => {
    if (!selectedSub) return

    setLoading(true)
    try {
      const result = await api.subscriberPortal.getPortalUrl(selectedSub.id)
      if (result.url) {
        window.location.href = result.url
      } else if (result.error) {
        setError(result.instructions || result.error)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to open payment portal')
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!selectedSub) return

    setLoading(true)
    setError(null)

    try {
      const result = await api.subscriberPortal.cancelSubscription(
        selectedSub.id,
        selectedReason || undefined,
        comment || undefined
      )

      if (result.success) {
        setSuccessMessage(result.message)
        // Refresh list
        await loadSubscriptions()
        setView('list')
        setSelectedSub(null)
        setPayments([])
        setResubscribeUrl(null)
        setSelectedReason(null)
        setComment('')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to cancel subscription')
    } finally {
      setLoading(false)
    }
  }

  const handleReactivate = async () => {
    if (!selectedSub) return

    setReactivating(true)
    setError(null)

    try {
      const result = await api.subscriberPortal.reactivateSubscription(selectedSub.id)
      if (result.success) {
        setSuccessMessage(result.message || 'Subscription reactivated!')
        // Refresh the subscription data
        const data = await api.subscriberPortal.getSubscription(selectedSub.id)
        setSelectedSub(data.subscription)
        setPayments(data.payments)
        setResubscribeUrl(data.actions.resubscribeUrl)
        // Also refresh the list
        await loadSubscriptions()
      }
    } catch (err: any) {
      setError(err.message || 'Failed to reactivate subscription')
    } finally {
      setReactivating(false)
    }
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return ''
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const getStatusColor = (status: string, cancelAtPeriodEnd: boolean) => {
    if (status === 'past_due') return COLORS.red
    if (cancelAtPeriodEnd) return COLORS.yellow
    if (status === 'active') return COLORS.green
    return COLORS.neutral400
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 50%, #FCD34D 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 14,
      fontFamily: 'var(--font-primary, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif)',
    }}>
      {/* Main Card */}
      <div style={{
        width: '100%',
        maxWidth: 440,
        background: COLORS.white,
        borderRadius: 24,
        overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.1)',
      }}>
        {/* Header */}
        <div style={{
          padding: '24px 24px 20px',
          borderBottom: view === 'list' ? `1px solid ${COLORS.neutral100}` : 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <h1 style={{
              fontSize: 20,
              fontWeight: 600,
              color: COLORS.neutral900,
              margin: 0,
            }}>
              {view === 'email' || view === 'otp' ? 'Manage Subscriptions' : 'Your Subscriptions'}
            </h1>
            {view === 'list' && maskedEmail && (
              <p style={{ fontSize: 13, color: COLORS.neutral500, margin: '4px 0 0' }}>
                {maskedEmail}
              </p>
            )}
          </div>
          {view === 'list' && (
            <button
              onClick={handleSignOut}
              style={{
                background: 'none',
                border: 'none',
                color: COLORS.neutral500,
                cursor: 'pointer',
                padding: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 13,
              }}
            >
              <LogOut size={16} /> Sign out
            </button>
          )}
        </div>

        {/* Content */}
        <div style={{ padding: 24 }}>
          {/* Success Message */}
          {successMessage && (
            <div style={{
              background: '#ECFDF5',
              border: '1px solid #A7F3D0',
              borderRadius: 12,
              padding: '12px 16px',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}>
              <Check size={18} color={COLORS.green} />
              <span style={{ fontSize: 14, color: '#065F46' }}>{successMessage}</span>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div style={{
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              borderRadius: 12,
              padding: '12px 16px',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}>
              <AlertCircle size={18} color={COLORS.red} />
              <span style={{ fontSize: 14, color: '#991B1B', flex: 1 }}>{error}</span>
              <button
                onClick={() => setError(null)}
                style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer' }}
              >
                <X size={16} color="#991B1B" />
              </button>
            </div>
          )}

          {/* Email Step */}
          {view === 'email' && (
            <form onSubmit={handleEmailSubmit}>
              <p style={{ fontSize: 14, color: COLORS.neutral600, margin: '0 0 20px' }}>
                Enter your email to view and manage all your subscriptions.
              </p>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                autoFocus
                style={{
                  width: '100%',
                  height: 52,
                  padding: '0 16px',
                  background: COLORS.neutral100,
                  border: '2px solid transparent',
                  borderRadius: 12,
                  fontSize: 16,
                  color: COLORS.neutral900,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <button
                type="submit"
                disabled={loading || !email.includes('@')}
                style={{
                  width: '100%',
                  height: 52,
                  marginTop: 16,
                  background: COLORS.neutral900,
                  color: COLORS.white,
                  border: 'none',
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: loading ? 'wait' : 'pointer',
                  opacity: loading || !email.includes('@') ? 0.6 : 1,
                }}
              >
                {loading ? 'Sending...' : 'Continue'}
              </button>
            </form>
          )}

          {/* OTP Step */}
          {view === 'otp' && (
            <div>
              <p style={{ fontSize: 14, color: COLORS.neutral600, margin: '0 0 20px' }}>
                We sent a 6-digit code to <strong>{email}</strong>
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 20 }}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={el => { otpRefs.current[i] = el }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={e => handleOtpChange(i, e.target.value)}
                    onKeyDown={e => handleOtpKeyDown(i, e)}
                    autoFocus={i === 0}
                    style={{
                      width: 48,
                      height: 56,
                      textAlign: 'center',
                      fontSize: 24,
                      fontWeight: 600,
                      background: COLORS.neutral100,
                      border: '2px solid transparent',
                      borderRadius: 12,
                      outline: 'none',
                    }}
                  />
                ))}
              </div>
              <button
                onClick={handleResendOtp}
                disabled={loading}
                style={{
                  background: 'none',
                  border: 'none',
                  color: COLORS.neutral500,
                  fontSize: 14,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  display: 'block',
                  margin: '0 auto',
                }}
              >
                Didn't receive it? Resend
              </button>
              <button
                onClick={() => { setView('email'); setOtp(['', '', '', '', '', '']) }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: COLORS.neutral400,
                  fontSize: 13,
                  cursor: 'pointer',
                  display: 'block',
                  margin: '16px auto 0',
                }}
              >
                Use different email
              </button>
            </div>
          )}

          {/* Subscriptions List */}
          {view === 'list' && (
            <div>
              {subscriptions.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0' }}>
                  <p style={{ fontSize: 15, color: COLORS.neutral500 }}>
                    No active subscriptions found.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {subscriptions.map(sub => (
                    <button
                      key={sub.id}
                      onClick={() => handleManage(sub)}
                      style={{
                        width: '100%',
                        background: COLORS.neutral50,
                        border: sub.isPastDue ? `1px solid ${COLORS.red}` : `1px solid ${COLORS.neutral200}`,
                        borderRadius: 16,
                        padding: 16,
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                      }}
                    >
                      {/* Avatar */}
                      <div style={{
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        background: COLORS.neutral200,
                        overflow: 'hidden',
                        flexShrink: 0,
                      }}>
                        {sub.creator.avatarUrl ? (
                          <img
                            src={sub.creator.avatarUrl}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <div style={{
                            width: '100%',
                            height: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 18,
                            fontWeight: 600,
                            color: COLORS.neutral500,
                          }}>
                            {sub.creator.displayName[0]?.toUpperCase()}
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 15,
                          fontWeight: 600,
                          color: COLORS.neutral900,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}>
                          {sub.creator.displayName}
                        </div>
                        <div style={{
                          fontSize: 13,
                          color: COLORS.neutral500,
                          marginTop: 2,
                        }}>
                          <span style={{ color: COLORS.neutral400, fontSize: 11 }}>Plan </span>
                          {formatCurrency(sub.amount, sub.currency)}/{sub.interval}
                        </div>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          marginTop: 4,
                        }}>
                          <div style={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            background: getStatusColor(sub.status, sub.cancelAtPeriodEnd),
                          }} />
                          <span style={{ fontSize: 12, color: COLORS.neutral500 }}>
                            {sub.statusLabel}
                          </span>
                          {sub.isPastDue && (
                            <span style={{ fontSize: 11, color: COLORS.red, fontWeight: 500 }}>
                              Action required
                            </span>
                          )}
                        </div>
                      </div>

                      <ChevronRight size={18} color={COLORS.neutral400} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Subscription Detail */}
          {view === 'detail' && selectedSub && (
            <div>
              <button
                onClick={() => { setView('list'); setSelectedSub(null); setPayments([]); setResubscribeUrl(null); setError(null) }}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 14,
                  color: COLORS.neutral500,
                  cursor: 'pointer',
                  padding: 0,
                  marginBottom: 16,
                }}
              >
                ← Back
              </button>

              {/* Creator Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <div style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  background: COLORS.neutral200,
                  overflow: 'hidden',
                }}>
                  {selectedSub.creator.avatarUrl ? (
                    <img
                      src={selectedSub.creator.avatarUrl}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 20,
                      fontWeight: 600,
                      color: COLORS.neutral500,
                    }}>
                      {selectedSub.creator.displayName[0]?.toUpperCase()}
                    </div>
                  )}
                </div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: COLORS.neutral900 }}>
                    {selectedSub.creator.displayName}
                  </div>
                  <div style={{ fontSize: 14, color: COLORS.neutral500 }}>
                    <span style={{ color: COLORS.neutral400, fontSize: 12 }}>Plan </span>
                    {formatCurrency(selectedSub.amount, selectedSub.currency)}/{selectedSub.interval}
                  </div>
                </div>
              </div>

              {/* Details Card */}
              <div style={{
                background: COLORS.neutral50,
                borderRadius: 12,
                padding: 16,
                marginBottom: 16,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, color: COLORS.neutral500 }}>Status</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: getStatusColor(selectedSub.status, selectedSub.cancelAtPeriodEnd),
                    }} />
                    <span style={{ fontSize: 13, fontWeight: 500, color: COLORS.neutral700 }}>
                      {selectedSub.statusLabel}
                    </span>
                  </div>
                </div>
                {selectedSub.currentPeriodEnd && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                    <span style={{ fontSize: 13, color: COLORS.neutral500 }}>
                      {selectedSub.cancelAtPeriodEnd ? 'Access until' : 'Next billing'}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: COLORS.neutral700 }}>
                      {formatDate(selectedSub.currentPeriodEnd)}
                    </span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, color: COLORS.neutral500 }}>Total supported</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: COLORS.neutral700 }}>
                    {formatCurrency(selectedSub.totalPaid, selectedSub.currency)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: COLORS.neutral500 }}>Statement shows as</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: COLORS.neutral700 }}>
                    {selectedSub.billingDescriptor}
                  </span>
                </div>
              </div>

              {/* Payment History */}
              {payments.length > 0 && (
                <div style={{
                  background: COLORS.neutral50,
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 16,
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 12,
                  }}>
                    <Receipt size={16} color={COLORS.neutral500} />
                    <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.neutral700 }}>
                      Recent Payments
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {payments.map(payment => (
                      <div
                        key={payment.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 0',
                          borderBottom: `1px solid ${COLORS.neutral200}`,
                        }}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: COLORS.neutral700 }}>
                            {formatCurrency(payment.amount, payment.currency)}
                          </div>
                          <div style={{ fontSize: 12, color: COLORS.neutral400 }}>
                            {formatDate(payment.date)}
                          </div>
                        </div>
                        <div style={{
                          fontSize: 11,
                          fontWeight: 500,
                          color: payment.status === 'succeeded' ? COLORS.green : COLORS.neutral500,
                          textTransform: 'uppercase',
                        }}>
                          {payment.status === 'succeeded' ? 'Paid' : payment.status}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Past Due Alert */}
              {selectedSub.isPastDue && (
                <div style={{
                  background: '#FEE2E2',
                  border: '1px solid #FECACA',
                  borderRadius: 12,
                  padding: '12px 16px',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                }}>
                  <AlertCircle size={18} color={COLORS.red} style={{ marginTop: 2 }} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#991B1B' }}>
                      Payment Failed
                    </div>
                    <div style={{ fontSize: 13, color: '#B91C1C', marginTop: 2 }}>
                      Please update your payment method to continue.
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              {selectedSub.canUpdatePayment && (
                <button
                  onClick={handleUpdatePayment}
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    background: COLORS.neutral50,
                    border: `1px solid ${COLORS.neutral200}`,
                    borderRadius: 12,
                    fontSize: 14,
                    fontWeight: 500,
                    color: COLORS.neutral700,
                    cursor: loading ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 10,
                  }}
                >
                  <CreditCard size={18} />
                  <span style={{ flex: 1, textAlign: 'left' }}>Update Payment Method</span>
                  <ChevronRight size={16} color={COLORS.neutral400} />
                </button>
              )}

              {selectedSub.updatePaymentMethod === 'resubscribe' && (
                <p style={{
                  fontSize: 12,
                  color: COLORS.neutral400,
                  textAlign: 'center',
                  margin: '0 0 10px',
                }}>
                  To update your card, cancel and resubscribe with new details.
                </p>
              )}

              {!selectedSub.cancelAtPeriodEnd && selectedSub.status !== 'canceled' && (
                <button
                  onClick={() => setView('cancel')}
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    background: 'transparent',
                    border: `1px solid ${COLORS.neutral200}`,
                    borderRadius: 12,
                    fontSize: 14,
                    fontWeight: 500,
                    color: COLORS.neutral500,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <X size={18} />
                  <span style={{ flex: 1, textAlign: 'left' }}>Cancel Subscription</span>
                  <ChevronRight size={16} color={COLORS.neutral400} />
                </button>
              )}

              {/* Undo Cancel - when scheduled to cancel but still has access */}
              {selectedSub.cancelAtPeriodEnd && selectedSub.status !== 'canceled' && (
                <button
                  onClick={handleReactivate}
                  disabled={reactivating}
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    background: COLORS.neutral900,
                    border: 'none',
                    borderRadius: 12,
                    fontSize: 14,
                    fontWeight: 600,
                    color: COLORS.white,
                    cursor: reactivating ? 'wait' : 'pointer',
                    opacity: reactivating ? 0.7 : 1,
                  }}
                >
                  {reactivating ? 'Reactivating...' : 'Keep My Subscription'}
                </button>
              )}

              {/* Resubscribe - only when fully canceled */}
              {selectedSub.status === 'canceled' && resubscribeUrl && (
                <button
                  onClick={() => window.location.href = resubscribeUrl}
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    background: COLORS.neutral900,
                    border: 'none',
                    borderRadius: 12,
                    fontSize: 14,
                    fontWeight: 600,
                    color: COLORS.white,
                    cursor: 'pointer',
                  }}
                >
                  Resubscribe
                </button>
              )}
            </div>
          )}

          {/* Cancel Flow */}
          {view === 'cancel' && selectedSub && (
            <div>
              <button
                onClick={() => { setView('detail'); setSelectedReason(null); setComment('') }}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 14,
                  color: COLORS.neutral500,
                  cursor: 'pointer',
                  padding: 0,
                  marginBottom: 16,
                }}
              >
                ← Back
              </button>

              <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.neutral900, margin: '0 0 8px' }}>
                Before you go...
              </h2>
              <p style={{ fontSize: 14, color: COLORS.neutral500, margin: '0 0 16px' }}>
                Help {selectedSub.creator.displayName} understand why (optional)
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {CANCEL_REASONS.map(reason => (
                  <button
                    key={reason.value}
                    onClick={() => setSelectedReason(reason.value)}
                    style={{
                      padding: '12px 14px',
                      background: selectedReason === reason.value ? COLORS.neutral100 : COLORS.white,
                      border: `1px solid ${selectedReason === reason.value ? COLORS.neutral400 : COLORS.neutral200}`,
                      borderRadius: 10,
                      fontSize: 14,
                      color: COLORS.neutral700,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {reason.label}
                  </button>
                ))}
              </div>

              {selectedReason === 'other' && (
                <textarea
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Tell us more (optional)..."
                  maxLength={500}
                  style={{
                    width: '100%',
                    padding: 12,
                    border: `1px solid ${COLORS.neutral200}`,
                    borderRadius: 10,
                    fontSize: 14,
                    resize: 'vertical',
                    minHeight: 80,
                    fontFamily: 'inherit',
                    marginBottom: 16,
                    boxSizing: 'border-box',
                  }}
                />
              )}

              <div style={{
                background: COLORS.neutral50,
                borderRadius: 10,
                padding: 14,
                marginBottom: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Check size={14} color={COLORS.green} />
                  <span style={{ fontSize: 13, color: COLORS.neutral600 }}>
                    Access until {formatDate(selectedSub.currentPeriodEnd)}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Check size={14} color={COLORS.green} />
                  <span style={{ fontSize: 13, color: COLORS.neutral600 }}>
                    You won't be charged again
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Check size={14} color={COLORS.green} />
                  <span style={{ fontSize: 13, color: COLORS.neutral600 }}>
                    You can resubscribe anytime
                  </span>
                </div>
              </div>

              <button
                onClick={handleCancel}
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '14px',
                  background: COLORS.red,
                  color: COLORS.white,
                  border: 'none',
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: loading ? 'wait' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? 'Canceling...' : 'Cancel Subscription'}
              </button>

              <button
                onClick={() => { setView('detail'); setSelectedReason(null); setComment('') }}
                style={{
                  width: '100%',
                  marginTop: 10,
                  padding: '12px',
                  background: 'transparent',
                  color: COLORS.neutral500,
                  border: 'none',
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                Never mind, keep subscription
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 24px',
          borderTop: `1px solid ${COLORS.neutral100}`,
          display: 'flex',
          justifyContent: 'center',
        }}>
          <img
            src="/logo.svg"
            alt="NatePay"
            style={{ height: 20, opacity: 0.5 }}
          />
        </div>
      </div>
    </div>
  )
}
