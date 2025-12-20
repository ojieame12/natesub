/**
 * Reminders - Scheduled reminders viewer
 */

import { useState } from 'react'
import { useAdminReminders, useAdminRemindersStats } from '../api'
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

function getStatusBadge(status: string): string {
  switch (status) {
    case 'sent': return 'success'
    case 'scheduled': return 'info'
    case 'failed': return 'error'
    case 'canceled': return 'neutral'
    default: return 'neutral'
  }
}

export default function Reminders() {
  const [status, setStatus] = useState('all')
  const [type, setType] = useState('all')
  const [page, setPage] = useState(1)
  const limit = 50

  const { data: stats, isLoading: statsLoading } = useAdminRemindersStats()
  const { data, isLoading } = useAdminReminders({
    status: status !== 'all' ? status : undefined,
    type: type !== 'all' ? type : undefined,
    page,
    limit,
  })

  const clearFilters = () => {
    setStatus('all')
    setType('all')
    setPage(1)
  }

  return (
    <div>
      <h1 className="admin-page-title">Reminders</h1>

      {/* Stats */}
      <div className="admin-stats-grid">
        <StatCard
          label="Scheduled"
          value={stats?.scheduled ?? '---'}
          loading={statsLoading}
        />
        <StatCard
          label="Sent Today"
          value={stats?.sentToday ?? '---'}
          variant="success"
          loading={statsLoading}
        />
        <StatCard
          label="Failed"
          value={stats?.failed ?? '---'}
          variant={stats?.failed && stats.failed > 0 ? 'error' : 'default'}
          loading={statsLoading}
        />
        <StatCard
          label="Next 24h"
          value={stats?.upcomingNext24h ?? '---'}
          loading={statsLoading}
        />
      </div>

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
              { value: 'scheduled', label: 'Scheduled' },
              { value: 'sent', label: 'Sent' },
              { value: 'failed', label: 'Failed' },
              { value: 'canceled', label: 'Canceled' },
            ],
            onChange: (v) => { setStatus(v); setPage(1) },
          },
          {
            name: 'type',
            value: type,
            options: [
              { value: 'all', label: 'All Types' },
              { value: 'payment_reminder', label: 'Payment Reminder' },
              { value: 'subscription_renewal', label: 'Renewal' },
              { value: 'request_followup', label: 'Request Followup' },
            ],
            onChange: (v) => { setType(v); setPage(1) },
          },
        ]}
        onClear={clearFilters}
      />

      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Channel</th>
              <th>Status</th>
              <th>Scheduled For</th>
              <th>Sent At</th>
              <th>Retries</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px' }}>Loading...</td></tr>
            ) : data?.reminders?.length ? (
              data.reminders.map((reminder) => (
                <tr key={reminder.id}>
                  <td>{reminder.type}</td>
                  <td>{reminder.channel}</td>
                  <td>
                    <span className={`admin-badge ${getStatusBadge(reminder.status)}`}>
                      {reminder.status}
                    </span>
                  </td>
                  <td>{formatDate(reminder.scheduledFor)}</td>
                  <td>{reminder.sentAt ? formatDate(reminder.sentAt) : '-'}</td>
                  <td>{reminder.retryCount}</td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '32px' }}>No reminders found</td></tr>
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
