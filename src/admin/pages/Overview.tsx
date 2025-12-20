/**
 * Overview - Admin dashboard home with KPIs
 */

import { useAdminDashboard, useAdminRevenueOverview, useAdminActivity } from '../api'
import StatCard from '../components/StatCard'

function formatCurrency(cents: number, currency = 'USD'): string {
  const amount = cents / 100
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num)
}

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function formatDateTime(date: string | null): string {
  if (!date) return '—'
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function Overview() {
  const { data: dashboard, isLoading: dashboardLoading } = useAdminDashboard()
  const { data: revenue, isLoading: revenueLoading } = useAdminRevenueOverview()
  const { data: activityData, isLoading: activityLoading } = useAdminActivity({ limit: 10 })

  const loading = dashboardLoading || revenueLoading
  const freshness = revenue?.freshness

  return (
    <div>
      <h1 className="admin-page-title">Overview</h1>
      {freshness && (
        <p className="admin-page-subtitle">
          Data freshness ({freshness.businessTimezone || 'UTC'}): last payment {formatDateTime(freshness.lastPaymentAt)} · last webhook processed {formatDateTime(freshness.lastWebhookProcessedAt)}
        </p>
      )}

      {/* KPI Cards */}
      <div className="admin-stats-grid">
        <StatCard
          label="Platform Revenue (MTD)"
          value={revenue ? formatCurrency(revenue.thisMonth.platformFeeCents) : '---'}
          subtext={revenue ? `${formatNumber(revenue.thisMonth.paymentCount)} payments` : undefined}
          variant="success"
          loading={loading}
        />
        <StatCard
          label="Volume Processed (MTD)"
          value={revenue ? formatCurrency(revenue.thisMonth.totalVolumeCents) : '---'}
          subtext="Total payment volume"
          loading={loading}
        />
        <StatCard
          label="Total Users"
          value={dashboard ? formatNumber(dashboard.users.total) : '---'}
          subtext={dashboard ? `+${dashboard.users.newToday} today` : undefined}
          loading={loading}
        />
        <StatCard
          label="Active Subscriptions"
          value={dashboard ? formatNumber(dashboard.subscriptions.active) : '---'}
          loading={loading}
        />
        <StatCard
          label="Errors (24h)"
          value={dashboard ? formatNumber(dashboard.flags.failedPaymentsToday) : '---'}
          variant={dashboard && dashboard.flags.failedPaymentsToday > 5 ? 'error' : 'default'}
          loading={loading}
        />
        <StatCard
          label="Disputes"
          value={dashboard ? formatNumber(dashboard.flags.disputedPayments) : '---'}
          variant={dashboard && dashboard.flags.disputedPayments > 0 ? 'warning' : 'default'}
          loading={loading}
        />
      </div>

      {/* Revenue Summary */}
      <div className="admin-section">
        <h2 className="admin-section-title">Revenue Summary</h2>
        <div className="admin-stats-grid">
          <StatCard
            label="All Time Revenue"
            value={revenue ? formatCurrency(revenue.allTime.platformFeeCents) : '---'}
            subtext={revenue ? `${formatNumber(revenue.allTime.paymentCount)} total payments` : undefined}
            loading={loading}
          />
          <StatCard
            label="Last Month"
            value={revenue ? formatCurrency(revenue.lastMonth.platformFeeCents) : '---'}
            subtext={revenue ? `${formatNumber(revenue.lastMonth.paymentCount)} payments` : undefined}
            loading={loading}
          />
          <StatCard
            label="Today"
            value={revenue ? formatCurrency(revenue.today.platformFeeCents) : '---'}
            subtext={revenue ? `${formatNumber(revenue.today.paymentCount)} payments` : undefined}
            loading={loading}
          />
        </div>
      </div>

      {/* Quick Links */}
      <div className="admin-section">
        <h2 className="admin-section-title">Quick Actions</h2>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <a href="/admin/users" className="admin-btn admin-btn-secondary">View All Users</a>
          <a href="/admin/payments" className="admin-btn admin-btn-secondary">View Payments</a>
          <a href="/admin/revenue" className="admin-btn admin-btn-secondary">Revenue Details</a>
          <a href="/admin/logs" className="admin-btn admin-btn-secondary">System Logs</a>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="admin-section">
        <h2 className="admin-section-title">Recent Admin Activity</h2>
        {activityLoading ? (
          <div className="admin-activity-list">
            <div className="admin-empty">Loading...</div>
          </div>
        ) : activityData?.activities?.length ? (
          <div className="admin-activity-list">
            {activityData.activities.map((activity) => (
              <div key={activity.id} className="admin-activity-item">
                <div className="admin-activity-message">{activity.message}</div>
                <div className="admin-activity-time">
                  {activity.adminEmail} - {timeAgo(activity.createdAt)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="admin-activity-list">
            <div className="admin-empty">
              <div className="admin-empty-text">No admin activity yet</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
