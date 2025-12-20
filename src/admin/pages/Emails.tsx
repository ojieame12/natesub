/**
 * Emails - Email log viewer
 */

import { useState } from 'react'
import { useAdminEmails } from '../api'
import FilterBar from '../components/FilterBar'
import Pagination from '../components/Pagination'

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function Emails() {
  const [status, setStatus] = useState('all')
  const [template, setTemplate] = useState('all')
  const [page, setPage] = useState(1)
  const limit = 100

  const { data, isLoading } = useAdminEmails({
    status: status !== 'all' ? status : undefined,
    template: template !== 'all' ? template : undefined,
    page,
    limit,
  })

  const clearFilters = () => {
    setStatus('all')
    setTemplate('all')
    setPage(1)
  }

  return (
    <div>
      <h1 className="admin-page-title">Email Logs</h1>

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
              { value: 'sent', label: 'Sent' },
              { value: 'failed', label: 'Failed' },
            ],
            onChange: (v) => { setStatus(v); setPage(1) },
          },
          {
            name: 'template',
            value: template,
            options: [
              { value: 'all', label: 'All Templates' },
              { value: 'new_subscriber', label: 'New Subscriber' },
              { value: 'update', label: 'Update' },
              { value: 'welcome', label: 'Welcome' },
              { value: 'request', label: 'Request' },
              { value: 'payment_receipt', label: 'Payment Receipt' },
            ],
            onChange: (v) => { setTemplate(v); setPage(1) },
          },
        ]}
        onClear={clearFilters}
      />

      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>To</th>
              <th>Subject</th>
              <th>Template</th>
              <th>Message ID</th>
              <th>Sent At</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px' }}>Loading...</td></tr>
            ) : data?.emails?.length ? (
              data.emails.map((email) => (
                <tr key={email.id}>
                  <td>
                    <span className={`admin-badge ${email.status === 'sent' ? 'success' : 'error'}`}>
                      {email.status}
                    </span>
                  </td>
                  <td>{email.to}</td>
                  <td style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {email.subject}
                  </td>
                  <td>{email.template}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                    {typeof email.messageId === 'string' ? `${email.messageId.slice(0, 16)}...` : '-'}
                  </td>
                  <td>{formatDate(email.createdAt)}</td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px' }}>No emails found</td></tr>
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
