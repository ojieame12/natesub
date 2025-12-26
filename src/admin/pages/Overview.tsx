/**
 * Overview - Admin dashboard home with KPIs and quick actions
 * Uses single dashboard endpoint for all metrics (3 → 2 API calls)
 */

import { useAdminDashboard, useAdminActivity, type CurrencyRevenue } from '../api'
import { formatCurrency, formatNumber } from '../utils/format'
import StatCard from '../components/StatCard'
import { Link } from 'react-router-dom'
import { SkeletonList } from '../../components/Skeleton'

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

/** Format revenue with currency awareness */
function formatRevenue(
  byCurrency: Record<string, CurrencyRevenue> | undefined,
  field: 'feeCents' | 'volumeCents',
  currencies: string[] | undefined
): string {
  if (!byCurrency || !currencies || currencies.length === 0) return '---'

  // Single currency: format with correct symbol
  if (currencies.length === 1) {
    const currency = currencies[0]
    return formatCurrency(byCurrency[currency]?.[field] || 0, currency)
  }

  // Multiple currencies: show each one
  return currencies
    .map(c => formatCurrency(byCurrency[c]?.[field] || 0, c))
    .join(' + ')
}

/** Get subtext for multi-currency display with optional USD equivalent */
function getRevenueSubtext(
  byCurrency: Record<string, CurrencyRevenue> | undefined,
  isMultiCurrency: boolean | undefined,
  paymentCount: number | undefined,
  usdEquivalentCents?: number
): string | undefined {
  if (!byCurrency) return undefined
  if (isMultiCurrency && usdEquivalentCents) {
    return `≈ ${formatCurrency(usdEquivalentCents, 'USD')} · ${formatNumber(paymentCount || 0)} payments`
  }
  if (isMultiCurrency) {
    return `${formatNumber(paymentCount || 0)} payments (multiple currencies)`
  }
  return `${formatNumber(paymentCount || 0)} payments`
}

