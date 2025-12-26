/**
 * Revenue - Revenue analytics page with charts
 * Uses /admin/revenue/all endpoint for single-request data fetching (7 calls → 1)
 */

import { useState } from 'react'
import { useAdminRevenueAll, type RevenueOverview } from '../api'
import { formatCurrency, formatNumber, formatDateTime } from '../utils/format'
import StatCard from '../components/StatCard'
import { AdminLineChart, AdminBarChart, AdminPieChart } from '../components/AdminChart'
import { SkeletonTableRows } from '../components/SkeletonTableRows'

type Period = 'today' | 'week' | 'month' | 'year' | 'all'
type TimePeriod = 'allTime' | 'thisMonth' | 'lastMonth' | 'today'

function formatCompactCurrency(cents: number): string {
  const amount = cents / 100
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`
  if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}K`
  return `$${amount.toFixed(0)}`
}

/** Format revenue with currency awareness for a specific period */
function formatPeriodRevenue(
  overview: RevenueOverview | undefined,
  period: TimePeriod,
  field: 'platformFeeCents' | 'totalVolumeCents'
): string {
  if (!overview) return '---'

  const byCurrency = overview.byCurrency?.[period]
  const currencyMeta = overview.currencies?.[period]

  // If no per-currency data, fall back to totals (mixed currency warning)
  if (!byCurrency || !currencyMeta?.currencies?.length) {
    return formatCurrency(overview[period][field])
  }

  // Single currency: format with correct symbol
  if (currencyMeta.currencies.length === 1) {
    const currency = currencyMeta.currencies[0]
    return formatCurrency(byCurrency[currency]?.[field] || 0, currency)
  }

  // Multiple currencies: show each one
  return currencyMeta.currencies
    .map(c => formatCurrency(byCurrency[c]?.[field] || 0, c))
    .join(' + ')
}

/** Get subtext for multi-currency period */
function getPeriodSubtext(
  overview: RevenueOverview | undefined,
  period: TimePeriod
): string | undefined {
  if (!overview) return undefined
  const count = overview[period].paymentCount
  const isMulti = overview.currencies?.[period]?.isMultiCurrency
  return `${formatNumber(count)} payments${isMulti ? ' (multi-currency)' : ''}`
}

