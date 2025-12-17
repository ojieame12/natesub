import { Bell, ChevronRight, DollarSign, Menu, RefreshCw, Send, UserPlus } from 'lucide-react'
import { Pressable } from '../components'
import { formatCompactNumber, formatSmartAmount, getCurrencySymbol } from '../utils/currency'
import { getShareableLink } from '../utils/constants'
import '../Dashboard.css'

type ActivityType = 'subscription_created' | 'payment_received' | 'request_sent'

const getActivityIcon = (type: ActivityType) => {
  switch (type) {
    case 'subscription_created': return <UserPlus size={18} />
    case 'payment_received': return <DollarSign size={18} />
    case 'request_sent': return <Send size={18} />
    default: return <DollarSign size={18} />
  }
}

const getActivityTitle = (type: ActivityType) => {
  switch (type) {
    case 'subscription_created': return 'New Subscriber'
    case 'payment_received': return 'Payment Received'
    case 'request_sent': return 'Request Sent'
    default: return 'Activity'
  }
}

const noop = () => { }

export default function MockDashboard() {
  const currencyCode = 'NGN'
  const currencySymbol = getCurrencySymbol(currencyCode)

  const metrics = {
    subscriberCount: 128,
    mrr: 12_500_000,
    totalRevenue: 980_000_000,
  }

  const activities = [
    {
      id: 'a1',
      type: 'subscription_created' as const,
      name: 'Ada',
      tier: 'Supporter',
      amount: 25_000,
      createdAt: '2m ago',
    },
    {
      id: 'a2',
      type: 'payment_received' as const,
      name: 'Samuel',
      tier: 'VIP',
      amount: 100_000,
      createdAt: '1h ago',
    },
    {
      id: 'a3',
      type: 'request_sent' as const,
      name: 'Client',
      tier: 'Invoice',
      amount: 250_000,
      createdAt: 'Yesterday',
    },
  ]

  return (
    <div className="dashboard">
      <header className="header glass-header">
        <div className="header-left">
          <Pressable className="header-icon-btn" onClick={noop}>
            <Menu size={20} />
          </Pressable>
        </div>
        <img src="/logo.svg" alt="NatePay" className="header-logo" />
        <div className="header-right">
          <Pressable className="header-icon-btn" onClick={noop}>
            <Bell size={20} />
          </Pressable>
        </div>
      </header>

      <main className="main">
        <section className="stats-card" style={{ height: '220px', padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div className="stats-primary">
            <span className="stats-label" style={{ marginBottom: '0', opacity: 0.8, lineHeight: '1.2' }}>Monthly Recurring Revenue</span>
            <span className="stats-mrr" style={{ lineHeight: '1', marginTop: '2px' }}>
              {formatSmartAmount(metrics.mrr, currencyCode, 10)}
            </span>
          </div>
          <div className="stats-secondary-row">
            <div className="stats-metric">
              <div className="stats-metric-value" style={{ lineHeight: '1' }}>{metrics.subscriberCount}</div>
              <span className="stats-label" style={{ marginTop: '2px', opacity: 0.8, lineHeight: '1.2' }}>Subscribers</span>
            </div>
            <div className="stats-metric">
              <div className="stats-metric-value" style={{ lineHeight: '1' }}>
                {formatSmartAmount(metrics.totalRevenue, currencyCode, 10)}
              </div>
              <span className="stats-label" style={{ marginTop: '2px', opacity: 0.8, lineHeight: '1.2' }}>Total Revenue</span>
            </div>
          </div>
          <img
            src="/wink.png"
            alt="Sticker"
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              width: '60px',
              height: '60px',
              transform: 'rotate(5deg)',
              pointerEvents: 'none',
              opacity: 0.9
            }}
          />
        </section>

        <Pressable className="link-card" onClick={noop}>
          <div className="link-avatar">
            <img
              src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=face"
              alt="Profile"
              className="link-avatar-img"
            />
          </div>
          <div className="link-info">
            <span className="link-label">Your subscription page</span>
            <span className="link-url">{getShareableLink('nate')}</span>
          </div>
          <Pressable className="link-btn link-btn-copy" onClick={noop}>
            <ChevronRight size={20} />
          </Pressable>
        </Pressable>

        <section className="dash-activity-card">
          <div className="dash-activity-header">
            <span className="dash-activity-title">Activity</span>
            <Pressable className="dash-activity-view-all" onClick={noop}>
              View All
            </Pressable>
          </div>
          <div className="dash-activity-list">
            {activities.map((activity, index) => (
              <Pressable
                key={activity.id}
                className="dash-activity-item animate-fade-in-up"
                style={{ animationDelay: `${index * 0.05}s`, animationFillMode: 'both' }}
                onClick={noop}
              >
                <div className="dash-activity-icon">{getActivityIcon(activity.type)}</div>
                <div className="dash-activity-info">
                  <div className="dash-activity-item-title">{getActivityTitle(activity.type)}</div>
                  <div className="dash-activity-item-meta">
                    {activity.createdAt} - {activity.name}
                  </div>
                </div>
                <div className="dash-activity-amount-col">
                  <span className="dash-activity-amount">
                    +{currencySymbol}{formatCompactNumber(activity.amount)}
                  </span>
                  <span className="dash-activity-tier">{activity.tier}</span>
                </div>
              </Pressable>
            ))}
          </div>
        </section>

        <Pressable className="ptr-indicator-inner visible" onClick={noop} style={{ pointerEvents: 'auto' }}>
          <RefreshCw size={16} />
          <span>Mock page for screenshots</span>
        </Pressable>
      </main>
    </div>
  )
}

