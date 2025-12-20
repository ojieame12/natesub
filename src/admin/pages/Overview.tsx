/**
 * Overview - Admin dashboard home with KPIs and quick actions
 */

import { useAdminDashboard, useAdminRevenueOverview, useAdminActivity } from '../api'
import { formatCurrency, formatNumber } from '../utils/format'
import StatCard from '../components/StatCard'

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export default function Overview() {
  const { data: dashboard, isLoading: dashboardLoading, error: dashboardError, refetch: refetchDashboard } = useAdminDashboard()
  const { data: revenue, isLoading: revenueLoading, error: revenueError, refetch: refetchRevenue } = useAdminRevenueOverview()
  const { data: activityData, isLoading: activityLoading, refetch: refetchActivity } = useAdminActivity({ limit: 10 })

  const loading = dashboardLoading || revenueLoading
  const hasError = dashboardError || revenueError
  const freshness = revenue?.freshness

  const handleRefresh = () => {
    refetchDashboard()
    refetchRevenue()
    refetchActivity()
  }

  // Error state
  if (hasError) {
    return (
      <div>
        <h1 className="admin-page-title">Overview</h1>
        <div className="admin-alert admin-alert-error" style={{ marginBottom: 16 }}>
          Failed to load dashboard data: {(dashboardError || revenueError)?.message}
        </div>
        <button className="admin-btn admin-btn-primary" onClick={handleRefresh}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <h1 className="admin-page-title" style={{ margin: 0 }}>Overview</h1>
        <button
          className="admin-btn admin-btn-secondary"
          onClick={handleRefresh}
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {freshness && (
        <p className="admin-page-subtitle" style={{ marginTop: 8 }}>
          Last payment: {freshness.lastPaymentAt ? timeAgo(freshness.lastPaymentAt) : 'never'} ·
          Last webhook: {freshness.lastWebhookProcessedAt ? timeAgo(freshness.lastWebhookProcessedAt) : 'never'}
          {freshness.lastWebhookProvider && ` (${freshness.lastWebhookProvider})`}
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
          subtext="Total subscriber payments"
          loading={loading}
        />
        <StatCard
          label="Total Users"
          value={dashboard ? formatNumber(dashboard.users.total) : '---'}
          subtext={dashboard ? `+${dashboard.users.newToday} today, +${dashboard.users.newThisMonth} this month` : undefined}
          loading={loading}
        />
        <StatCard
          label="Active Subscriptions"
          value={dashboard ? formatNumber(dashboard.subscriptions.active) : '---'}
          loading={loading}
        />
        <StatCard
          label="Failed Payments (24h)"
          value={dashboard ? formatNumber(dashboard.flags.failedPaymentsToday) : '---'}
          variant={dashboard && dashboard.flags.failedPaymentsToday > 5 ? 'error' : 'default'}
          loading={loading}
        />
        <StatCard
          label="Active Disputes"
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
            label="All Time Platform Revenue"
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
          <a href="/admin/users" className="admin-btn admin-btn-secondary">Manage Users</a>
          <a href="/admin/payments" className="admin-btn admin-btn-secondary">View Payments</a>
          <a href="/admin/subscriptions" className="admin-btn admin-btn-secondary">Subscriptions</a>
          <a href="/admin/revenue" className="admin-btn admin-btn-secondary">Revenue Details</a>
          <a href="/admin/stripe" className="admin-btn admin-btn-secondary">Stripe Connect</a>
          <a href="/admin/operations" className="admin-btn admin-btn-secondary">Operations</a>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="admin-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 className="admin-section-title" style={{ margin: 0 }}>Recent Admin Activity</h2>
          <a href="/admin/logs" style={{ fontSize: 13, color: 'var(--accent-primary)' }}>View all logs →</a>
        </div>
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
                  {activity.adminEmail && <span style={{ fontWeight: 500 }}>{activity.adminEmail}</span>}
                  {activity.adminEmail && ' · '}
                  {timeAgo(activity.createdAt)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="admin-activity-list">
            <div className="admin-empty">
              <div className="admin-empty-text">No admin activity recorded yet</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