export default function Revenue() {
  const [period, setPeriod] = useState<Period>('month')

  // Single API call for all revenue data
  const { data, isLoading, error, refetch } = useAdminRevenueAll(period, 30, 12, 10)

  // Extract data from combined response
  const overview = data?.overview
  const byProvider = data?.byProvider
  const byCurrency = data?.byCurrency
  const daily = data?.daily
  const monthly = data?.monthly
  const topCreators = data?.topCreators
  const refunds = data?.refunds

  // Format daily data for chart
  const dailyChartData = daily?.days?.map((d) => ({
    label: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    value: d.feesCents,
  })) || []

  // Format monthly data for chart
  const monthlyChartData = monthly?.months?.map((m) => ({
    label: m.month,
    value: m.feesCents,
  })) || []

  // Format provider data for pie chart
  const providerChartData = byProvider ? [
    { name: 'Stripe', value: byProvider.stripe.platformFeeCents },
    { name: 'Paystack', value: byProvider.paystack.platformFeeCents },
  ].filter(d => d.value > 0) : []

  const freshness = overview?.freshness

  // Error state
  if (error) {
    return (
      <div>
        <h1 className="admin-page-title">Revenue Analytics</h1>
        <div className="admin-error-card">
          <p style={{ color: 'var(--error)', marginBottom: '12px' }}>
            Failed to load revenue data: {error.message}
          </p>
          <button className="admin-btn admin-btn-primary" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="admin-page-title">Revenue Analytics</h1>
      {freshness && (
        <p className="admin-page-subtitle">
          Data freshness ({freshness.businessTimezone || 'UTC'}): last payment {formatDateTime(freshness.lastPaymentAt)} · last webhook processed {formatDateTime(freshness.lastWebhookProcessedAt)}
        </p>
      )}

      {/* Period Selector */}
      <div className="admin-period-selector">
        {(['today', 'week', 'month', 'year', 'all'] as Period[]).map((p) => (
          <button
            key={p}
            className={`admin-period-btn ${period === p ? 'active' : ''}`}
            onClick={() => setPeriod(p)}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      {/* Overview Stats */}
      <div className="admin-stats-grid">
        <StatCard
          label="All-Time Platform Fees"
          value={formatPeriodRevenue(overview, 'allTime', 'platformFeeCents')}
          subtext={getPeriodSubtext(overview, 'allTime')}
          variant="success"
          loading={isLoading}
        />
        <StatCard
          label="This Month"
          value={formatPeriodRevenue(overview, 'thisMonth', 'platformFeeCents')}
          subtext={getPeriodSubtext(overview, 'thisMonth')}
          loading={isLoading}
        />
        <StatCard
          label="Last Month"
          value={formatPeriodRevenue(overview, 'lastMonth', 'platformFeeCents')}
          subtext={getPeriodSubtext(overview, 'lastMonth')}
          loading={isLoading}
        />
        <StatCard
          label="Today"
          value={formatPeriodRevenue(overview, 'today', 'platformFeeCents')}
          subtext={getPeriodSubtext(overview, 'today')}
          loading={isLoading}
        />
      </div>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <AdminLineChart
          title="Daily Revenue (Last 30 Days)"
          data={dailyChartData}
          loading={isLoading}
          formatValue={formatCompactCurrency}
        />
        <AdminBarChart
          title="Monthly Revenue (Last 12 Months)"
          data={monthlyChartData}
          loading={isLoading}
          formatValue={formatCompactCurrency}
        />
      </div>

      {/* Provider Breakdown */}
      <div className="admin-section">
        <h2 className="admin-section-title">Payment Provider Breakdown</h2>
        {overview?.currencies?.allTime?.isMultiCurrency && (
          <p style={{ fontSize: 12, color: 'var(--text-warning, #f59e0b)', marginBottom: 12 }}>
            ⚠️ Totals may mix currencies. See "Revenue by Currency" for accurate breakdown.
          </p>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
          <AdminPieChart
            title="Revenue by Provider"
            data={providerChartData}
            loading={isLoading}
            formatValue={formatCompactCurrency}
          />
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Volume</th>
                  <th>Platform Fees</th>
                  <th>Payments</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <SkeletonTableRows columns={4} rows={2} />
                ) : (
                  <>
                    <tr>
                      <td>Stripe</td>
                      <td>{formatCurrency(byProvider?.stripe.totalVolumeCents || 0)}</td>
                      <td>{formatCurrency(byProvider?.stripe.platformFeeCents || 0)}</td>
                      <td>{formatNumber(byProvider?.stripe.paymentCount || 0)}</td>
                    </tr>
                    <tr>
                      <td>Paystack</td>
                      <td>{formatCurrency(byProvider?.paystack.totalVolumeCents || 0)}</td>
                      <td>{formatCurrency(byProvider?.paystack.platformFeeCents || 0)}</td>
                      <td>{formatNumber(byProvider?.paystack.paymentCount || 0)}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Currency Breakdown - This is the accurate view */}
      <div className="admin-section">
        <h2 className="admin-section-title">Revenue by Currency</h2>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Accurate per-currency totals. Use this for financial reporting.
        </p>
        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Currency</th>
                <th>Volume</th>
                <th>Platform Fees</th>
                <th>Creator Payouts</th>
                <th>Payments</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <SkeletonTableRows columns={5} rows={3} />
              ) : byCurrency?.currencies?.length ? (
                byCurrency.currencies.map((c) => (
                  <tr key={c.currency}>
                    <td>{c.currency}</td>
                    <td>{formatCurrency(c.totalVolumeCents, c.currency)}</td>
                    <td>{formatCurrency(c.platformFeeCents, c.currency)}</td>
                    <td>{formatCurrency(c.creatorPayoutsCents, c.currency)}</td>
                    <td>{formatNumber(c.paymentCount)}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5} style={{ textAlign: 'center' }}>No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Creators */}
      <div className="admin-section">
        <h2 className="admin-section-title">Top Creators</h2>
        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Creator</th>
                <th>Username</th>
                <th>Country</th>
                <th>Volume</th>
                <th>Platform Fee</th>
                <th>Payments</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <SkeletonTableRows columns={6} rows={5} />
              ) : topCreators?.creators?.length ? (
                topCreators.creators.map((c) => (
                  <tr key={c.creatorId}>
                    <td>{c.displayName || c.email || 'Unknown'}</td>
                    <td>{c.username || '-'}</td>
                    <td>{c.country || '-'}</td>
                    <td>{formatCurrency(c.totalVolumeCents)}</td>
                    <td>{formatCurrency(c.platformFeeCents)}</td>
                    <td>{formatNumber(c.paymentCount)}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={6} style={{ textAlign: 'center' }}>No data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Refunds & Disputes */}
      <div className="admin-section">
        <h2 className="admin-section-title">Refunds & Disputes</h2>
        <div className="admin-stats-grid">
          <StatCard
            label="Refunds"
            value={refunds ? formatCurrency(refunds.refunds.totalCents) : '---'}
            subtext={refunds ? `${formatNumber(refunds.refunds.count)} refunds` : undefined}
            variant="warning"
            loading={isLoading}
          />
          <StatCard
            label="Disputes"
            value={refunds ? formatCurrency(refunds.disputes.totalCents) : '---'}
            subtext={refunds ? `${formatNumber(refunds.disputes.count)} disputes` : undefined}
            variant="warning"
            loading={isLoading}
          />
          <StatCard
            label="Chargebacks"
            value={refunds ? formatCurrency(refunds.chargebacks.totalCents) : '---'}
            subtext={refunds ? `${formatNumber(refunds.chargebacks.count)} chargebacks` : undefined}
            variant="error"
            loading={isLoading}
          />
        </div>
      </div>
    </div>
  )
}
