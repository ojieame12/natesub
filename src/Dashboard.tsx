import { useState, useMemo } from 'react'
import {
  Menu,
  Bell,
  Copy,
  Share2,
  Check,
  ChevronRight,
  Pen,
  Layout,
  CreditCard,
  Settings,
  HelpCircle,
  X,
  UserPlus,
  DollarSign,
  RefreshCw,
  UserX,
  Send,
  Clock,
  Activity,
  FileText,
} from 'lucide-react'
import { Pressable, useToast, Skeleton, SkeletonList, ErrorState } from './components'
import { useViewTransition } from './hooks'
import { useMetrics, useActivity, useProfile } from './api/hooks'
import { getCurrencySymbol } from './utils/currency'
import './Dashboard.css'

// Menu items are built dynamically based on service vs personal branch
const getMenuItems = (isService: boolean) => [
  { id: 'subscribers', title: isService ? 'Clients' : 'Subscribers', icon: UserPlus, path: '/subscribers' },
  { id: 'new-request', title: isService ? 'New Invoice' : 'New Request', icon: DollarSign, path: '/new-request' },
  { id: 'sent-requests', title: isService ? 'Sent Invoices' : 'Sent Requests', icon: Clock, path: '/requests' },
  // Payroll for service, Updates for personal
  isService
    ? { id: 'payroll', title: 'Payroll', icon: FileText, path: '/payroll' }
    : { id: 'updates', title: 'Updates', icon: Send, path: '/updates' },
  { id: 'edit', title: 'Edit My Page', icon: Pen, path: '/edit-page' },
  { id: 'templates', title: 'Templates', icon: Layout, path: '/templates' },
  { id: 'payment', title: 'Payment Settings', icon: CreditCard, path: '/settings/payments' },
]

const menuFooterItems = [
  { id: 'settings', title: 'Settings', icon: Settings, path: '/settings' },
  { id: 'help', title: 'Help and Support', icon: HelpCircle, path: '/settings/help' },
]

// Notifications are not implemented yet - will come from a real notifications API
const notifications: { id: number; type: string; title: string; desc: string; time: string; read: boolean }[] = []

// Activity icon helper
const getActivityIcon = (type: string) => {
  switch (type) {
    case 'subscription_created':
    case 'new_subscriber': return <UserPlus size={18} />
    case 'payment_received':
    case 'payment': return <DollarSign size={18} />
    case 'renewal': return <RefreshCw size={18} />
    case 'subscription_canceled':
    case 'cancelled': return <UserX size={18} />
    case 'request_sent': return <Send size={18} />
    case 'request_accepted': return <Check size={18} />
    default: return <DollarSign size={18} />
  }
}

const getActivityTitle = (type: string) => {
  switch (type) {
    case 'subscription_created':
    case 'new_subscriber': return 'New Subscriber'
    case 'payment_received':
    case 'payment': return 'Payment Received'
    case 'renewal': return 'Renewed'
    case 'subscription_canceled':
    case 'cancelled': return 'Cancelled'
    case 'request_sent': return 'Request Sent'
    case 'request_accepted': return 'Request Accepted'
    default: return 'Activity'
  }
}

// Format relative time
const formatRelativeTime = (date: Date | string) => {
  const now = new Date()
  const then = new Date(date)
  const diffMs = now.getTime() - then.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return then.toLocaleDateString()
}

