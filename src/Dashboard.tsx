import { useState, useEffect } from 'react'
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
} from 'lucide-react'
import { useOnboardingStore } from './onboarding/store'
import { Pressable, useToast, Skeleton, SkeletonList, ErrorState } from './components'
import { useViewTransition } from './hooks'
import './Dashboard.css'

// Mock data
const activityData = [
  { id: 1, type: 'new_subscriber', name: 'Sarah K.', amount: 10, time: '2m ago', tier: 'Supporter' },
  { id: 2, type: 'payment', name: 'James T.', amount: 25, time: '1h ago', tier: 'VIP' },
  { id: 3, type: 'new_subscriber', name: 'Mike R.', amount: 5, time: '3h ago', tier: 'Fan' },
  { id: 4, type: 'renewal', name: 'Lisa M.', amount: 10, time: 'Yesterday', tier: 'Supporter' },
]

const menuItems = [
  { id: 'subscribers', title: 'Subscribers', icon: UserPlus, path: '/subscribers' },
  { id: 'new-request', title: 'New Request', icon: DollarSign, path: '/new-request' },
  { id: 'sent-requests', title: 'Sent Requests', icon: Clock, path: '/requests' },
  { id: 'updates', title: 'Updates', icon: Send, path: '/updates' },
  { id: 'edit', title: 'Edit My Page', icon: Pen, path: '/edit-page' },
  { id: 'templates', title: 'Templates', icon: Layout, path: '/templates' },
  { id: 'payment', title: 'Payment Settings', icon: CreditCard, path: '/settings/payments' },
]

const menuFooterItems = [
  { id: 'settings', title: 'Settings', icon: Settings, path: '/settings' },
  { id: 'help', title: 'Help and Support', icon: HelpCircle, path: '/settings/help' },
]

const notifications = [
  { id: 1, type: 'subscriber', title: 'New Subscriber', desc: 'Sarah just subscribed at $10/month', time: '2m ago', read: false },
  { id: 2, type: 'payment', title: 'Payment Received', desc: 'Monthly payment from James - $25', time: '1h ago', read: false },
  { id: 3, type: 'subscriber', title: 'New Subscriber', desc: 'Mike subscribed at $5/month', time: '3h ago', read: true },
]

// Activity icon helper
const getActivityIcon = (type: string) => {
  switch (type) {
    case 'new_subscriber': return <UserPlus size={18} />
    case 'payment': return <DollarSign size={18} />
    case 'renewal': return <RefreshCw size={18} />
    case 'cancelled': return <UserX size={18} />
    default: return <DollarSign size={18} />
  }
}

const getActivityTitle = (type: string) => {
  switch (type) {
    case 'new_subscriber': return 'New Subscriber'
    case 'payment': return 'Payment Received'
    case 'renewal': return 'Renewed'
    case 'cancelled': return 'Cancelled'
    default: return 'Activity'
  }
}

export default function Dashboard() {
  const { navigate } = useViewTransition()
  const toast = useToast()
  const [menuOpen, setMenuOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)

  const { username, name } = useOnboardingStore()

  // Simulate initial data load with possible error
  const loadData = async () => {
    setIsLoading(true)
    setHasError(false)
    try {
      // Simulate API call - in real app, this would fetch dashboard data
      await new Promise(resolve => setTimeout(resolve, 800))
    } catch {
      setHasError(true)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])
  const pageUrl = `nate.to/${username || 'yourname'}`

  // Mock metrics
  const metrics = {
    mrr: 285,
    subscribers: 12,
    pageViews: 847,
    subscriberGrowth: 8,
  }

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
          title: `Subscribe to ${name || 'me'}`,
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
              {name ? name.charAt(0).toUpperCase() : 'U'}
            </div>
            <div className="menu-profile-text">
              <span className="menu-profile-name">{name || 'Your Name'}</span>
              <span className="menu-profile-username">@{username || 'username'}</span>
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
              {notifications.map((notif) => (
                <div key={notif.id} className={`notification-item ${notif.read ? 'read' : ''}`}>
                  <div className="notification-content">
                    <div className="notification-title">{notif.title}</div>
                    <div className="notification-desc">{notif.desc}</div>
                    <div className="notification-time">{notif.time}</div>
                  </div>
                  {!notif.read && <div className="notification-unread-dot" />}
                </div>
              ))}
            </div>
            <Pressable className="notifications-footer">
              <span>Mark all as read</span>
            </Pressable>
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
            <span className="stats-mrr">${metrics.mrr}</span>
          </div>
          <div className="stats-secondary-row">
            <div className="stats-metric">
              <div className="stats-metric-value">
                <span>{metrics.subscribers}</span>
                <span className="stats-badge">+{metrics.subscriberGrowth}%</span>
              </div>
              <span className="stats-label">Subscribers</span>
            </div>
            <div className="stats-metric">
              <div className="stats-metric-value">
                <span>{metrics.pageViews}</span>
              </div>
              <span className="stats-label">Page Views</span>
            </div>
          </div>
        </section>

        {/* Shareable Link Card */}
        <Pressable className="link-card" onClick={() => navigate('/subscribe')}>
          <div className="link-avatar">
            {name ? name.charAt(0).toUpperCase() : 'U'}
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
            {activityData.length === 0 ? (
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
              activityData.map((activity) => (
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
                    <div className="dash-activity-item-meta">{activity.time} - {activity.name}</div>
                  </div>
                  <div className="dash-activity-amount-col">
                    <span className={`dash-activity-amount ${activity.type === 'cancelled' ? 'cancelled' : ''}`}>
                      {activity.type === 'cancelled' ? '-' : '+'}${activity.amount}
                    </span>
                    <span className="dash-activity-tier">{activity.tier}</span>
                  </div>
                </Pressable>
              ))
            )}
          </div>
        </section>
          </>
        )}
      </main>
    </div>
  )
}
