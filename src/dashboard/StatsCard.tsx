/**
 * StatsCard - Dashboard metrics display (MRR, subscribers, revenue)
 */

import { Clock } from 'lucide-react'
import { Pressable, Skeleton, AnimatedNumber } from '../components'
import { getCurrencySymbol, formatCompactNumber, formatCompactAmount } from '../utils/currency'

interface StatsCardProps {
  loading: boolean
  mrr: number
  subscriberCount: number
  totalRevenue: number
  pendingBalance: number
  displayCurrency: string
  profileCurrency: string
  payoutCurrency: string
  currencyView: 'profile' | 'payout'
  canToggle: boolean
  onToggleCurrency: () => void
}

export function StatsCard({
  loading,
  mrr,
  subscriberCount,
  totalRevenue,
  pendingBalance,
  displayCurrency,
  profileCurrency,
  payoutCurrency,
  currencyView,
  canToggle,
  onToggleCurrency,
}: StatsCardProps) {
  if (loading) {
    return (
      <section className="stats-card">
        <div className="stats-primary">
          <Skeleton width={180} height={14} />
          <Skeleton width={100} height={40} style={{ marginTop: 8 }} />
        </div>
        <div className="stats-secondary-row">
          <div className="stats-metric">
            <Skeleton width={60} height={28} />
            <Skeleton width={80} height={12} style={{ marginTop: 4 }} />
          </div>
          <div className="stats-metric">
            <Skeleton width={60} height={28} />
            <Skeleton width={80} height={12} style={{ marginTop: 4 }} />
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="stats-card">
      {canToggle && (
        <Pressable className="currency-toggle" onClick={onToggleCurrency}>
          <span className={`currency-toggle-option ${currencyView === 'profile' ? 'active' : ''}`}>
            {getCurrencySymbol(profileCurrency)}
          </span>
          <span className={`currency-toggle-option ${currencyView === 'payout' ? 'active' : ''}`}>
            {getCurrencySymbol(payoutCurrency)}
          </span>
        </Pressable>
      )}

      <div className="stats-primary">
        <span className="stats-label">Monthly Recurring Revenue</span>
        <span className="stats-mrr">
          <AnimatedNumber value={mrr} duration={600} format={(n) => formatCompactAmount(n, displayCurrency)} />
        </span>
        {pendingBalance > 0 && (
          <div className="stats-pending">
            <Clock size={12} />
            <span>{formatCompactAmount(pendingBalance, displayCurrency)} pending</span>
          </div>
        )}
      </div>
      <div className="stats-secondary-row">
        <div className="stats-metric">
          <div className="stats-metric-value">
            <AnimatedNumber value={subscriberCount} duration={500} format={(n) => formatCompactNumber(n)} />
          </div>
          <span className="stats-label">
            {subscriberCount === 1 ? 'Subscriber' : 'Subscribers'}
          </span>
        </div>
        <div className="stats-metric">
          <div className="stats-metric-value">
            <AnimatedNumber value={totalRevenue} duration={600} format={(n) => formatCompactAmount(n, displayCurrency)} />
          </div>
          <span className="stats-label">Total Revenue</span>
        </div>
      </div>
    </section>
  )
}