export default function Dashboard() {
  const { navigate } = useViewTransition()
  const toast = useToast()
  const [menuOpen, setMenuOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  // Real API hooks
  const { data: profileData, isLoading: profileLoading } = useProfile()
  const { data: metricsData, isLoading: metricsLoading, isError: metricsError, refetch: refetchMetrics } = useMetrics()
  const { data: activityData, isLoading: activityLoading, isError: activityError, refetch: refetchActivity } = useActivity(5)

  const profile = profileData?.profile
  const metrics = metricsData?.metrics
  const activities = activityData?.pages?.[0]?.activities || []
  const currencySymbol = getCurrencySymbol(profile?.currency || 'USD')
  const isService = profile?.purpose === 'service'

  // Build menu items based on service vs personal
  const menuItems = useMemo(() => getMenuItems(isService), [isService])

  const isLoading = profileLoading || metricsLoading || activityLoading
  const hasError = metricsError || activityError

  const loadData = () => {
    refetchMetrics()
    refetchActivity()
  }

  const pageUrl = `nate.to/${profile?.username || 'yourname'}`

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(`https://${pageUrl}`)
      setCopied(true)
      toast.success('Link copied!')
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
      toast.error('Failed to copy link')
    }
  }

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Subscribe to ${profile?.displayName || 'me'}`,
          text: 'Check out my subscription page!',
          url: `https://${pageUrl}`,
        })
      } catch (err) {
        // User cancelled share - not an error
        if ((err as Error).name !== 'AbortError') {
          console.error('Failed to share:', err)
          toast.error('Failed to share')
        }
      }
    } else {
      handleCopyLink()
    }
  }

  const displayName = profile?.displayName || 'Your Name'
  const username = profile?.username || 'username'

  return (
    <div className="dashboard">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <Pressable className="header-icon-btn" onClick={() => setMenuOpen(true)}>
            <Menu size={20} />
          </Pressable>
        </div>
        <img src="/logo.svg" alt="Logo" className="header-logo" />
        <div className="header-right">
          <Pressable className="header-icon-btn" onClick={() => setNotificationsOpen(true)}>
            <Bell size={20} />
            {notifications.some(n => !n.read) && <span className="notification-dot" />}
          </Pressable>
        </div>
      </header>

      {/* Slide-out Menu */}
      <div className={`menu-overlay ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)} />
      <div className={`menu-panel ${menuOpen ? 'open' : ''}`}>
        <div className="menu-profile">
          <div className="menu-profile-info">
            <div className="menu-avatar">
              {displayName ? displayName.charAt(0).toUpperCase() : 'U'}
            </div>
            <div className="menu-profile-text">
              <span className="menu-profile-name">{displayName}</span>
              <span className="menu-profile-username">@{username}</span>
            </div>
          </div>
          <Pressable className="menu-close" onClick={() => setMenuOpen(false)}>
            <X size={20} />
          </Pressable>
        </div>
        <div className="menu-items">
          {menuItems.map((item) => (
            <Pressable
              key={item.id}
              className="menu-item"
              onClick={() => {
                setMenuOpen(false)
                navigate(item.path)
              }}
            >
              <item.icon size={20} className="menu-item-icon" />
              <div className="menu-item-content">
                <span className="menu-item-title">{item.title}</span>
                <ChevronRight size={18} className="menu-item-chevron" />
              </div>
            </Pressable>
          ))}
        </div>
        <div className="menu-footer">
          {menuFooterItems.map((item) => (
            <Pressable
              key={item.id}
              className="menu-item"
              onClick={() => {
                setMenuOpen(false)
                navigate(item.path)
              }}
            >
              <item.icon size={20} className="menu-item-icon" />
              <div className="menu-item-content">
                <span className="menu-item-title">{item.title}</span>
                <ChevronRight size={18} className="menu-item-chevron" />
              </div>
            </Pressable>
          ))}
        </div>
      </div>

      {/* Notifications Panel */}
      {notificationsOpen && (
        <>
          <div className="menu-overlay" onClick={() => setNotificationsOpen(false)} />
          <div className="notifications-panel">
            <div className="notifications-header">
              <span className="notifications-title">Notifications</span>
              <Pressable className="menu-close" onClick={() => setNotificationsOpen(false)}>
                <X size={24} />
              </Pressable>
            </div>
            <div className="notifications-list">
              {notifications.length === 0 ? (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                  <Bell size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
                  <p style={{ fontSize: 14 }}>No notifications yet</p>
                </div>
              ) : (
                notifications.map((notif) => (
                  <div key={notif.id} className={`notification-item ${notif.read ? 'read' : ''}`}>
                    <div className="notification-content">
                      <div className="notification-title">{notif.title}</div>
                      <div className="notification-desc">{notif.desc}</div>
                      <div className="notification-time">{notif.time}</div>
                    </div>
                    {!notif.read && <div className="notification-unread-dot" />}
                  </div>
                ))
              )}
            </div>
            {notifications.length > 0 && (
              <Pressable className="notifications-footer">
                <span>Mark all as read</span>
              </Pressable>
            )}
          </div>
        </>
      )}

      {/* Main Content */}
      <main className="main">
        {hasError ? (
          <ErrorState
            title="Couldn't load dashboard"
            message="We had trouble loading your dashboard data. Please try again."
            onRetry={loadData}
          />
        ) : isLoading ? (
          <>
            {/* Stats Card Skeleton */}
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

            {/* Link Card Skeleton */}
            <div className="link-card">
              <Skeleton width={48} height={48} borderRadius="50%" />
              <div className="link-info">
                <Skeleton width={140} height={12} />
                <Skeleton width={100} height={14} style={{ marginTop: 4 }} />
              </div>
            </div>

            {/* Activity Skeleton */}
            <section className="dash-activity-card">
              <div className="dash-activity-header">
                <Skeleton width={80} height={18} />
                <Skeleton width={60} height={14} />
              </div>
              <SkeletonList count={4} />
            </section>
          </>
        ) : (
          <>
        {/* Stats Card */}
        <section className="stats-card">
          <div className="stats-primary">
            <span className="stats-label">Monthly Recurring Revenue</span>
            <span className="stats-mrr">{currencySymbol}{metrics?.mrr ?? 0}</span>
          </div>
          <div className="stats-secondary-row">
            <div className="stats-metric">
              <div className="stats-metric-value">
                <span>{metrics?.subscriberCount ?? 0}</span>
              </div>
              <span className="stats-label">Subscribers</span>
            </div>
            <div className="stats-metric">
              <div className="stats-metric-value">
                <span>{currencySymbol}{metrics?.totalRevenue ?? 0}</span>
              </div>
              <span className="stats-label">Total Revenue</span>
            </div>
          </div>
        </section>

        {/* Payment Status Banner */}
        {profile?.paymentProvider === 'bank' && (
          <Pressable
            className="payment-status-banner manual"
            onClick={() => navigate('/settings/payments')}
          >
            <CreditCard size={18} />
            <div className="payment-status-content">
              <span className="payment-status-title">Manual Payouts</span>
              <span className="payment-status-desc">Funds are held until you request withdrawal</span>
            </div>
            <ChevronRight size={18} />
          </Pressable>
        )}
        {profile?.payoutStatus === 'pending' && profile?.paymentProvider !== 'bank' && (
          <Pressable
            className="payment-status-banner pending"
            onClick={() => navigate('/settings/payments')}
          >
            <CreditCard size={18} />
            <div className="payment-status-content">
              <span className="payment-status-title">Complete Payment Setup</span>
              <span className="payment-status-desc">Finish connecting your payment account</span>
            </div>
            <ChevronRight size={18} />
          </Pressable>
        )}
        {profile?.payoutStatus === 'restricted' && (
          <Pressable
            className="payment-status-banner restricted"
            onClick={() => navigate('/settings/payments')}
          >
            <CreditCard size={18} />
            <div className="payment-status-content">
              <span className="payment-status-title">Action Required</span>
              <span className="payment-status-desc">Your payment account needs attention</span>
            </div>
            <ChevronRight size={18} />
          </Pressable>
        )}

        {/* Shareable Link Card */}
        <Pressable className="link-card" onClick={() => navigate('/subscribe')}>
          <div className="link-avatar">
            {displayName ? displayName.charAt(0).toUpperCase() : 'U'}
          </div>
          <div className="link-info">
            <span className="link-label">Your subscription page</span>
            <span className="link-url">{pageUrl}</span>
          </div>
          <Pressable className="link-btn link-btn-copy" onClick={(e) => { e?.stopPropagation(); handleCopyLink(); }}>
            {copied ? <Check size={20} /> : <Copy size={20} />}
          </Pressable>
          <Pressable className="link-btn link-btn-share" onClick={(e) => { e?.stopPropagation(); handleShare(); }}>
            <Share2 size={20} />
          </Pressable>
        </Pressable>

        {/* Activity Section */}
        <section className="dash-activity-card">
          <div className="dash-activity-header">
            <span className="dash-activity-title">Activity</span>
            <Pressable className="dash-activity-view-all" onClick={() => navigate('/activity')}>
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
              activities.map((activity: any) => {
                const payload = activity.payload || {}
                const amount = payload.amount ? payload.amount / 100 : 0
                const name = payload.subscriberName || payload.recipientName || ''
                const tier = payload.tierName || ''
                const isCanceled = activity.type === 'subscription_canceled'

                return (
                  <Pressable
                    key={activity.id}
                    className="dash-activity-item"
                    onClick={() => navigate(`/activity/${activity.id}`)}
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
                          {isCanceled ? '-' : '+'}{currencySymbol}{amount}
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
          </>
        )}
      </main>
    </div>
  )
}
