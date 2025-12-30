import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { CreditCard, X, Check, ChevronRight, AlertCircle } from 'lucide-react'
import { api, type ManageSubscriptionData, type CancelReason } from '../api/client'
import { formatCurrency } from '../utils/currency'

// Colors matching SubscribeBoundary design system
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
}

// Status labels for user-friendly display
const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  past_due: 'Past Due',
  canceled: 'Canceled',
  incomplete: 'Incomplete',
  incomplete_expired: 'Expired',
  trialing: 'Trial',
  unpaid: 'Unpaid',
  paused: 'Paused',
}

// Cancel reasons with user-friendly labels
const CANCEL_REASONS: { value: CancelReason; label: string; emoji: string }[] = [
  { value: 'too_expensive', label: 'Too expensive right now', emoji: '💰' },
  { value: 'not_enough_value', label: 'Not getting enough value', emoji: '🤔' },
  { value: 'taking_break', label: 'Just need a break', emoji: '⏸️' },
  { value: 'found_alternative', label: 'Found an alternative', emoji: '🔄' },
  { value: 'technical_issues', label: 'Technical issues', emoji: '🔧' },
  { value: 'other', label: 'Other reason', emoji: '💬' },
]

type ViewState = 'loading' | 'details' | 'cancel_reason' | 'cancel_confirm' | 'canceled' | 'error'

