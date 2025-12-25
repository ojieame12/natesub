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
  BarChart3,
} from 'lucide-react'
import { Pressable, useToast, Skeleton, SkeletonList, ErrorState, AnimatedNumber } from './components'
import { useViewTransition } from './hooks'
import { useCurrentUser, useMetrics, useActivity, useProfile, useAnalyticsStats } from './api/hooks'
import { centsToDisplayAmount, getCurrencySymbol, formatCompactNumber, formatCompactAmount } from './utils/currency'
import './Dashboard.css'

// Menu items are built dynamically based on service vs personal branch
const getMenuItems = (isService: boolean) => [
  { id: 'subscribers', title: isService ? 'Clients' : 'Subscribers', icon: UserPlus, path: '/subscribers' },
  { id: 'my-subs', title: 'Following', icon: Heart, path: '/my-subscriptions' },
  { id: 'analytics', title: 'Analytics', icon: BarChart3, path: '/analytics' },
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
    // Payout lifecycle
    case 'payout_initiated': return <Clock size={18} />
    case 'payout_completed': return <Check size={18} />
    case 'payout_failed': return <UserX size={18} />
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
    // Payout lifecycle
    case 'payout_initiated': return 'Payout Initiated'
    case 'payout_completed': return 'Payout Received'
    case 'payout_failed': return 'Payout Failed'
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
  // Currency toggle: 'profile' shows MRR/Revenue in profile currency, 'payout' shows in payout currency
  // Default to 'payout' to show native payout currency first (Option B)
  const [currencyView, setCurrencyView] = useState<'profile' | 'payout'>('payout')

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

  // Currency conversion
  // fxRate = 1 profile currency = X payout currency (e.g., 1 USD = 1600 NGN)
  const payoutCurrency = metrics?.balance?.currency || currencyCode
  const backendFxRate = metrics?.fxRate ?? null
  const hasDualCurrency = payoutCurrency !== currencyCode

  // Fallback FX rates when backend doesn't provide them (approximate rates)
  const FALLBACK_FX_RATES: Record<string, number> = {
    NGN: 1600,  // 1 USD = ~1600 NGN
    KES: 155,   // 1 USD = ~155 KES
    GHS: 15,    // 1 USD = ~15 GHS
    ZAR: 18,    // 1 USD = ~18 ZAR
  }

  // Use backend rate if available, otherwise use fallback for payout currency
  // Assumes profile currency is USD (which is required for cross-border)
  const fxRate = backendFxRate ?? (hasDualCurrency ? FALLBACK_FX_RATES[payoutCurrency] ?? null : null)

  // Toggle is available when we have dual currencies (we always have fallback rates now)
  const canToggle = hasDualCurrency && fxRate !== null

  // Determine which currency to show everything in
  const showInPayoutCurrency = canToggle && currencyView === 'payout'
  const displayCurrency = showInPayoutCurrency ? payoutCurrency : currencyCode

  // MRR and Total Revenue are in profile currency - convert if showing payout
  const displayMrr = showInPayoutCurrency && fxRate
    ? (metrics?.mrr ?? 0) * fxRate
    : (metrics?.mrr ?? 0)

  const displayTotalRevenue = showInPayoutCurrency && fxRate
    ? (metrics?.totalRevenue ?? 0) * fxRate
    : (metrics?.totalRevenue ?? 0)

  // Pending is in payout currency - convert to profile if showing profile currency
  const pendingRaw = centsToDisplayAmount(metrics?.balance?.pending ?? 0, payoutCurrency)
  const displayPending = showInPayoutCurrency
    ? pendingRaw  // Native payout currency
    : fxRate
      ? pendingRaw / fxRate  // Convert to profile currency
      : pendingRaw  // Can't convert, show raw (edge case)

  // Build menu items based on service vs personal
  const menuItems = useMemo(() => getMenuItems(isService), [isService])

  // Progressive loading: show each section as its data becomes available
  // Instead of blocking all content on any loading state
  const hasError = metricsError || activityError

  // ============================================
  // Pull-to-refresh + Manual Refresh
  // Uses direct DOM manipulation to avoid React re-renders during drag
  // ============================================

  const PULL_MAX_PX = 120
  const PULL_TRIGGER_PX = 72
  const PULL_HOLD_PX = 56

  // Rubber-band curve: asymptotic approach to max (feels like stretching elastic)
  const rubberBand = useCallback((deltaY: number) => {
    if (deltaY <= 0) return 0
    // Asymptotic curve: PULL_MAX_PX * (1 - e^(-deltaY/factor))
    // factor controls how "stiff" the rubber band feels
    const factor = 180
    return PULL_MAX_PX * (1 - Math.exp(-deltaY / factor))
  }, [])

  // Refs for pull state - no React state during drag to avoid re-renders
  const pullOffsetRef = useRef(0)
  const isPullingRef = useRef(false)
  const dashboardRef = useRef<HTMLDivElement>(null)

  // Ref for refreshing state - no React state needed since we update DOM directly
  const isRefreshingRef = useRef(false)
  const setIsRefreshing = useCallback((next: boolean) => {
    isRefreshingRef.current = next
  }, [])

  // Apply pull offset directly to DOM via CSS variable (no React re-render)
  const applyPullOffset = useCallback((offset: number, animate = false) => {
    const el = dashboardRef.current
    if (!el) return

    pullOffsetRef.current = offset
    el.style.setProperty('--pull-offset', `${offset}px`)

    if (animate) {
      el.classList.add('ptr-animating')
    } else {
      el.classList.remove('ptr-animating')
    }

    // Update indicator visibility
    const indicator = el.querySelector('.ptr-indicator-inner') as HTMLElement
    if (indicator) {
      if (offset > 0 || isRefreshingRef.current) {
        indicator.classList.add('visible')
      } else {
        indicator.classList.remove('visible')
      }
    }

    // Update indicator text and icon rotation
    const textSpan = el.querySelector('.ptr-indicator span') as HTMLElement
    const iconEl = el.querySelector('.ptr-indicator .lucide-refresh-cw') as SVGElement
    if (textSpan && !isRefreshingRef.current) {
      textSpan.textContent = offset >= PULL_TRIGGER_PX ? 'Release to refresh' : 'Pull to refresh'
    }
    if (iconEl && !isRefreshingRef.current) {
      iconEl.style.transform = `rotate(${Math.min(180, (offset / PULL_TRIGGER_PX) * 180)}deg)`
    }
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

    // If this refresh was triggered by pulling, snap to a stable "hold" height with animation
    if (source === 'pull') {
      applyPullOffset(PULL_HOLD_PX, true)
      // Update indicator to show refreshing state
      const el = dashboardRef.current
      if (el) {
        const textSpan = el.querySelector('.ptr-indicator span') as HTMLElement
        const iconEl = el.querySelector('.ptr-indicator .lucide-refresh-cw') as SVGElement
        if (textSpan) textSpan.textContent = 'Refreshing…'
        if (iconEl) {
          iconEl.style.transform = ''
          iconEl.classList.add('ptr-spinning')
        }
      }
    }

    try {
      console.log('[dashboard] Starting refresh...')
      const results = await Promise.all([
        refetchProfile(),
        refetchMetrics(),
        refetchActivity(),
        refetchAnalytics(),
      ])
      console.log('[dashboard] Refresh complete:', results.map(r => r.status))
    } catch (err) {
      console.error('[dashboard] refresh failed:', err)
      toast.error('Failed to refresh')
    } finally {
      if (isMountedRef.current) {
        setIsRefreshing(false)
        if (source === 'pull') {
          // Spring back to 0 with animation
          applyPullOffset(0, true)
          // Clean up spinning
          const el = dashboardRef.current
          if (el) {
            const iconEl = el.querySelector('.ptr-indicator .lucide-refresh-cw') as SVGElement
            if (iconEl) iconEl.classList.remove('ptr-spinning')
          }
        }
      }
    }
  }, [refetchActivity, refetchAnalytics, refetchMetrics, refetchProfile, setIsRefreshing, applyPullOffset, toast])

  const loadData = useCallback(() => {
    void refreshDashboard('manual')
  }, [refreshDashboard])

  useEffect(() => {
    const container = document.querySelector('.app-content') as HTMLElement | null
    if (!container) return

    const startYRef = { current: null as number | null }
    const startXRef = { current: null as number | null }
    const intentDetectedRef = { current: null as 'vertical' | 'horizontal' | null }

    const getTouchY = (event: TouchEvent) => event.touches[0]?.clientY ?? 0
    const getTouchX = (event: TouchEvent) => event.touches[0]?.clientX ?? 0

    const resetPull = () => {
      startYRef.current = null
      startXRef.current = null
      intentDetectedRef.current = null
      isPullingRef.current = false
      applyPullOffset(0, true) // Animate back to 0
    }

    const handleTouchStart = (event: TouchEvent) => {
      if (isRefreshingRef.current) return
      if (container.scrollTop > 0) return
      startYRef.current = getTouchY(event)
      startXRef.current = getTouchX(event)
      intentDetectedRef.current = null
      isPullingRef.current = false
    }

    const handleTouchMove = (event: TouchEvent) => {
      const startY = startYRef.current
      const startX = startXRef.current
      if (startY == null || startX == null) return

      // If user started scrolling, abort pulling
      if (container.scrollTop > 0) {
        resetPull()
        return
      }

      const currentY = getTouchY(event)
      const currentX = getTouchX(event)
      const deltaY = currentY - startY
      const deltaX = currentX - startX

      // Intent detection: determine if this is a vertical or horizontal gesture
      if (intentDetectedRef.current === null && (Math.abs(deltaY) > 10 || Math.abs(deltaX) > 10)) {
        intentDetectedRef.current = Math.abs(deltaY) > Math.abs(deltaX) ? 'vertical' : 'horizontal'
      }

      // If horizontal intent, don't interfere (let swipe gestures work)
      if (intentDetectedRef.current === 'horizontal') {
        return
      }

      // Only handle downward pull
      if (deltaY <= 0) {
        if (pullOffsetRef.current !== 0) {
          applyPullOffset(0)
        }
        return
      }

      // Apply rubber-band resistance curve (no React state, just DOM)
      const nextPull = rubberBand(deltaY)
      if (!isPullingRef.current) {
        isPullingRef.current = true
      }
      applyPullOffset(nextPull)

      // Prevent native overscroll while we render our own elastic pull
      event.preventDefault()
    }

    const handleTouchEnd = () => {
      const pulled = pullOffsetRef.current
      const shouldRefresh = pulled >= PULL_TRIGGER_PX

      console.log('[dashboard] Touch end - pulled:', pulled, 'shouldRefresh:', shouldRefresh)

      startYRef.current = null
      startXRef.current = null
      intentDetectedRef.current = null
      isPullingRef.current = false

      if (shouldRefresh) {
        console.log('[dashboard] Triggering pull refresh')
        void refreshDashboard('pull')
        return
      }

      // Spring back to 0 with animation
      applyPullOffset(0, true)
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
  }, [refreshDashboard, applyPullOffset, rubberBand])

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
    <div className="dashboard" ref={dashboardRef} style={{ '--pull-offset': '0px' } as React.CSSProperties}>
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

      {/* Pull-to-refresh indicator (Dashboard only) - controlled via CSS variable */}
      <div className="ptr-indicator">
        <div className="ptr-indicator-inner">
          <RefreshCw size={16} />
          <span>Pull to refresh</span>
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

      {/* Main Content - transform controlled by --pull-offset CSS variable */}
      <main className="main">
        {hasError ? (
          <ErrorState
            title="Couldn't load dashboard"
            message="We had trouble loading your dashboard data. Please try again."
            onRetry={loadData}
          />
        ) : (
          <>
            {/* Stats Card - show skeleton only while metrics loading */}
            {metricsLoading ? (
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
            ) : (
              <section className="stats-card">
              {/* Currency Toggle - only show if can convert between currencies */}
              {canToggle ? (
                <Pressable
                  className="currency-toggle"
                  onClick={() => setCurrencyView(v => v === 'profile' ? 'payout' : 'profile')}
                >
                  <span className={`currency-toggle-option ${currencyView === 'profile' ? 'active' : ''}`}>
                    {getCurrencySymbol(currencyCode)}
                  </span>
                  <span className={`currency-toggle-option ${currencyView === 'payout' ? 'active' : ''}`}>
                    {getCurrencySymbol(payoutCurrency)}
                  </span>
                </Pressable>
              ) : null}

              <div className="stats-primary">
                <span className="stats-label">Monthly Recurring Revenue</span>
                <span className="stats-mrr">
                  <AnimatedNumber value={displayMrr} duration={600} format={(n) => formatCompactAmount(n, displayCurrency)} />
                </span>
                {/* Pending Balance - under MRR, converted to display currency */}
                {(metrics?.balance?.pending ?? 0) > 0 && (
                  <div className="stats-pending">
                    <Clock size={12} />
                    <span>{formatCompactAmount(displayPending, displayCurrency)} pending</span>
                  </div>
                )}
              </div>
              <div className="stats-secondary-row">
                <div className="stats-metric">
                  <div className="stats-metric-value">
                    <AnimatedNumber value={metrics?.subscriberCount ?? 0} duration={500} format={(n) => formatCompactNumber(n)} />
                  </div>
                  <span className="stats-label">
                    {(metrics?.subscriberCount ?? 0) === 1
                      ? (isService ? 'Client' : 'Subscriber')
                      : (isService ? 'Clients' : 'Subscribers')}
                  </span>
                </div>
                <div className="stats-metric">
                  <div className="stats-metric-value">
                    <AnimatedNumber value={displayTotalRevenue} duration={600} format={(n) => formatCompactAmount(n, displayCurrency)} />
                  </div>
                  <span className="stats-label">Total Revenue</span>
                </div>
              </div>
              </section>
            )}

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

            {/* Shareable Link Card - show skeleton while profile loading */}
            {profileLoading ? (
              <div className="link-card">
                <Skeleton width={48} height={48} borderRadius="50%" />
                <div className="link-info">
                  <Skeleton width={140} height={12} />
                  <Skeleton width={100} height={14} style={{ marginTop: 4 }} />
                </div>
              </div>
            ) : (
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
            )}

            {/* Activity Section - show skeleton while activity loading */}
            {activityLoading ? (
              <section className="dash-activity-card">
                <div className="dash-activity-header">
                  <Skeleton width={80} height={18} />
                  <Skeleton width={60} height={14} />
                </div>
                <SkeletonList count={4} />
              </section>
            ) : (
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
            )}
          </>
        )}
      </main>
    </div>
  )
}
