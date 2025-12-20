/**
 * Invoices - Invoice/request tracking
 */

import { useState } from 'react'
import { useAdminInvoices } from '../api'
import { formatCurrency, formatDate } from '../utils/format'
import FilterBar from '../components/FilterBar'
import Pagination from '../components/Pagination'

function getStatusBadge(status: string): string {
  switch (status) {
    case 'paid': return 'success'
    case 'sent': return 'info'
    case 'pending_payment': return 'warning'
    case 'expired': return 'neutral'
    case 'declined': return 'error'
    default: return 'neutral'
  }
}

export default function Invoices() {
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const limit = 50

  const { data, isLoading } = useAdminInvoices({
    status: status !== 'all' ? status : undefined,
    page,
    limit,
  })

  const clearFilters = () => {
    setStatus('all')
    setPage(1)
  }

  return (
    <div>
      <h1 className="admin-page-title">Invoices</h1>

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
              { value: 'draft', label: 'Draft' },
              { value: 'sent', label: 'Sent' },
              { value: 'pending_payment', label: 'Pending Payment' },
              { value: 'paid', label: 'Paid' },
              { value: 'expired', label: 'Expired' },
              { value: 'declined', label: 'Declined' },
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
              <th>Recipient</th>
              <th>Email</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Due Date</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '32px' }}>Loading...</td></tr>
            ) : data?.invoices?.length ? (
              data.invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>{invoice.creator.username || invoice.creator.email}</td>
                  <td>{invoice.recipientName}</td>
                  <td>{invoice.recipientEmail || '-'}</td>
                  <td>{formatCurrency(invoice.amountCents, invoice.currency)}</td>
                  <td>
                    <span className={`admin-badge ${getStatusBadge(invoice.status)}`}>
                      {invoice.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td>{formatDate(invoice.dueDate)}</td>
                  <td>{formatDate(invoice.createdAt)}</td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '32px' }}>No invoices found</td></tr>
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
    </div>
  )
}