export default function ManageSubscription() {
  const { token } = useParams<{ token: string }>()

  const [view, setView] = useState<ViewState>('loading')
  const [data, setData] = useState<ManageSubscriptionData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedReason, setSelectedReason] = useState<CancelReason | null>(null)
  const [comment, setComment] = useState('')
  const [canceling, setCanceling] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)

  // Load subscription data
  useEffect(() => {
    if (!token) {
      setError('Invalid link')
      setView('error')
      return
    }

    api.subscriptionManage.get(token)
      .then((result) => {
        setData(result)
        // If already canceled, show that state
        if (result.subscription.status === 'canceled' || result.subscription.cancelAtPeriodEnd) {
          setView('canceled')
        } else {
          setView('details')
        }
      })
      .catch((err) => {
        setError(err.message || 'Failed to load subscription')
        setView('error')
      })
  }, [token])

  // Handle cancel submission
  const handleCancel = async () => {
    if (!token) return

    setCanceling(true)
    try {
      const result = await api.subscriptionManage.cancel(token, selectedReason || undefined, comment || undefined)
      if (result.success) {
        // Refresh data to get updated state
        const updated = await api.subscriptionManage.get(token)
        setData(updated)
        setView('canceled')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to cancel subscription')
    } finally {
      setCanceling(false)
    }
  }

  // Open Stripe portal for payment updates
  const handleUpdatePayment = async () => {
    if (!token) return

    setPortalLoading(true)
    try {
      const { url } = await api.subscriptionManage.getPortalUrl(token)
      window.location.href = url
    } catch (err: any) {
      setError(err.message || 'Failed to open payment portal')
      setPortalLoading(false)
    }
  }

  // Format date nicely
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  }

  // Calculate months subscribed
  const getMonthsSubscribed = () => {
    if (!data?.stats.memberSince) return 0
    const start = new Date(data.stats.memberSince)
    const now = new Date()
    const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
    return Math.max(1, months)
  }

  if (view === 'loading') {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 50%, #FCD34D 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        <div style={{
          width: 40,
          height: 40,
          border: '3px solid rgba(0,0,0,0.1)',
          borderTopColor: COLORS.neutral900,
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (view === 'error') {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 50%, #FCD34D 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}>
        <div style={{
          background: COLORS.white,
          borderRadius: 24,
          padding: 32,
          maxWidth: 400,
          width: '100%',
          textAlign: 'center',
          boxShadow: '0 20px 60px rgba(0,0,0,0.1)',
        }}>
          <AlertCircle size={48} color={COLORS.red} style={{ marginBottom: 16 }} />
          <h2 style={{ fontSize: 20, fontWeight: 600, color: COLORS.neutral900, margin: '0 0 8px' }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: 14, color: COLORS.neutral500, margin: 0 }}>
            {error || 'This link may be invalid or expired.'}
          </p>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { subscription, creator, subscriber, stats, payments } = data

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #FEF3C7 0%, #FDE68A 50%, #FCD34D 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 14,
    }}>
      {/* Main Card */}
      <div style={{
        width: '100%',
        maxWidth: 420,
        background: COLORS.white,
        borderRadius: 24,
        overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0,0,0,0.1)',
      }}>
        {/* Header with creator info */}
        <div style={{
          padding: '24px 24px 20px',
          borderBottom: `1px solid ${COLORS.neutral100}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Creator Avatar */}
            <div style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: COLORS.neutral100,
              overflow: 'hidden',
              flexShrink: 0,
            }}>
              {creator.avatarUrl ? (
                <img
                  src={creator.avatarUrl}
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
                  color: COLORS.neutral400,
                }}>
                  {creator.displayName[0]?.toUpperCase()}
                </div>
              )}
            </div>
            <div>
              <p style={{ fontSize: 13, color: COLORS.neutral500, margin: 0 }}>
                Your subscription to
              </p>
              <h1 style={{
                fontSize: 18,
                fontWeight: 600,
                color: COLORS.neutral900,
                margin: 0,
              }}>
                {creator.displayName}
              </h1>
            </div>
          </div>
          <p style={{
            fontSize: 13,
            color: COLORS.neutral400,
            margin: '12px 0 0',
          }}>
            {subscriber.maskedEmail}
          </p>
        </div>

        {/* Content area - changes based on view */}
        <div style={{ padding: 24 }}>
          {view === 'details' && (
            <>
              {/* Subscription Details Card */}
              <div style={{
                background: COLORS.neutral50,
                borderRadius: 16,
                padding: 20,
                marginBottom: 20,
              }}>
                {/* Amount */}
                <p style={{ fontSize: 12, color: COLORS.neutral400, margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Plan price
                </p>
                <div style={{
                  fontSize: 32,
                  fontWeight: 600,
                  color: '#3D3D3D',
                  letterSpacing: -0.5,
                }}>
                  {formatCurrency(subscription.amount, subscription.currency)}<span style={{
                    fontSize: 16,
                    fontWeight: 600,
                    color: '#3D3D3D',
                  }}>/month</span>
                </div>

                {/* Status */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 12,
                }}>
                  <div style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: subscription.status === 'active' ? COLORS.green : COLORS.neutral400,
                  }} />
                  <span style={{ fontSize: 14, color: COLORS.neutral600 }}>
                    {STATUS_LABELS[subscription.status] || subscription.status}
                  </span>
                </div>

                {/* Next billing */}
                {subscription.currentPeriodEnd && (
                  <p style={{ fontSize: 13, color: COLORS.neutral500, margin: '8px 0 0' }}>
                    Next billing: {formatDate(subscription.currentPeriodEnd)}
                  </p>
                )}

                {/* Billing descriptor - helps users recognize charges */}
                {subscription.billingDescriptor && (
                  <p style={{ fontSize: 12, color: COLORS.neutral400, margin: '4px 0 0' }}>
                    Appears on statement as: {subscription.billingDescriptor}
                  </p>
                )}

                {/* Stats row */}
                <div style={{
                  display: 'flex',
                  gap: 20,
                  marginTop: 16,
                  paddingTop: 16,
                  borderTop: `1px dashed ${COLORS.neutral200}`,
                }}>
                  <div>
                    <p style={{ fontSize: 12, color: COLORS.neutral400, margin: 0 }}>Member for</p>
                    <p style={{ fontSize: 14, fontWeight: 600, color: COLORS.neutral700, margin: '2px 0 0' }}>
                      {getMonthsSubscribed()} month{getMonthsSubscribed() > 1 ? 's' : ''}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: 12, color: COLORS.neutral400, margin: 0 }}>Total supported</p>
                    <p style={{ fontSize: 14, fontWeight: 600, color: COLORS.neutral700, margin: '2px 0 0' }}>
                      {formatCurrency(stats.totalSupported, subscription.currency)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Past Due Alert */}
              {subscription.isPastDue && subscription.pastDueMessage && (
                <div style={{
                  background: '#FEE2E2',
                  border: '1px solid #FECACA',
                  borderRadius: 12,
                  padding: '16px 20px',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                }}>
                  <AlertCircle size={20} color="#DC2626" style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: '#991B1B', margin: 0 }}>
                      Payment Failed
                    </p>
                    <p style={{ fontSize: 13, color: '#B91C1C', margin: '4px 0 0' }}>
                      {subscription.pastDueMessage}
                    </p>
                  </div>
                </div>
              )}

              {/* Inline Error Alert */}
              {error && (
                <div style={{
                  background: '#FEF3C7',
                  border: '1px solid #FDE68A',
                  borderRadius: 12,
                  padding: '12px 16px',
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}>
                  <AlertCircle size={18} color="#D97706" />
                  <span style={{ fontSize: 13, color: '#92400E', flex: 1 }}>{error}</span>
                  <button
                    onClick={() => setError(null)}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 4,
                      cursor: 'pointer',
                      color: '#92400E',
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
              )}

              {/* Action buttons */}
              {subscription.canUpdatePayment && (
                <button
                  onClick={handleUpdatePayment}
                  disabled={portalLoading}
                  style={{
                    width: '100%',
                    padding: '16px 20px',
                    background: COLORS.neutral50,
                    border: `1px solid ${COLORS.neutral200}`,
                    borderRadius: 12,
                    fontSize: 15,
                    fontWeight: 500,
                    color: COLORS.neutral700,
                    cursor: portalLoading ? 'wait' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    marginBottom: 12,
                    opacity: portalLoading ? 0.7 : 1,
                  }}
                >
                  <CreditCard size={20} />
                  <span style={{ flex: 1, textAlign: 'left' }}>
                    {portalLoading ? 'Opening...' : 'Update Payment Method'}
                  </span>
                  <ChevronRight size={18} color={COLORS.neutral400} />
                </button>
              )}

              {/* Hint for Paystack users who can't update payment inline */}
              {!subscription.canUpdatePayment && subscription.updatePaymentMethod === 'resubscribe' && (
                <p style={{
                  fontSize: 12,
                  color: COLORS.neutral400,
                  margin: '0 0 12px',
                  textAlign: 'center',
                }}>
                  To update your card, cancel and resubscribe with new details.
                </p>
              )}

              <button
                onClick={() => setView('cancel_reason')}
                style={{
                  width: '100%',
                  padding: '16px 20px',
                  background: 'transparent',
                  border: `1px solid ${COLORS.neutral200}`,
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 500,
                  color: COLORS.neutral500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <X size={20} />
                <span style={{ flex: 1, textAlign: 'left' }}>Cancel Subscription</span>
                <ChevronRight size={18} color={COLORS.neutral400} />
              </button>

              {/* Payment History */}
              {payments.length > 0 && (
                <div style={{ marginTop: 24 }}>
                  <h3 style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: COLORS.neutral400,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    margin: '0 0 12px',
                  }}>
                    Payment History
                  </h3>
                  <div style={{
                    background: COLORS.neutral50,
                    borderRadius: 12,
                    overflow: 'hidden',
                  }}>
                    {payments.slice(0, 5).map((payment, i) => (
                      <div
                        key={payment.id}
                        style={{
                          padding: '12px 16px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          borderBottom: i < payments.length - 1 ? `1px solid ${COLORS.neutral200}` : 'none',
                        }}
                      >
                        <span style={{ fontSize: 14, color: COLORS.neutral600 }}>
                          {formatDate(payment.date)}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 14, fontWeight: 500, color: COLORS.neutral700 }}>
                            {formatCurrency(payment.amount, payment.currency)}
                          </span>
                          <Check size={14} color={COLORS.green} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {view === 'cancel_reason' && (
            <>
              <button
                onClick={() => setView('details')}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 14,
                  color: COLORS.neutral500,
                  cursor: 'pointer',
                  padding: 0,
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                ← Back
              </button>

              <h2 style={{
                fontSize: 20,
                fontWeight: 600,
                color: COLORS.neutral900,
                margin: '0 0 8px',
              }}>
                Before you go...
              </h2>
              <p style={{
                fontSize: 14,
                color: COLORS.neutral500,
                margin: '0 0 20px',
              }}>
                Help {creator.displayName} understand why you're leaving (optional)
              </p>

              {/* Reason options */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {CANCEL_REASONS.map((reason) => (
                  <button
                    key={reason.value}
                    onClick={() => setSelectedReason(reason.value)}
                    style={{
                      padding: '14px 16px',
                      background: selectedReason === reason.value ? COLORS.neutral100 : COLORS.white,
                      border: `1px solid ${selectedReason === reason.value ? COLORS.neutral400 : COLORS.neutral200}`,
                      borderRadius: 12,
                      fontSize: 15,
                      color: COLORS.neutral700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      textAlign: 'left',
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{reason.emoji}</span>
                    <span>{reason.label}</span>
                  </button>
                ))}
              </div>

              {/* Optional comment */}
              {selectedReason === 'other' && (
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Tell us more (optional)..."
                  maxLength={500}
                  style={{
                    width: '100%',
                    marginTop: 12,
                    padding: 14,
                    border: `1px solid ${COLORS.neutral200}`,
                    borderRadius: 12,
                    fontSize: 14,
                    resize: 'vertical',
                    minHeight: 80,
                    fontFamily: 'inherit',
                  }}
                />
              )}

              <button
                onClick={() => setView('cancel_confirm')}
                style={{
                  width: '100%',
                  marginTop: 20,
                  padding: '16px',
                  background: COLORS.neutral900,
                  color: COLORS.white,
                  border: 'none',
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Continue to Cancel
              </button>
            </>
          )}

          {view === 'cancel_confirm' && (
            <>
              <button
                onClick={() => setView('cancel_reason')}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 14,
                  color: COLORS.neutral500,
                  cursor: 'pointer',
                  padding: 0,
                  marginBottom: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                ← Back
              </button>

              <h2 style={{
                fontSize: 20,
                fontWeight: 600,
                color: COLORS.neutral900,
                margin: '0 0 16px',
              }}>
                Confirm cancellation
              </h2>

              <div style={{
                background: COLORS.neutral50,
                borderRadius: 12,
                padding: 16,
                marginBottom: 20,
              }}>
                <p style={{ fontSize: 14, color: COLORS.neutral600, margin: 0 }}>
                  Your subscription to <strong>{creator.displayName}</strong> will be canceled.
                </p>
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Check size={16} color={COLORS.green} />
                    <span style={{ fontSize: 13, color: COLORS.neutral600 }}>
                      You'll have access until {subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : 'end of billing period'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Check size={16} color={COLORS.green} />
                    <span style={{ fontSize: 13, color: COLORS.neutral600 }}>
                      You won't be charged again
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Check size={16} color={COLORS.green} />
                    <span style={{ fontSize: 13, color: COLORS.neutral600 }}>
                      You can resubscribe anytime
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={handleCancel}
                disabled={canceling}
                style={{
                  width: '100%',
                  padding: '16px',
                  background: COLORS.red,
                  color: COLORS.white,
                  border: 'none',
                  borderRadius: 12,
                  fontSize: 15,
                  fontWeight: 600,
                  cursor: canceling ? 'wait' : 'pointer',
                  opacity: canceling ? 0.7 : 1,
                }}
              >
                {canceling ? 'Canceling...' : 'Cancel Subscription'}
              </button>

              <button
                onClick={() => setView('details')}
                style={{
                  width: '100%',
                  marginTop: 12,
                  padding: '14px',
                  background: 'transparent',
                  color: COLORS.neutral500,
                  border: 'none',
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                Never mind, keep my subscription
              </button>
            </>
          )}

          {view === 'canceled' && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{
                width: 64,
                height: 64,
                background: COLORS.neutral100,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
              }}>
                <Check size={32} color={COLORS.neutral600} />
              </div>

              <h2 style={{
                fontSize: 20,
                fontWeight: 600,
                color: COLORS.neutral900,
                margin: '0 0 8px',
              }}>
                Subscription Canceled
              </h2>

              <p style={{
                fontSize: 14,
                color: COLORS.neutral500,
                margin: '0 0 24px',
              }}>
                {subscription.currentPeriodEnd
                  ? `You'll have access until ${formatDate(subscription.currentPeriodEnd)}`
                  : 'Your subscription has ended'}
              </p>

              <p style={{
                fontSize: 14,
                color: COLORS.neutral600,
                margin: '0 0 20px',
              }}>
                We're sorry to see you go. If things change, {creator.displayName} would love to have you back.
              </p>

              {data.actions?.resubscribeUrl && (
                <button
                  onClick={() => window.location.href = data.actions.resubscribeUrl!}
                  style={{
                    padding: '14px 28px',
                    background: COLORS.neutral900,
                    color: COLORS.white,
                    border: 'none',
                    borderRadius: 12,
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Resubscribe
                </button>
              )}
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
