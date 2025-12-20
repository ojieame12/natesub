/**
 * Payments - Payment management page with search, filtering, and refunds
 */

import { useState } from 'react'
import { useAdminPayments, useAdminRefund, useExportPayments, downloadCSV } from '../api'
import { formatCurrency, formatDateTime } from '../utils/format'
import FilterBar from '../components/FilterBar'
import Pagination from '../components/Pagination'
import ActionModal from '../components/ActionModal'

function getStatusBadge(status: string): string {
  switch (status) {
    case 'succeeded': return 'success'
    case 'failed': return 'error'
    case 'refunded': return 'warning'
    case 'disputed': return 'error'
    case 'pending': return 'info'
    default: return 'neutral'
  }
}

export default function Payments() {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const limit = 50

  const [refundModal, setRefundModal] = useState<{
    paymentId: string
    creatorEmail: string
    amount: number
    currency: string
  } | null>(null)

  // Debounce search
  const handleSearchChange = (value: string) => {
    setSearch(value)
    const timer = setTimeout(() => {
      setDebouncedSearch(value)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }

  const { data, isLoading, error, refetch } = useAdminPayments({
    search: debouncedSearch || undefined,
    status: status !== 'all' ? status : undefined,
    page,
    limit,
  })

  const refundMutation = useAdminRefund()
  const exportMutation = useExportPayments()

  const handleExport = async () => {
    try {
      const result = await exportMutation.mutateAsync({
        status: status !== 'all' ? status : undefined,
        limit: 10000,
      })
      downloadCSV(result.csv, result.filename)
    } catch (err) {
      console.error('Export failed:', err)
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

  // Error state
  if (error) {
    return (
      <div>
        <h1 className="admin-page-title">Payments</h1>
        <div className="admin-alert admin-alert-error" style={{ marginBottom: 16 }}>
          Failed to load payments: {error.message}
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
        <h1 className="admin-page-title" style={{ margin: 0 }}>Payments</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="admin-btn admin-btn-secondary"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            className="admin-btn admin-btn-secondary"
            onClick={handleExport}
            disabled={exportMutation.isPending}
          >
            {exportMutation.isPending ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
      </div>

      <FilterBar
        searchValue={search}
        onSearchChange={handleSearchChange}
        searchPlaceholder="Search by email, username, or payment ID..."
        filters={[
          {
            name: 'status',
            value: status,
            options: [
              { value: 'all', label: 'All Status' },
              { value: 'succeeded', label: 'Succeeded' },
              { value: 'failed', label: 'Failed' },
              { value: 'refunded', label: 'Refunded' },
              { value: 'disputed', label: 'Disputed' },
            ],
            onChange: (v) => { setStatus(v); setPage(1) },
          },
        ]}
        onClear={clearFilters}
      />

      {debouncedSearch && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Searching for "{debouncedSearch}"...
        </div>
      )}

      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Creator</th>
              <th>Subscriber</th>
              <th>Gross</th>
              <th>Fee</th>
              <th>Net</th>
              <th>Status</th>
              <th>Provider</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: '32px' }}>Loading...</td></tr>
            ) : data?.payments?.length ? (
              data.payments.map((payment) => (
                <tr key={payment.id}>
                  <td>
                    <span
                      style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--accent-primary)', cursor: 'pointer' }}
                      onClick={() => navigator.clipboard.writeText(payment.id)}
                      title="Click to copy full ID"
                    >
                      {payment.id.slice(0, 8)}...
                    </span>
                  </td>
                  <td>
                    {payment.creator.username ? (
                      <span
                        style={{ color: 'var(--accent-primary)', cursor: 'pointer' }}
                        onClick={() => window.open(`/${payment.creator.username}`, '_blank')}
                        title="View creator page"
                      >
                        @{payment.creator.username}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {payment.creator.email}
                      </span>
                    )}
                  </td>
                  <td>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {payment.subscriber.email}
                    </span>
                  </td>
                  <td style={{ fontWeight: 500 }}>{formatCurrency(payment.grossCents, payment.currency)}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{formatCurrency(payment.feeCents, payment.currency)}</td>
                  <td>{formatCurrency(payment.netCents, payment.currency)}</td>
                  <td>
                    <span className={`admin-badge ${getStatusBadge(payment.status)}`}>
                      {payment.status}
                    </span>
                  </td>
                  <td>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {payment.provider}
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>{formatDateTime(payment.occurredAt || payment.createdAt)}</td>
                  <td>
                    {payment.status === 'succeeded' && (
                      <button
                        className="admin-btn admin-btn-danger admin-btn-small"
                        onClick={() => setRefundModal({
                          paymentId: payment.id,
                          creatorEmail: payment.creator.email,
                          amount: payment.grossCents,
                          currency: payment.currency,
                        })}
                      >
                        Refund
                      </button>
                    )}
                    {payment.status === 'failed' && (
                      <span style={{ fontSize: 11, color: 'var(--error)' }}>
                        Failed
                      </span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '32px' }}>
                  {debouncedSearch ? `No payments found matching "${debouncedSearch}"` : 'No payments found'}
                </td>
              </tr>
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

      {/* Refund Modal */}
      {refundModal && (
        <ActionModal
          title="Issue Refund"
          message={`Refund ${formatCurrency(refundModal.amount, refundModal.currency)} to subscriber? This will reverse the payment for ${refundModal.creatorEmail}.`}
          confirmLabel="Issue Refund"
          confirmVariant="danger"
          inputLabel="Reason"
          inputPlaceholder="Enter reason for refund..."
          inputRequired
          loading={refundMutation.isPending}
          onConfirm={handleRefund}
          onCancel={() => setRefundModal(null)}
        />
      )}
    </div>
  )
}
