/**
 * Payments - Payment management page with refunds
 */

import { useState } from 'react'
import { useAdminPayments, useAdminRefund } from '../api'
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
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const limit = 50

  const [refundModal, setRefundModal] = useState<{
    paymentId: string
    creatorEmail: string
    amount: number
    currency: string
  } | null>(null)

  const { data, isLoading, refetch } = useAdminPayments({
    status: status !== 'all' ? status : undefined,
    page,
    limit,
  })

  const refundMutation = useAdminRefund()

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
    setStatus('all')
    setPage(1)
  }

  return (
    <div>
      <h1 className="admin-page-title">Payments</h1>

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

      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Creator</th>
              <th>Subscriber</th>
              <th>Amount</th>
              <th>Fee</th>
              <th>Status</th>
              <th>Type</th>
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
                  <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                    {payment.id.slice(0, 8)}...
                  </td>
                  <td>{payment.creator.username || payment.creator.email}</td>
                  <td>{payment.subscriber.email}</td>
                  <td>{formatCurrency(payment.grossCents, payment.currency)}</td>
                  <td>{formatCurrency(payment.feeCents, payment.currency)}</td>
                  <td>
                    <span className={`admin-badge ${getStatusBadge(payment.status)}`}>
                      {payment.status}
                    </span>
                  </td>
                  <td>{payment.type}</td>
                  <td>{payment.provider}</td>
                  <td>{formatDateTime(payment.occurredAt || payment.createdAt)}</td>
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
                  </td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: '32px' }}>No payments found</td></tr>
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
