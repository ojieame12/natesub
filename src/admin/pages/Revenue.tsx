/**
 * Revenue - Revenue analytics page with charts
 */

import { useState } from 'react'
import {
  useAdminRevenueOverview,
  useAdminRevenueByProvider,
  useAdminRevenueByCurrency,
  useAdminRevenueDaily,
  useAdminRevenueMonthly,
  useAdminTopCreators,
  useAdminRefundsStats,
} from '../api'
import StatCard from '../components/StatCard'
import { AdminLineChart, AdminBarChart, AdminPieChart } from '../components/AdminChart'

type Period = 'today' | 'week' | 'month' | 'year' | 'all'

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

function formatCompactCurrency(cents: number): string {
  const amount = cents / 100
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`
  if (amount >= 1000) return `$${(amount / 1000).toFixed(0)}K`
  return `$${amount.toFixed(0)}`
}

export default function Revenue() {
  const [period, setPeriod] = useState<Period>('month')

  const { data: overview, isLoading: overviewLoading } = useAdminRevenueOverview()
  const { data: byProvider, isLoading: providerLoading } = useAdminRevenueByProvider(period)
  const { data: byCurrency, isLoading: currencyLoading } = useAdminRevenueByCurrency(period)
  const { data: daily, isLoading: dailyLoading } = useAdminRevenueDaily(30)
  const { data: monthly, isLoading: monthlyLoading } = useAdminRevenueMonthly(12)
  const { data: topCreators, isLoading: creatorsLoading } = useAdminTopCreators(period, 10)
  const { data: refunds, isLoading: refundsLoading } = useAdminRefundsStats(period)

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
          value={overview ? formatCurrency(overview.allTime.platformFeeCents) : '---'}
          subtext={overview ? `${formatNumber(overview.allTime.paymentCount)} payments` : undefined}
          variant="success"
          loading={overviewLoading}
        />
        <StatCard
          label="This Month"
          value={overview ? formatCurrency(overview.thisMonth.platformFeeCents) : '---'}
          subtext={overview ? `${formatNumber(overview.thisMonth.paymentCount)} payments` : undefined}
          loading={overviewLoading}
        />
        <StatCard
          label="Last Month"
          value={overview ? formatCurrency(overview.lastMonth.platformFeeCents) : '---'}
          subtext={overview ? `${formatNumber(overview.lastMonth.paymentCount)} payments` : undefined}
          loading={overviewLoading}
        />
        <StatCard
          label="Today"
          value={overview ? formatCurrency(overview.today.platformFeeCents) : '---'}
          subtext={overview ? `${formatNumber(overview.today.paymentCount)} payments` : undefined}
          loading={overviewLoading}
        />
      </div>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <AdminLineChart
          title="Daily Revenue (Last 30 Days)"
          data={dailyChartData}
          loading={dailyLoading}
          formatValue={formatCompactCurrency}
        />
        <AdminBarChart
          title="Monthly Revenue (Last 12 Months)"
          data={monthlyChartData}
          loading={monthlyLoading}
          formatValue={formatCompactCurrency}
        />
      </div>

      {/* Provider Breakdown */}
      <div className="admin-section">
        <h2 className="admin-section-title">Payment Provider Breakdown</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
          <AdminPieChart
            title="Revenue by Provider"
            data={providerChartData}
            loading={providerLoading}
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
                {providerLoading ? (
                  <tr><td colSpan={4} style={{ textAlign: 'center' }}>Loading...</td></tr>
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

      {/* Currency Breakdown */}
      <div className="admin-section">
        <h2 className="admin-section-title">Revenue by Currency</h2>
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
              {currencyLoading ? (
                <tr><td colSpan={5} style={{ textAlign: 'center' }}>Loading...</td></tr>
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
              {creatorsLoading ? (
                <tr><td colSpan={6} style={{ textAlign: 'center' }}>Loading...</td></tr>
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
            loading={refundsLoading}
          />
          <StatCard
            label="Disputes"
            value={refunds ? formatCurrency(refunds.disputes.totalCents) : '---'}
            subtext={refunds ? `${formatNumber(refunds.disputes.count)} disputes` : undefined}
            variant="warning"
            loading={refundsLoading}
          />
          <StatCard
            label="Chargebacks"
            value={refunds ? formatCurrency(refunds.chargebacks.totalCents) : '---'}
            subtext={refunds ? `${formatNumber(refunds.chargebacks.count)} chargebacks` : undefined}
            variant="error"
            loading={refundsLoading}
          />
        </div>
      </div>
    </div>
  )
}
