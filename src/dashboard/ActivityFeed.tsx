/**
 * ActivityFeed - Dashboard activity list
 */

import { Activity } from 'lucide-react'
import { Pressable, Skeleton, SkeletonList } from '../components'
import { centsToDisplayAmount, getCurrencySymbol, formatCompactNumber } from '../utils/currency'
import { getActivityIcon, getActivityTitle, formatRelativeTime } from './utils'

interface ActivityItem {
  id: string
  type: string
  createdAt: string | Date
  payload?: {
    currency?: string
    amount?: number
    subscriberName?: string
    recipientName?: string
    tierName?: string
  }
}

interface ActivityFeedProps {
  loading: boolean
  activities: ActivityItem[]
  defaultCurrency: string
  onNavigate: (path: string) => void
}

export function ActivityFeed({
  loading,
  activities,
  defaultCurrency,
  onNavigate,
}: ActivityFeedProps) {
  if (loading) {
    return (
      <section className="dash-activity-card">
        <div className="dash-activity-header">
          <Skeleton width={80} height={18} />
          <Skeleton width={60} height={14} />
        </div>
        <SkeletonList count={4} />
      </section>
    )
  }

  return (
    <section className="dash-activity-card">
      <div className="dash-activity-header">
        <span className="dash-activity-title">Activity</span>
        <Pressable className="dash-activity-view-all" onClick={() => onNavigate('/activity')}>
          View All
        </Pressable>
      </div>
      <div className="dash-activity-list">
        {activities.length === 0 ? (
          <div className="dash-activity-empty">
            <div className="dash-activity-empty-icon">
              <Activity size={24} />
            </div>
            <p className="dash-activity-empty-title">No activity yet</p>
            <p className="dash-activity-empty-desc">
              Share your page to get your first subscriber
            </p>
          </div>
        ) : (
          activities.map((activity, index) => {
            const payload = activity.payload || {}
            const currency = (payload.currency || defaultCurrency).toUpperCase()
            const currencySymbol = getCurrencySymbol(currency)
            const amount = payload.amount ? centsToDisplayAmount(payload.amount, currency) : 0
            const name = payload.subscriberName || payload.recipientName || ''
            const tier = payload.tierName || ''
            const isCanceled = activity.type === 'subscription_canceled' || activity.type === 'subscription_canceled_via_manage_page' || activity.type === 'subscription_canceled_via_email'

            return (
              <Pressable
                key={activity.id}
                className="dash-activity-item animate-fade-in-up"
                style={{ animationDelay: `${index * 0.05}s`, animationFillMode: 'both' }}
                onClick={() => onNavigate(`/activity/${activity.id}`)}
              >
                <div className="dash-activity-icon">
                  {getActivityIcon(activity.type)}
                </div>
                <div className="dash-activity-info">
                  <div className="dash-activity-item-title">{getActivityTitle(activity.type)}</div>
                  <div className="dash-activity-item-meta">
                    {formatRelativeTime(activity.createdAt)}{name ? ` - ${name}` : ''}
                  </div>
                </div>
                {amount > 0 && (
                  <div className="dash-activity-amount-col">
                    <span className={`dash-activity-amount ${isCanceled ? 'cancelled' : ''}`}>
                      {isCanceled ? '-' : '+'}{currencySymbol}{formatCompactNumber(amount)}
                    </span>
                    {tier && <span className="dash-activity-tier">{tier}</span>}
                  </div>
                )}
              </Pressable>
            )
          })
        )}
      </div>
    </section>
  )
}
