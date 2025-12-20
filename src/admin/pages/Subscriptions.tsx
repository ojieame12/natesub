/**
 * Subscriptions - Subscription management page
 */

import { useState } from 'react'
import { useAdminSubscriptions, useAdminCancelSubscription } from '../api'
import FilterBar from '../components/FilterBar'
import Pagination from '../components/Pagination'

function formatCurrency(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function getStatusBadge(status: string): string {
  switch (status) {
    case 'active': return 'success'
    case 'canceled': return 'neutral'
    case 'past_due': return 'warning'
    case 'unpaid': return 'error'
    default: return 'neutral'
  }
}

export default function Subscriptions() {
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const limit = 50

  const [cancelModal, setCancelModal] = useState<{
    subscriptionId: string
    creatorEmail: string
    subscriberEmail: string
  } | null>(null)
  const [cancelImmediate, setCancelImmediate] = useState(false)

  const { data, isLoading, refetch } = useAdminSubscriptions({
    status: status !== 'all' ? status : undefined,
    page,
    limit,
  })

  const cancelMutation = useAdminCancelSubscription()

  const handleCancel = async () => {
    if (!cancelModal) return
    try {
      await cancelMutation.mutateAsync({
        subscriptionId: cancelModal.subscriptionId,
        immediate: cancelImmediate,
      })
      setCancelModal(null)
      setCancelImmediate(false)
      refetch()
    } catch (err) {
      console.error('Cancel failed:', err)
    }
  }

  const clearFilters = () => {
    setStatus('all')
    setPage(1)
  }

  return (
    <div>
      <h1 className="admin-page-title">Subscriptions</h1>

      <FilterBar
        searchValue=""
        onSearchChange={() => {}}
        searchPlaceholder=""
        filters={[
          {
            name: 'status',
            value: status,
            options: [
              { value: 'all', label: 'All Status' },
              { value: 'active', label: 'Active' },
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
              <th>Creator</th>
              <th>Subscriber</th>
              <th>Amount</th>
              <th>Interval</th>
              <th>Status</th>
              <th>LTV</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '32px' }}>Loading...</td></tr>
            ) : data?.subscriptions?.length ? (
              data.subscriptions.map((sub) => (
                <tr key={sub.id}>
                  <td>{sub.creator.username || sub.creator.email}</td>
                  <td>{sub.subscriber.email}</td>
                  <td>{formatCurrency(sub.amount, sub.currency)}</td>
                  <td>{sub.interval}</td>
                  <td>
                    <span className={`admin-badge ${getStatusBadge(sub.status)}`}>
                      {sub.status}
                    </span>
                  </td>
                  <td>{formatCurrency(sub.ltvCents, sub.currency)}</td>
                  <td>{formatDate(sub.createdAt)}</td>
                  <td>
                    {sub.status === 'active' && (
                      <button
                        className="admin-btn admin-btn-danger admin-btn-small"
                        onClick={() => setCancelModal({
                          subscriptionId: sub.id,
                          creatorEmail: sub.creator.email,
                          subscriberEmail: sub.subscriber.email,
                        })}
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '32px' }}>No subscriptions found</td></tr>
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
          />
        )}
      </div>

      {/* Cancel Modal */}
      {cancelModal && (
        <div className="admin-modal-overlay" onClick={() => setCancelModal(null)}>
          <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h2 className="admin-modal-title">Cancel Subscription</h2>
            </div>
            <div className="admin-modal-body">
              <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
                Cancel subscription from {cancelModal.subscriberEmail} to {cancelModal.creatorEmail}?
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
    </div>
  )
}
