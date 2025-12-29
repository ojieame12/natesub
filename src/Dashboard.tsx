import { useState, useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from './api/client'
import { getShareableLink } from './utils/constants'
import { Menu, Bell, Copy, Share2, Check, RefreshCw, Clock, ChevronRight, CreditCard } from 'lucide-react'
import { Pressable, useToast, Skeleton, ErrorState } from './components'
import { useViewTransition, useDelayedLoading } from './hooks'
import { useCurrentUser, useMetrics, useActivity, useProfile, useAnalyticsStats, useNotifications } from './api/hooks'
import { centsToDisplayAmount } from './utils/currency'
import { SlideOutMenu, NotificationsPanel, StatsCard, ActivityFeed } from './dashboard/index'
import { queryKeys } from './api/queryKeys'
import './Dashboard.css'

// Pre-load subscription page component to avoid serial waterfall
const preloadSubscriptionPage = () => {
  // This will be cached by the browser after first load
  import('./subscribe/SubscribeBoundary')
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
  const { data: profileData, isLoading: profileLoadingRaw, refetch: refetchProfile } = useProfile()
  const { data: metricsData, isLoading: metricsLoadingRaw, isError: metricsError, refetch: refetchMetrics } = useMetrics()
  const { data: activityData, isLoading: activityLoading, isError: activityError, refetch: refetchActivity } = useActivity(5)
  const { refetch: refetchAnalytics } = useAnalyticsStats()
  const { notifications, unreadCount, isError: notificationsError, markAsRead, markAllAsRead, refetch: refetchNotifications } = useNotifications(10)

  // Delay showing skeletons to prevent flash on fast cache hits
  const profileLoading = useDelayedLoading(profileLoadingRaw)
  const metricsLoading = useDelayedLoading(metricsLoadingRaw)

  const profile = profileData?.profile
  const metrics = metricsData?.metrics
  const activities = activityData?.pages?.[0]?.activities || []
  const currencyCode = (profile?.currency || currentUser?.profile?.currency || 'USD').toUpperCase()

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
      const results = await Promise.all([
        refetchProfile(),
        refetchMetrics(),
        refetchActivity(),
        refetchAnalytics(),
      ])
      // Refresh complete - all queries settled
      void results
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

      startYRef.current = null
      startXRef.current = null
      intentDetectedRef.current = null
      isPullingRef.current = false

      if (shouldRefresh) {
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
      queryKey: queryKeys.publicProfile(username),
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
            {unreadCount > 0 && <span className="notification-dot" />}
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
      <SlideOutMenu
        open={menuOpen}
        onClose={closeMenu}
        onNavigate={navigate}
        displayName={displayName}
        username={username}
        avatarUrl={profile?.avatarUrl}
      />

      {/* Notifications Panel */}
      <NotificationsPanel
        open={notificationsOpen}
        onClose={closeNotifications}
        notifications={notifications}
        unreadCount={unreadCount}
        isError={notificationsError}
        onRetry={refetchNotifications}
        onMarkAsRead={markAsRead}
        onMarkAllAsRead={markAllAsRead}
      />

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
            {/* Stats Card */}
            <StatsCard
              loading={metricsLoading}
              mrr={displayMrr}
              subscriberCount={metrics?.subscriberCount ?? 0}
              totalRevenue={displayTotalRevenue}
              pendingBalance={displayPending}
              displayCurrency={displayCurrency}
              profileCurrency={currencyCode}
              payoutCurrency={payoutCurrency}
              currencyView={currencyView}
              canToggle={canToggle}
              onToggleCurrency={() => setCurrencyView(v => v === 'profile' ? 'payout' : 'profile')}
            />

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

            {/* Activity Section */}
            <ActivityFeed
              loading={activityLoading}
              activities={activities}
              defaultCurrency={currencyCode}
              onNavigate={navigate}
            />
          </>
        )}
      </main>
    </div>
  )
}
