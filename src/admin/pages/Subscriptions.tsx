/**
 * Subscriptions - Subscription management with subscriber detail sidebar
 */

import { useState } from 'react'
import {
  useAdminSubscriptions,
  useAdminSubscriptionDetail,
  useAdminCancelSubscription,
  useAdminSubscriptionPause,
  useAdminSubscriptionResume,
  useAdminRefund,
} from '../api'
import { formatCurrency, formatDate, formatDateTime } from '../utils/format'
import FilterBar from '../components/FilterBar'
import Pagination from '../components/Pagination'
import ActionModal from '../components/ActionModal'
import { SkeletonTableRows } from '../components/SkeletonTableRows'
import { ContentSkeleton } from '../../components/Skeleton'

function getStatusBadge(status: string): string {
  switch (status) {
    case 'active': return 'success'
    case 'canceled': return 'neutral'
    case 'past_due': return 'warning'
    case 'unpaid': return 'error'
    case 'paused': return 'warning'
    case 'succeeded': return 'success'
    case 'failed': return 'error'
    case 'refunded': return 'neutral'
    default: return 'neutral'
  }
}

export default function Subscriptions() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const limit = 50

  // Selected subscription for detail sidebar
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<string | null>(null)

  // Modals
  const [cancelModal, setCancelModal] = useState<{ id: string; email: string } | null>(null)
  const [cancelImmediate, setCancelImmediate] = useState(false)
  const [refundModal, setRefundModal] = useState<{ paymentId: string; amount: number; currency: string } | null>(null)

  // Debounce search
  const handleSearchChange = (value: string) => {
    setSearch(value)
    setTimeout(() => {
      setDebouncedSearch(value)
      setPage(1)
    }, 300)
  }

  const { data, isLoading, error, refetch } = useAdminSubscriptions({
    search: debouncedSearch || undefined,
    status: status !== 'all' ? status : undefined,
    page,
    limit,
  })

  const { data: detail, isLoading: detailLoading } = useAdminSubscriptionDetail(selectedSubscriptionId || '')

  // Mutations
  const cancelMutation = useAdminCancelSubscription()
  const pauseMutation = useAdminSubscriptionPause()
  const resumeMutation = useAdminSubscriptionResume()
  const refundMutation = useAdminRefund()

  const handleCancel = async () => {
    if (!cancelModal) return
    try {
      await cancelMutation.mutateAsync({
        subscriptionId: cancelModal.id,
        immediate: cancelImmediate,
      })
      setCancelModal(null)
      setCancelImmediate(false)
      refetch()
    } catch (err) {
      console.error('Cancel failed:', err)
    }
  }

  const handlePause = async (subscriptionId: string) => {
    try {
      await pauseMutation.mutateAsync(subscriptionId)
      refetch()
    } catch (err) {
      console.error('Pause failed:', err)
    }
  }

  const handleResume = async (subscriptionId: string) => {
    try {
      await resumeMutation.mutateAsync(subscriptionId)
      refetch()
    } catch (err) {
      console.error('Resume failed:', err)
    }
  }

  const handleRefund = async (reason?: string) => {
    if (!refundModal) return
    try {
      await refundMutation.mutateAsync({
        paymentId: refundModal.paymentId,
        reason,
      })
      setRefundModal(null)
      refetch()
    } catch (err) {
      console.error('Refund failed:', err)
    }
  }

  const clearFilters = () => {
    setSearch('')
    setDebouncedSearch('')
    setStatus('all')
    setPage(1)
  }

  // Find most recent successful payment for refund
  const lastSuccessfulPayment = detail?.payments?.find(p => p.status === 'succeeded')

  // Error state
  if (error) {
    return (
      <div>
        <h1 className="admin-page-title">Subscriptions</h1>
        <div className="admin-alert admin-alert-error" style={{ marginBottom: 16 }}>
          Failed to load subscriptions: {error.message}
        </div>
        <button className="admin-btn admin-btn-primary" onClick={() => refetch()}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 className="admin-page-title" style={{ margin: 0 }}>Subscriptions</h1>
        <button
          className="admin-btn admin-btn-secondary"
          onClick={() => refetch()}
          disabled={isLoading}
        >
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      <FilterBar
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder="Search by email or username..."
        filters={[
          {
            name: 'status',
            value: status,
            options: [
              { value: 'all', label: 'All Status' },
              { value: 'active', label: 'Active' },
              { value: 'paused', label: 'Paused' },
              { value: 'canceled', label: 'Canceled' },
              { value: 'past_due', label: 'Past Due' },
            ],
            onChange: (v) => { setStatus(v); setPage(1) },
          },
        ]}
        onClear={clearFilters}
      />

      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Subscriber</th>
              <th>Creator</th>
              <th>Amount</th>
              <th>Status</th>
              <th>LTV</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonTableRows columns={7} rows={5} />
            ) : data?.subscriptions?.length ? (
              data.subscriptions.map((sub) => (
                <tr key={sub.id}>
                  <td>
                    <button
                      className="admin-link"
                      onClick={() => setSelectedSubscriptionId(sub.id)}
                    >
                      {sub.subscriber.email}
                    </button>
                  </td>
                  <td>@{sub.creator.username || sub.creator.email}</td>
                  <td>{formatCurrency(sub.amount, sub.currency)}/{sub.interval}</td>
                  <td>
                    <span className={`admin-badge ${getStatusBadge(sub.status)}`}>
                      {sub.status}
                    </span>
                  </td>
                  <td>{formatCurrency(sub.ltvCents, sub.currency)}</td>
                  <td>{formatDate(sub.createdAt)}</td>
                  <td>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {sub.status === 'active' && (
                        <>
                          <button
                            className="admin-btn admin-btn-secondary admin-btn-small"
                            onClick={() => handlePause(sub.id)}
                            disabled={pauseMutation.isPending}
                          >
                            Pause
                          </button>
                          <button
                            className="admin-btn admin-btn-danger admin-btn-small"
                            onClick={() => setCancelModal({
                              id: sub.id,
                              email: sub.subscriber.email,
                            })}
                          >
                            Cancel
                          </button>
                        </>
                      )}
                      {sub.status === 'paused' && (
                        <button
                          className="admin-btn admin-btn-primary admin-btn-small"
                          onClick={() => handleResume(sub.id)}
                          disabled={resumeMutation.isPending}
                        >
                          Resume
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '32px' }}>No subscriptions found</td></tr>
            )}
          </tbody>
        </table>

        {data && data.totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={data.totalPages}
            total={data.total}
            limit={limit}
            onPageChange={setPage}
            loading={isLoading}
          />
        )}
      </div>

      {/* Subscriber Detail Sidebar */}
      {selectedSubscriptionId && (
        <div className="admin-sidebar-overlay" onClick={() => setSelectedSubscriptionId(null)}>
          <div className="admin-sidebar" onClick={(e) => e.stopPropagation()}>
            <div className="admin-sidebar-header">
              <h2>Subscription Details</h2>
              <button className="admin-sidebar-close" onClick={() => setSelectedSubscriptionId(null)}>
                &times;
              </button>
            </div>
            <div className="admin-sidebar-content">
              {detailLoading ? (
                <ContentSkeleton />
              ) : detail ? (
                <div>
                  {/* Subscriber Info */}
                  <div className="admin-detail-section">
                    <h3>Subscriber</h3>
                    <dl className="admin-detail-list">
                      <dt>Email</dt>
                      <dd>{detail.subscriber.email}</dd>
                      <dt>Joined</dt>
                      <dd>{formatDate(detail.subscriber.joinedAt)}</dd>
                      <dt>Total Spent</dt>
                      <dd>{formatCurrency(detail.subscriber.totalSpentCents, detail.subscription.currency)}</dd>
                      <dt>Total Payments</dt>
                      <dd>{detail.subscriber.totalPayments}</dd>
                    </dl>
                  </div>

                  {/* Quick Actions */}
                  <div className="admin-detail-section" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '20px' }}>
                    <h3>Quick Actions</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
                      {detail.subscription.status === 'active' && (
                        <>
                          <button
                            className="admin-btn admin-btn-secondary"
                            onClick={() => handlePause(detail.subscription.id)}
                            disabled={pauseMutation.isPending}
                          >
                            {pauseMutation.isPending ? 'Pausing...' : 'Pause Subscription'}
                          </button>
                          <button
                            className="admin-btn admin-btn-danger"
                            onClick={() => setCancelModal({
                              id: detail.subscription.id,
                              email: detail.subscriber.email,
                            })}
                          >
                            Cancel Subscription
                          </button>
                        </>
                      )}
                      {detail.subscription.status === 'paused' && (
                        <button
                          className="admin-btn admin-btn-primary"
                          onClick={() => handleResume(detail.subscription.id)}
                          disabled={resumeMutation.isPending}
                        >
                          {resumeMutation.isPending ? 'Resuming...' : 'Resume Subscription'}
                        </button>
                      )}
                      {lastSuccessfulPayment && (
                        <button
                          className="admin-btn admin-btn-secondary"
                          onClick={() => setRefundModal({
                            paymentId: lastSuccessfulPayment.id,
                            amount: lastSuccessfulPayment.grossCents,
                            currency: lastSuccessfulPayment.currency,
                          })}
                        >
                          Refund Last Payment ({formatCurrency(lastSuccessfulPayment.grossCents, lastSuccessfulPayment.currency)})
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Subscription Info */}
                  <div className="admin-detail-section">
                    <h3>Subscription</h3>
                    <dl className="admin-detail-list">
                      <dt>Creator</dt>
                      <dd>@{detail.creator.username || detail.creator.email}</dd>
                      <dt>Amount</dt>
                      <dd>{formatCurrency(detail.subscription.amount, detail.subscription.currency)}/{detail.subscription.interval}</dd>
                      <dt>Status</dt>
                      <dd>
                        <span className={`admin-badge ${getStatusBadge(detail.subscription.status)}`}>
                          {detail.subscription.status}
                        </span>
                        {detail.subscription.cancelAtPeriodEnd && (
                          <span style={{ marginLeft: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                            (cancels at period end)
                          </span>
                        )}
                      </dd>
                      <dt>LTV</dt>
                      <dd>{formatCurrency(detail.subscription.ltvCents, detail.subscription.currency)}</dd>
                      <dt>Created</dt>
                      <dd>{formatDate(detail.subscription.createdAt)}</dd>
                      {detail.subscription.currentPeriodEnd && (
                        <>
                          <dt>Next Billing</dt>
                          <dd>{formatDate(detail.subscription.currentPeriodEnd)}</dd>
                        </>
                      )}
                      <dt>Provider</dt>
                      <dd>{detail.subscription.stripeSubscriptionId ? 'Stripe' : detail.subscription.paystackAuthorizationCode ? 'Paystack' : 'Unknown'}</dd>
                    </dl>
                  </div>

                  {/* Payment History */}
                  <div className="admin-detail-section">
                    <h3>Payment History</h3>
                    {detail.payments.length > 0 ? (
                      <table className="admin-table admin-table-compact" style={{ marginTop: '12px' }}>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Amount</th>
                            <th>Status</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.payments.map(p => (
                            <tr key={p.id}>
                              <td style={{ fontSize: '12px' }}>{formatDateTime(p.occurredAt)}</td>
                              <td>{formatCurrency(p.grossCents, p.currency)}</td>
                              <td>
                                <span className={`admin-badge ${getStatusBadge(p.status)}`}>
                                  {p.status}
                                </span>
                              </td>
                              <td>
                                {p.status === 'succeeded' && (
                                  <button
                                    className="admin-link"
                                    style={{ fontSize: '12px' }}
                                    onClick={() => setRefundModal({
                                      paymentId: p.id,
                                      amount: p.grossCents,
                                      currency: p.currency,
                                    })}
                                  >
                                    Refund
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginTop: '12px' }}>
                        No payments yet
                      </p>
                    )}
                  </div>

                  {/* Other Subscriptions */}
                  {detail.otherSubscriptions.length > 0 && (
                    <div className="admin-detail-section">
                      <h3>Other Active Subscriptions</h3>
                      <ul style={{ marginTop: '12px', paddingLeft: '20px' }}>
                        {detail.otherSubscriptions.map(s => (
                          <li key={s.id} style={{ marginBottom: '8px' }}>
                            <button
                              className="admin-link"
                              onClick={() => setSelectedSubscriptionId(s.id)}
                            >
                              @{s.creatorUsername || s.creatorDisplayName}
                            </button>
                            <span style={{ marginLeft: '8px', color: 'var(--text-secondary)' }}>
                              {formatCurrency(s.amount, s.currency)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <p>Subscription not found</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {cancelModal && (
        <div className="admin-modal-overlay" onClick={() => setCancelModal(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h2 className="admin-modal-title">Cancel Subscription</h2>
            </div>
            <div className="admin-modal-body">
              <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
                Cancel subscription for {cancelModal.email}?
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={cancelImmediate}
                  onChange={(e) => setCancelImmediate(e.target.checked)}
                />
                <span style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                  Cancel immediately (otherwise ends at period end)
                </span>
              </label>
            </div>
            <div className="admin-modal-footer">
              <button
                className="admin-btn admin-btn-secondary"
                onClick={() => setCancelModal(null)}
                disabled={cancelMutation.isPending}
              >
                Keep Active
              </button>
              <button
                className="admin-btn admin-btn-danger"
                onClick={handleCancel}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? 'Canceling...' : 'Cancel Subscription'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Refund Modal */}
      {refundModal && (
        <ActionModal
          title="Refund Payment"
          message={`Refund ${formatCurrency(refundModal.amount, refundModal.currency)} to the subscriber?`}
          confirmLabel="Process Refund"
          confirmVariant="danger"
          inputLabel="Reason (optional)"
          inputPlaceholder="Enter reason for refund..."
          loading={refundMutation.isPending}
          onConfirm={handleRefund}
          onCancel={() => setRefundModal(null)}
        />
      )}
    </div>
  )
}
