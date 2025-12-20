/**
 * Logs - System logs viewer
 */

import { Fragment, useState } from 'react'
import { useAdminLogs, useAdminLogsStats } from '../api'
import StatCard from '../components/StatCard'
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

function getLevelBadge(level: string): string {
  switch (level) {
    case 'info': return 'info'
    case 'warning': return 'warning'
    case 'error': return 'error'
    default: return 'neutral'
  }
}

export default function Logs() {
  const [type, setType] = useState('all')
  const [level, setLevel] = useState('all')
  const [page, setPage] = useState(1)
  const [expandedLog, setExpandedLog] = useState<string | null>(null)
  const limit = 100

  const { data: stats, isLoading: statsLoading } = useAdminLogsStats()
  const { data, isLoading } = useAdminLogs({
    type: type !== 'all' ? type : undefined,
    level: level !== 'all' ? level : undefined,
    page,
    limit,
  })

  const clearFilters = () => {
    setType('all')
    setLevel('all')
    setPage(1)
  }

  return (
    <div>
      <h1 className="admin-page-title">System Logs</h1>

      {/* Stats */}
      <div className="admin-stats-grid">
        <StatCard
          label="Emails Sent (24h)"
          value={stats?.last24h.emailsSent ?? '---'}
          variant="success"
          loading={statsLoading}
        />
        <StatCard
          label="Emails Failed (24h)"
          value={stats?.last24h.emailsFailed ?? '---'}
          variant={stats?.last24h.emailsFailed && stats.last24h.emailsFailed > 0 ? 'error' : 'default'}
          loading={statsLoading}
        />
        <StatCard
          label="Reminders Sent (24h)"
          value={stats?.last24h.remindersSent ?? '---'}
          loading={statsLoading}
        />
        <StatCard
          label="Total Errors (24h)"
          value={stats?.last24h.totalErrors ?? '---'}
          variant={stats?.last24h.totalErrors && stats.last24h.totalErrors > 0 ? 'error' : 'default'}
          loading={statsLoading}
        />
      </div>

      {/* Error breakdown */}
      {stats?.errorsByType?.length ? (
        <div className="admin-section">
          <h2 className="admin-section-title">Errors by Type (24h)</h2>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {stats.errorsByType.map((e) => (
              <span key={e.type} className="admin-badge error" style={{ padding: '8px 12px' }}>
                {e.type}: {e.count}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <FilterBar
        searchValue=""
        onSearchChange={() => {}}
        searchPlaceholder=""
        filters={[
          {
            name: 'type',
            value: type,
            options: [
              { value: 'all', label: 'All Types' },
              { value: 'email_sent', label: 'Email Sent' },
              { value: 'email_failed', label: 'Email Failed' },
              { value: 'reminder_sent', label: 'Reminder Sent' },
              { value: 'reminder_failed', label: 'Reminder Failed' },
              { value: 'payment_error', label: 'Payment Error' },
              { value: 'webhook_error', label: 'Webhook Error' },
              { value: 'user_error', label: 'User Error' },
              { value: 'payout_initiated', label: 'Payout Initiated' },
              { value: 'payout_completed', label: 'Payout Completed' },
              { value: 'payout_failed', label: 'Payout Failed' },
            ],
            onChange: (v) => { setType(v); setPage(1) },
          },
          {
            name: 'level',
            value: level,
            options: [
              { value: 'all', label: 'All Levels' },
              { value: 'info', label: 'Info' },
              { value: 'warning', label: 'Warning' },
              { value: 'error', label: 'Error' },
            ],
            onChange: (v) => { setLevel(v); setPage(1) },
          },
        ]}
        onClear={clearFilters}
      />

      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Level</th>
              <th>Message</th>
              <th>User</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '32px' }}>Loading...</td></tr>
            ) : data?.logs?.length ? (
              data.logs.map((log) => (
                <Fragment key={log.id}>
                  <tr
                    onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)}
                    style={{ cursor: log.errorMessage ? 'pointer' : 'default' }}
                  >
                    <td>{log.type}</td>
                    <td>
                      <span className={`admin-badge ${getLevelBadge(log.level)}`}>
                        {log.level}
                      </span>
                    </td>
                    <td style={{ maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {log.message}
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '11px' }}>
                      {log.userId ? `${log.userId.slice(0, 8)}...` : '-'}
                    </td>
                    <td>{formatDate(log.createdAt)}</td>
                  </tr>
                  {expandedLog === log.id && log.errorMessage && (
                    <tr>
                      <td colSpan={5} style={{ background: 'var(--bg-primary)', padding: '16px' }}>
                        <div style={{ fontSize: '12px', fontFamily: 'monospace' }}>
                          <strong>Error:</strong> {log.errorMessage}
                          {log.metadata && (
                            <div style={{ marginTop: '8px' }}>
                              <strong>Metadata:</strong>
                              <pre style={{ margin: '4px 0', padding: '8px', background: 'var(--bg-tertiary)', borderRadius: '4px', overflow: 'auto' }}>
                                {JSON.stringify(log.metadata, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            ) : (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '32px' }}>No logs found</td></tr>
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
