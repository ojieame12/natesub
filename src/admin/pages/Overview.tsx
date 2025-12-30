/**
 * Overview - Admin dashboard home with KPIs and quick actions
 * Uses single dashboard endpoint for all metrics (3 → 2 API calls)
 *
 * Design: USD-primary display with collapsible currency breakdown
 */

import { useState } from 'react'
import { useAdminDashboard, useAdminActivity } from '../api'
import { formatCurrency, formatNumber } from '../utils/format'
import StatCard from '../components/StatCard'
import { Link } from 'react-router-dom'
import { SkeletonList } from '../../components/Skeleton'
import { ChevronDown, ChevronUp } from 'lucide-react'

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

/** Format exchange rate for display (e.g., "1 USD = ₦1,450") */
function formatExchangeRate(rate: number | null, currency: string): string {
  if (!rate || currency === 'USD') return '—'
  // Rate is stored as local currency per USD cent (so multiply by 100 for dollars)
  const symbol = currency === 'NGN' ? '₦' : currency === 'KES' ? 'KSh' : currency === 'GHS' ? '₵' : currency === 'ZAR' ? 'R' : currency
  return `1 USD = ${symbol}${formatNumber(Math.round(rate))}`
}

/** Format date as "Dec 18" */
function formatShortDate(dateStr: string | null): string {
  if (!dateStr) return 'unknown'
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function Overview() {
  const { data: dashboard, isLoading: dashboardLoading, error: dashboardError, refetch: refetchDashboard } = useAdminDashboard()
  const { data: activityData, isLoading: activityLoading, refetch: refetchActivity } = useAdminActivity({ limit: 10 })
  const [showCurrencyBreakdown, setShowCurrencyBreakdown] = useState(false)

  const loading = dashboardLoading
  const freshness = dashboard?.freshness
  const revenue = dashboard?.revenue
  const usd = revenue?.usdEquivalent

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

  // Get currency count for subtext
  const mtdCurrencyCount = revenue?.thisMonthCurrencies?.length || 0
  const allTimeCurrencyCount = revenue?.currencies?.length || 0
  const latestRateAt = usd?.latestRateAt
  const adjustments = revenue?.adjustments

  // Build subtext: "X payments · Y currencies · rates as of Dec 18"
  const buildSubtext = (count: number, currencyCount: number, showRates = false): string => {
    const parts = [`${formatNumber(count)} payments`]
    if (currencyCount > 1) parts.push(`${currencyCount} currencies`)
    if (showRates && latestRateAt && currencyCount > 1) parts.push(`rates as of ${formatShortDate(latestRateAt)}`)
    return parts.join(' · ')
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

      {/* KPI Cards - Always show USD equivalent as primary */}
      <div className="admin-stats-grid">
        <StatCard
          label="Platform Revenue (MTD)"
          value={usd ? formatCurrency(usd.thisMonthFeesUsdCents, 'USD') : '---'}
          subtext={buildSubtext(revenue?.thisMonthPaymentCount || 0, mtdCurrencyCount, true)}
          variant="success"
          loading={loading}
        />
        <StatCard
          label="Volume Processed (MTD)"
          value={usd ? formatCurrency(usd.thisMonthVolumeUsdCents, 'USD') : '---'}
          subtext={buildSubtext(revenue?.thisMonthPaymentCount || 0, mtdCurrencyCount)}
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

      {/* All Time Revenue - Simple USD display */}
      <div className="admin-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 className="admin-section-title" style={{ margin: 0 }}>All Time</h2>
          <Link to="/admin/revenue" style={{ fontSize: 13, color: 'var(--accent-primary)' }}>View detailed breakdown →</Link>
        </div>
        <div className="admin-stats-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <StatCard
            label="Total Platform Revenue"
            value={usd ? formatCurrency(usd.totalFeesUsdCents, 'USD') : '---'}
            subtext={buildSubtext(revenue?.paymentCount || 0, allTimeCurrencyCount, true) +
              (adjustments?.totalAdjustmentsUsdCents ? ' · gross' : '')}
            loading={loading}
          />
          <StatCard
            label="Total Volume Processed"
            value={usd ? formatCurrency(usd.totalVolumeUsdCents, 'USD') : '---'}
            subtext={allTimeCurrencyCount > 1 ? 'gross · converted at historical rates' : 'gross subscriber payments'}
            loading={loading}
          />
        </div>

        {/* Adjustments annotation (refunds/disputes) - shown separately from gross totals */}
        {adjustments && adjustments.totalAdjustmentsUsdCents > 0 && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--bg-secondary, #f9fafb)', borderRadius: 6, fontSize: 13 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Adjustments (not in totals above): </span>
            <span style={{ color: 'var(--text-primary)' }}>
              {formatCurrency(adjustments.refundsUsdCents, 'USD')} refunded ({adjustments.refundsCount})
              {adjustments.disputesCount > 0 && `, ${formatCurrency(adjustments.disputesUsdCents, 'USD')} disputed (${adjustments.disputesCount})`}
            </span>
            <span style={{ color: 'var(--text-tertiary)', marginLeft: 8 }}>
              · Net: {formatCurrency((usd?.totalFeesUsdCents || 0) - adjustments.totalAdjustmentsUsdCents, 'USD')}
            </span>
          </div>
        )}
      </div>

      {/* Collapsible Currency Breakdown - only show if multi-currency */}
      {revenue?.isMultiCurrency && (
        <div className="admin-section" style={{ paddingTop: 0 }}>
          <button
            onClick={() => setShowCurrencyBreakdown(!showCurrencyBreakdown)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'none',
              border: 'none',
              padding: '8px 0',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--text-secondary)',
            }}
          >
            {showCurrencyBreakdown ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            Currency Breakdown
          </button>

          {showCurrencyBreakdown && (
            <div style={{ marginTop: 8 }}>
              <div className="admin-table-container">
                <table className="admin-table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Currency</th>
                      <th style={{ textAlign: 'right' }}>Original Amount</th>
                      <th style={{ textAlign: 'right' }}>USD Equiv</th>
                      <th>Weighted Rate</th>
                      <th style={{ textAlign: 'right' }}>Payments</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenue.currencies.map(currency => {
                      const data = revenue.byCurrency[currency]
                      const hasFxData = data?.weightedExchangeRate !== null
                      // Use stored USD equivalent, or show "—" if missing
                      const usdEquiv = currency === 'USD' ? data?.feeCents : data?.usdEquivCents
                      return (
                        <tr key={currency}>
                          <td style={{ fontWeight: 500 }}>{currency}</td>
                          <td style={{ textAlign: 'right' }}>{formatCurrency(data?.feeCents || 0, currency)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                            {currency === 'USD' ? '—' : (hasFxData ? formatCurrency(usdEquiv || 0, 'USD') : '—')}
                          </td>
                          <td style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                            {hasFxData ? formatExchangeRate(data?.weightedExchangeRate || null, currency) : '—'}
                            {data?.missingFxCount ? ` (${data.missingFxCount} missing)` : ''}
                          </td>
                          <td style={{ textAlign: 'right' }}>{formatNumber(data?.paymentCount || 0)}</td>
                        </tr>
                      )
                    })}
                    {/* Total row */}
                    <tr style={{ borderTop: '2px solid var(--border-secondary)', fontWeight: 600 }}>
                      <td>Total (USD)</td>
                      <td style={{ textAlign: 'right' }}>—</td>
                      <td style={{ textAlign: 'right' }}>{formatCurrency(usd?.totalFeesUsdCents || 0, 'USD')}</td>
                      <td></td>
                      <td style={{ textAlign: 'right' }}>{formatNumber(revenue.paymentCount)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {/* Notes about data quality */}
              {usd?.hasEstimatedRates && (
                <p style={{ fontSize: 11, color: 'var(--text-warning, #f59e0b)', marginTop: 8 }}>
                  {usd.estimatedPaymentCount} payment(s) use estimated FX rates (backfilled)
                </p>
              )}
              {latestRateAt && (
                <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  Rates are weighted averages by transaction volume · Last rate: {formatShortDate(latestRateAt)}
                </p>
              )}
            </div>
          )}
        </div>
      )}

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
