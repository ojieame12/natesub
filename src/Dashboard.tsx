import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from './api/client'
import { getShareableLink } from './utils/constants'
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
  Heart,
  Home,
  ArrowDownLeft,
  ScanLine,
} from 'lucide-react'
import { Pressable, useToast, Skeleton, SkeletonList, ErrorState, AnimatedNumber } from './components'
import { useViewTransition } from './hooks'
import { useCurrentUser, useMetrics, useActivity, useProfile, useAnalyticsStats } from './api/hooks'
import { centsToDisplayAmount, getCurrencySymbol, formatCompactNumber, formatSmartAmount } from './utils/currency'
import './Dashboard.css'

// Menu items are built dynamically based on service vs personal branch
const getMenuItems = (isService: boolean) => [
  { id: 'subscribers', title: isService ? 'Clients' : 'Subscribers', icon: UserPlus, path: '/subscribers' },
  { id: 'my-subs', title: 'Following', icon: Heart, path: '/my-subscriptions' },
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

// Pre-load subscription page components to avoid serial waterfall
const preloadSubscriptionPage = () => {
  // These will be cached by the browser after first load
  import('./subscribe/SubscribeBoundary')
  import('./subscribe/SubscriptionLiquid')
}

export default function Dashboard() {
  const { navigate } = useViewTransition()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [menuOpen, setMenuOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  // Real API hooks
  const { data: currentUser } = useCurrentUser()
  const { data: profileData, isLoading: profileLoading, refetch: refetchProfile } = useProfile()
  const { data: metricsData, isLoading: metricsLoading, isError: metricsError, refetch: refetchMetrics } = useMetrics()
  const { data: activityData, isLoading: activityLoading, isError: activityError, refetch: refetchActivity } = useActivity(5)
  const { refetch: refetchAnalytics } = useAnalyticsStats()

  const profile = profileData?.profile
  const metrics = metricsData?.metrics
  const activities = activityData?.pages?.[0]?.activities || []
  const currencyCode = (profile?.currency || currentUser?.profile?.currency || 'USD').toUpperCase()
  // Avoid "Clients ↔ Subscribers" flicker while /profile loads by using the already-loaded /auth/me profile.
  const isService = (profile?.purpose || currentUser?.profile?.purpose) === 'service'

  // Build menu items based on service vs personal
  const menuItems = useMemo(() => getMenuItems(isService), [isService])

  const isLoading = profileLoading || metricsLoading || activityLoading
  const hasError = metricsError || activityError

  // ============================================
  // Pull-to-refresh + Manual Refresh
  // ============================================

  const PULL_MAX_PX = 120
  const PULL_TRIGGER_PX = 72
  const PULL_HOLD_PX = 56
  const PULL_RESISTANCE = 0.5

  const [pullOffsetPx, setPullOffsetPxState] = useState(0)
  const pullOffsetPxRef = useRef(0)
  const setPullOffsetPx = useCallback((next: number) => {
    pullOffsetPxRef.current = next
    setPullOffsetPxState(next)
  }, [])

  const [isPulling, setIsPulling] = useState(false)

  const [isRefreshing, setIsRefreshingState] = useState(false)
  const isRefreshingRef = useRef(false)
  const setIsRefreshing = useCallback((next: boolean) => {
    isRefreshingRef.current = next
    setIsRefreshingState(next)
  }, [])

  const isMountedRef = useRef(true)
  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const refreshDashboard = useCallback(async (source: 'manual' | 'pull' = 'manual') => {
    if (isRefreshingRef.current) return

    setIsRefreshing(true)

    // If this refresh was triggered by pulling, snap to a stable "hold" height.
    if (source === 'pull') {
      setPullOffsetPx(PULL_HOLD_PX)
    }

    try {
      await Promise.all([
        refetchProfile(),
        refetchMetrics(),
        refetchActivity(),
        refetchAnalytics(),
      ])
    } catch (err) {
      console.error('[dashboard] refresh failed:', err)
      toast.error('Failed to refresh')
    } finally {
      if (isMountedRef.current) {
        setIsRefreshing(false)
        if (source === 'pull') {
          setPullOffsetPx(0)
        }
      }
    }
  }, [refetchActivity, refetchAnalytics, refetchMetrics, refetchProfile, setIsRefreshing, setPullOffsetPx, toast])

  const loadData = useCallback(() => {
    void refreshDashboard('manual')
  }, [refreshDashboard])

  useEffect(() => {
    const container = document.querySelector('.app-content') as HTMLElement | null
    if (!container) return

    const startYRef = { current: null as number | null }
    const pullingRef = { current: false }

    const getTouchY = (event: TouchEvent) => event.touches[0]?.clientY ?? 0

    const resetPull = () => {
      startYRef.current = null
      pullingRef.current = false
      setIsPulling(false)
      setPullOffsetPx(0)
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (isRefreshingRef.current) return
      if (container.scrollTop > 0) return
      startYRef.current = getTouchY(event)
      pullingRef.current = false
    }

    const handleTouchMove = (event: TouchEvent) => {
      const startY = startYRef.current
      if (startY == null) return

      // If user started scrolling, abort pulling.
      if (container.scrollTop > 0) {
        resetPull()
        return
      }

      const currentY = getTouchY(event)
      const deltaY = currentY - startY

      // Only handle downward pull
      if (deltaY <= 0) {
        if (pullOffsetPxRef.current !== 0) {
          setPullOffsetPx(0)
        }
        return
      }

      const nextPull = Math.min(PULL_MAX_PX, deltaY * PULL_RESISTANCE)
      if (!pullingRef.current) {
        pullingRef.current = true
        setIsPulling(true)
      }
      setPullOffsetPx(nextPull)

      // Prevent native overscroll while we render our own elastic pull.
      event.preventDefault()
    }

    const handleTouchEnd = () => {
      const pulled = pullOffsetPxRef.current
      const shouldRefresh = pulled >= PULL_TRIGGER_PX

      startYRef.current = null
      pullingRef.current = false
      setIsPulling(false)

      if (shouldRefresh) {
        void refreshDashboard('pull')
        return
      }

      setPullOffsetPx(0)
    }

    container.addEventListener('touchstart', handleTouchStart, { passive: true })
    container.addEventListener('touchmove', handleTouchMove, { passive: false })
    container.addEventListener('touchend', handleTouchEnd, { passive: true })
    container.addEventListener('touchcancel', handleTouchEnd, { passive: true })

    return () => {
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove as any)
      container.removeEventListener('touchend', handleTouchEnd)
      container.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [refreshDashboard, setPullOffsetPx])

  // Memoized handlers to prevent unnecessary re-renders
  const openMenu = useCallback(() => setMenuOpen(true), [])
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const openNotifications = useCallback(() => setNotificationsOpen(true), [])
  const closeNotifications = useCallback(() => setNotificationsOpen(false), [])

  // Menu navigation handler - navigate immediately, menu closes via CSS
  const handleMenuNavigate = useCallback((path: string) => {
    setMenuOpen(false)
    navigate(path) // Navigate instantly - no delay
  }, [navigate])

  const pageUrl = getShareableLink(profile?.username || 'yourname')

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

  // Prefetch subscription page data + components on hover/touch
  const prefetchSubscriptionPage = useCallback(() => {
    if (!username) return
    // Prefetch the API data
    queryClient.prefetchQuery({
      queryKey: ['publicProfile', username],
      queryFn: () => api.users.getByUsername(username),
      staleTime: 60 * 1000,
    })
    // Preload the lazy component chunks
    preloadSubscriptionPage()
  }, [username, queryClient])

  return (
    <div className="dashboard">
      {/* Header */}
      <header className="header glass-header">
        <div className="header-left">
          <Pressable className="header-icon-btn" onClick={openMenu}>
            <Menu size={20} />
          </Pressable>
        </div>
        <img src="/logo.svg" alt="Logo" className="header-logo" />
        <div className="header-right">
          <Pressable className="header-icon-btn" onClick={openNotifications}>
            <Bell size={20} />
            {notifications.some(n => !n.read) && <span className="notification-dot" />}
          </Pressable>
        </div>
      </header>

      {/* Pull-to-refresh indicator (Dashboard only) */}
      <div className="ptr-indicator" aria-hidden={!isPulling && !isRefreshing && pullOffsetPx <= 0}>
        <div className={`ptr-indicator-inner ${(isPulling || isRefreshing || pullOffsetPx > 0) ? 'visible' : ''}`}>
          <RefreshCw
            size={16}
            className={isRefreshing ? 'ptr-spinning' : ''}
            style={!isRefreshing ? { transform: `rotate(${Math.min(180, (pullOffsetPx / PULL_TRIGGER_PX) * 180)}deg)` } : undefined}
          />
          <span>
            {isRefreshing
              ? 'Refreshing…'
              : pullOffsetPx >= PULL_TRIGGER_PX
                ? 'Release to refresh'
                : 'Pull to refresh'}
          </span>
        </div>
      </div>

      {/* Slide-out Menu */}
      <div className={`menu-overlay ${menuOpen ? 'open' : ''}`} onClick={closeMenu} />
      <div className={`menu-panel ${menuOpen ? 'open' : ''}`}>
        <div className="menu-profile">
          <div className="menu-profile-info">
            <div className="menu-avatar">
              {profile?.avatarUrl ? (
                <img src={profile.avatarUrl} alt="" className="menu-avatar-img" />
              ) : (
                displayName ? displayName.charAt(0).toUpperCase() : 'U'
              )}
            </div>
            <div className="menu-profile-text">
              <span className="menu-profile-name">{displayName}</span>
              <span className="menu-profile-username">@{username}</span>
            </div>
          </div>
          <Pressable className="menu-close" onClick={closeMenu}>
            <X size={20} />
          </Pressable>
        </div>
        <div className="menu-items">
          {menuItems.map((item) => (
            <Pressable
              key={item.id}
              className="menu-item"
              onClick={() => handleMenuNavigate(item.path)}
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
              onClick={() => handleMenuNavigate(item.path)}
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
          <div className="menu-overlay" onClick={closeNotifications} />
          <div className="notifications-panel">
            <div className="notifications-header">
              <span className="notifications-title">Notifications</span>
              <Pressable className="menu-close" onClick={closeNotifications}>
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
      <main
        className="main"
        style={{
          transform: pullOffsetPx ? `translateY(${pullOffsetPx}px)` : undefined,
          transition: isPulling ? 'none' : 'transform 220ms var(--ease-out, ease-out)',
          willChange: (isPulling || isRefreshing) ? 'transform' : undefined,
        }}
      >
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
            <section className="stats-card" style={{ height: '220px', padding: '24px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div className="stats-primary">
                <span className="stats-label" style={{ marginBottom: '0', opacity: 0.8, lineHeight: '1.2' }}>Monthly Recurring Revenue</span>
                <span className="stats-mrr" style={{ lineHeight: '1', marginTop: '2px' }}>
                  <AnimatedNumber value={metrics?.mrr ?? 0} duration={600} format={(n) => formatSmartAmount(n, currencyCode, 10)} />
                </span>
              </div>
              <div className="stats-secondary-row">
                <div className="stats-metric">
                  <div className="stats-metric-value" style={{ lineHeight: '1' }}>
                    <AnimatedNumber value={metrics?.subscriberCount ?? 0} duration={500} format={(n) => formatCompactNumber(n)} />
                  </div>
                  <span className="stats-label" style={{ marginTop: '2px', opacity: 0.8, lineHeight: '1.2' }}>{isService ? 'Clients' : 'Subscribers'}</span>
                </div>
                <div className="stats-metric">
                  <div className="stats-metric-value" style={{ lineHeight: '1' }}>
                    <AnimatedNumber value={metrics?.totalRevenue ?? 0} duration={600} format={(n) => formatSmartAmount(n, currencyCode, 10)} />
                  </div>
                  <span className="stats-label" style={{ marginTop: '2px', opacity: 0.8, lineHeight: '1.2' }}>Total Revenue</span>
                </div>
              </div>
              <img
                src="/wink.png"
                alt=""
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

            {/* Payment Status Banner */}
            {profile?.payoutStatus === 'pending' && (
              <Pressable
                className="payment-status-banner pending"
                onClick={() => navigate('/settings/payments')}
              >
                <Clock size={18} />
                <div className="payment-status-content">
                  <span className="payment-status-title">Payment Setup in Progress</span>
                  <span className="payment-status-desc">Stripe is verifying your account. We'll email you when ready.</span>
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

            {/* Shareable Link Card - prefetch on hover for instant navigation */}
            <Pressable
              className="link-card"
              onClick={() => profile?.username && navigate(`/${profile.username}`)}
              onMouseEnter={prefetchSubscriptionPage}
              onTouchStart={prefetchSubscriptionPage}
            >
              <div className="link-avatar">
                {profile?.avatarUrl ? (
                  <img src={profile.avatarUrl} alt="" className="link-avatar-img" />
                ) : (
                  displayName ? displayName.charAt(0).toUpperCase() : 'U'
                )}
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
                  activities.map((activity: any, index: number) => {
                    const payload = activity.payload || {}
                    const currency = (payload.currency || profile?.currency || currentUser?.profile?.currency || 'USD').toUpperCase()
                    const currencySymbolForRow = getCurrencySymbol(currency)
                    const amount = payload.amount ? centsToDisplayAmount(payload.amount, currency) : 0
                    const name = payload.subscriberName || payload.recipientName || ''
                    const tier = payload.tierName || ''
                    const isCanceled = activity.type === 'subscription_canceled'

                    return (
                      <Pressable
                        key={activity.id}
                        className="dash-activity-item animate-fade-in-up"
                        style={{ animationDelay: `${index * 0.05}s`, animationFillMode: 'both' }}
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
                              {isCanceled ? '-' : '+'}{currencySymbolForRow}{formatCompactNumber(amount)}
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

      {/* Footer Navigation */}
      <div className="dashboard-footer">
        <Pressable
          className="footer-tab active"
          onClick={() => navigate('/dashboard')}
        >
          <div className="tab-icon">
            <Home size={24} strokeWidth={2.5} />
          </div>
        </Pressable>

        <Pressable
          className="footer-tab"
          onClick={() => navigate('/requests')}
        >
          <div className="tab-icon">
            <ArrowDownLeft size={24} strokeWidth={2.5} />
          </div>
        </Pressable>

        <Pressable
          className="footer-tab scan-tab"
          onClick={() => navigate('/scan')}
        >
          <div className="scan-button">
            <ScanLine size={24} strokeWidth={2.5} />
          </div>
        </Pressable>

        <Pressable
          className="footer-tab"
          onClick={() => navigate('/activity')}
        >
          <div className="tab-icon">
            <Clock size={24} strokeWidth={2.5} />
          </div>
        </Pressable>

        <Pressable
          className="footer-tab"
          onClick={() => navigate('/profile')}
        >
          <div className="tab-icon">
            <img
              src={currentUser?.profile?.avatarUrl || `https://ui-avatars.com/api/?name=${currentUser?.email}&background=random`}
              alt="Profile"
              className="tab-avatar"
            />
          </div>
        </Pressable>
      </div>
    </div>
  )
}