export default function Overview() {
  const { data: dashboard, isLoading: dashboardLoading, error: dashboardError, refetch: refetchDashboard } = useAdminDashboard()
  const { data: activityData, isLoading: activityLoading, refetch: refetchActivity } = useAdminActivity({ limit: 10 })

  const loading = dashboardLoading
  const freshness = dashboard?.freshness

  const handleRefresh = () => {
    refetchDashboard()
    refetchActivity()
  }

  // Error state
  if (dashboardError) {
    return (
      <div>
        <h1 className="admin-page-title">Overview</h1>
        <div className="admin-alert admin-alert-error" style={{ marginBottom: 16 }}>
          Failed to load dashboard data: {dashboardError?.message}
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
          value={formatRevenue(dashboard?.revenue.thisMonthByCurrency, 'feeCents', dashboard?.revenue.thisMonthCurrencies)}
          subtext={getRevenueSubtext(dashboard?.revenue.thisMonthByCurrency, dashboard?.revenue.isThisMonthMultiCurrency, dashboard?.revenue.thisMonthPaymentCount, dashboard?.revenue.usdEquivalent?.thisMonthFeesUsdCents)}
          variant="success"
          loading={loading}
        />
        <StatCard
          label="Volume Processed (MTD)"
          value={formatRevenue(dashboard?.revenue.thisMonthByCurrency, 'volumeCents', dashboard?.revenue.thisMonthCurrencies)}
          subtext={dashboard?.revenue.isThisMonthMultiCurrency && dashboard?.revenue.usdEquivalent
            ? `≈ ${formatCurrency(dashboard.revenue.usdEquivalent.thisMonthVolumeUsdCents, 'USD')}`
            : 'Total subscriber payments'}
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 className="admin-section-title" style={{ margin: 0 }}>Revenue Summary</h2>
          <Link to="/admin/revenue" style={{ fontSize: 13, color: 'var(--accent-primary)' }}>View detailed breakdown →</Link>
        </div>
        <div className="admin-stats-grid">
          <StatCard
            label="All Time Platform Revenue"
            value={formatRevenue(dashboard?.revenue.byCurrency, 'feeCents', dashboard?.revenue.currencies)}
            subtext={getRevenueSubtext(dashboard?.revenue.byCurrency, dashboard?.revenue.isMultiCurrency, dashboard?.revenue.paymentCount, dashboard?.revenue.usdEquivalent?.totalFeesUsdCents)}
            loading={loading}
          />
          <StatCard
            label="All Time Volume"
            value={formatRevenue(dashboard?.revenue.byCurrency, 'volumeCents', dashboard?.revenue.currencies)}
            subtext={dashboard?.revenue.isMultiCurrency && dashboard?.revenue.usdEquivalent
              ? `≈ ${formatCurrency(dashboard.revenue.usdEquivalent.totalVolumeUsdCents, 'USD')}`
              : 'Total processed'}
            loading={loading}
          />
        </div>

        {/* Per-currency breakdown when multi-currency */}
        {dashboard?.revenue.isMultiCurrency && (
          <div style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 500, marginBottom: 8, color: 'var(--text-secondary)' }}>By Currency</h3>
            <div className="admin-table-container">
              <table className="admin-table" style={{ fontSize: 13 }}>
                <thead>
                  <tr>
                    <th>Currency</th>
                    <th style={{ textAlign: 'right' }}>Platform Fees</th>
                    <th style={{ textAlign: 'right' }}>Volume</th>
                    <th style={{ textAlign: 'right' }}>Payments</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.revenue.currencies.map(currency => {
                    const data = dashboard.revenue.byCurrency[currency]
                    return (
                      <tr key={currency}>
                        <td>{currency}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(data?.feeCents || 0, currency)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCurrency(data?.volumeCents || 0, currency)}</td>
                        <td style={{ textAlign: 'right' }}>{formatNumber(data?.paymentCount || 0)}</td>
                      </tr>
                    )
                  })}
                  {/* USD equivalent total row */}
                  {dashboard.revenue.usdEquivalent && (
                    <tr style={{ borderTop: '2px solid var(--border-secondary)', fontWeight: 500 }}>
                      <td>≈ USD Total</td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(dashboard.revenue.usdEquivalent.totalFeesUsdCents, 'USD')}</td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(dashboard.revenue.usdEquivalent.totalVolumeUsdCents, 'USD')}</td>
                      <td style={{ textAlign: 'right' }}>{formatNumber(dashboard.revenue.paymentCount)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* Estimated rates note */}
            {dashboard.revenue.usdEquivalent?.hasEstimatedRates && (
              <p style={{ fontSize: 11, color: 'var(--text-warning, #f59e0b)', marginTop: 8 }}>
                {dashboard.revenue.usdEquivalent.estimatedPaymentCount} payment(s) use estimated FX rates (backfilled)
              </p>
            )}
          </div>
        )}
      </div>

      {/* Quick Links */}
      <div className="admin-section">
        <h2 className="admin-section-title">Quick Actions</h2>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <Link to="/admin/users" className="admin-btn admin-btn-secondary">Manage Users</Link>
          <Link to="/admin/payments" className="admin-btn admin-btn-secondary">View Payments</Link>
          <Link to="/admin/subscriptions" className="admin-btn admin-btn-secondary">Subscriptions</Link>
          <Link to="/admin/revenue" className="admin-btn admin-btn-secondary">Revenue Details</Link>
          <Link to="/admin/stripe" className="admin-btn admin-btn-secondary">Stripe Connect</Link>
          <Link to="/admin/ops" className="admin-btn admin-btn-secondary">Operations</Link>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="admin-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 className="admin-section-title" style={{ margin: 0 }}>Recent Admin Activity</h2>
          <Link to="/admin/logs" style={{ fontSize: 13, color: 'var(--accent-primary)' }}>View all logs →</Link>
        </div>
        {activityLoading ? (
          <div className="admin-activity-list">
            <SkeletonList count={5} />
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
