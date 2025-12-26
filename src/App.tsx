import { useEffect, useRef, lazy, Suspense, useState } from 'react'
import { BrowserRouter, HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import type { URLOpenListenerEvent } from '@capacitor/app'
import { useOnboardingStore } from './onboarding/store'
import { PageSkeleton, ScrollRestoration, useToast, SplashScreen, AmbientBackground, Pressable } from './components'
import { useAuthState } from './hooks/useAuthState'
import { AUTH_ERROR_EVENT } from './api/client'
import { isReservedUsername } from './utils/constants'
import { prefetchRoutes, prefetchCoreData } from './utils/prefetch'
import './index.css'

// NOTE: Auth token is persisted in localStorage and only cleared on explicit logout
// or when the server returns 401. No forced re-auth on cold start.

// App layout is used by multiple authenticated routes - load eagerly for smooth navigation
import AppLayout from './AppLayout'

// Lazy-loaded routes (chunk-split for faster cold boot / Stripe returns)
const Dashboard = lazy(() => import('./Dashboard'))
const Activity = lazy(() => import('./Activity'))
const Profile = lazy(() => import('./Profile'))
const Subscribers = lazy(() => import('./Subscribers'))
const Settings = lazy(() => import('./Settings'))
const OnboardingFlow = lazy(() => import('./onboarding'))
const PaystackConnect = lazy(() => import('./onboarding/PaystackConnect'))
const PaystackOnboardingComplete = lazy(() => import('./PaystackOnboardingComplete'))
const ActivityDetail = lazy(() => import('./ActivityDetail'))
const SubscriberDetail = lazy(() => import('./SubscriberDetail'))
const SentRequests = lazy(() => import('./SentRequests'))
const SelectRecipient = lazy(() => import('./request/SelectRecipient'))

const RequestPreview = lazy(() => import('./request/RequestPreview'))
const EditPage = lazy(() => import('./EditPage'))
const PageSetupWizard = lazy(() => import('./wizards/PageSetupWizard'))
const Templates = lazy(() => import('./Templates'))
const PaymentSettings = lazy(() => import('./PaymentSettings'))
const PayoutHistory = lazy(() => import('./PayoutHistory'))
const Billing = lazy(() => import('./Billing'))
const HelpSupport = lazy(() => import('./HelpSupport'))
const UserPage = lazy(() => import('./subscribe/UserPage'))
const NewUpdate = lazy(() => import('./updates/NewUpdate'))
const UpdatePreview = lazy(() => import('./updates/UpdatePreview'))
const UpdatesHistory = lazy(() => import('./updates/UpdatesHistory'))
const UpdateDetail = lazy(() => import('./updates/UpdateDetail'))
const PayrollHistory = lazy(() => import('./payroll/PayrollHistory'))
const PayrollDetail = lazy(() => import('./payroll/PayrollDetail'))
const PayrollVerify = lazy(() => import('./payroll/PayrollVerify'))
const StripeComplete = lazy(() => import('./StripeComplete'))
const StripeRefresh = lazy(() => import('./StripeRefresh'))
const PaystackComplete = lazy(() => import('./PaystackComplete'))
const PublicRequestPage = lazy(() => import('./request/PublicRequestPage'))
const Terms = lazy(() => import('./legal/Terms'))
const Privacy = lazy(() => import('./legal/Privacy'))
const Unsubscribe = lazy(() => import('./Unsubscribe'))
const CancelSubscription = lazy(() => import('./CancelSubscription'))
const MySubscriptions = lazy(() => import('./MySubscriptions'))
const Analytics = lazy(() => import('./Analytics'))
const NotFound = lazy(() => import('./NotFound'))

// Screenshot / marketing mocks (opt-in)
const MockIndex = lazy(() => import('./experiments/MockIndex'))
const MockDashboard = lazy(() => import('./experiments/MockDashboard'))
const MockProfile = lazy(() => import('./experiments/MockProfile'))
const MockInvoices = lazy(() => import('./experiments/MockInvoices'))
const MockPayroll = lazy(() => import('./experiments/MockPayroll'))

// Admin dashboard (lazy loaded, isolated from main app)
const AdminRoute = lazy(() => import('./admin/AdminRoute'))
const AdminLayout = lazy(() => import('./admin/AdminLayout'))


function isPublicCreatorPage(pathname: string): boolean {
  // Creator pages are single-segment vanity URLs like "/username"
  const slug = pathname.replace(/^\/+|\/+$/g, '')
  if (!slug || slug.includes('/')) return false
  if (!/^[a-z0-9_]{3,20}$/i.test(slug)) return false
  return !isReservedUsername(slug)
}

function isPublicRoute(pathname: string): boolean {
  // Note: `/` is NOT public - it needs auth check to decide redirect destination
  // Splash screen will show on `/` until auth is ready
  return (
    pathname === '/onboarding' ||
    pathname === '/terms' ||
    pathname === '/privacy' ||
    pathname === '/unsubscribe' ||
    pathname === '/payment/success' ||
    pathname.startsWith('/onboarding/') ||
    pathname.startsWith('/r/') || // Public request pages
    pathname.startsWith('/verify/') || // Payroll verification pages
    isPublicCreatorPage(pathname)
  )
}

function shouldBypassSplash(pathname: string): boolean {
  // These routes are still protected, but showing the splash screen here can feel like
  // an infinite load (e.g., after returning from Stripe which triggers a full reload).
  // We render the route skeleton quickly instead and let RequireAuth handle gating.
  return (
    pathname === '/settings/payments' ||
    pathname === '/settings/payments/complete' ||
    pathname === '/settings/payments/refresh'
  )
}

// Global auth error handler - listens for 401 errors during active sessions
function AuthErrorHandler() {
  const navigate = useNavigate()
  const location = useLocation()
  const reset = useOnboardingStore((s) => s.reset)
  const toast = useToast()
  const isHandling = useRef(false)

  useEffect(() => {
    function handleAuthError() {
      // Prevent multiple simultaneous handling
      if (isHandling.current) return
      isHandling.current = true

      // On public routes, notify user but don't redirect (they can continue viewing)
      if (isPublicRoute(location.pathname)) {
        toast.info('Session expired. Sign in to access your dashboard.')
        isHandling.current = false
        return
      }

      // On protected routes, show warning and redirect to login
      toast.warning('Session expired. Please sign in again.')

      // Small delay to let user see the toast before redirect
      setTimeout(() => {
        reset()
        navigate('/onboarding', { replace: true, state: { sessionExpired: true } })
        isHandling.current = false
      }, 500)
    }

    window.addEventListener(AUTH_ERROR_EVENT, handleAuthError)
    return () => window.removeEventListener(AUTH_ERROR_EVENT, handleAuthError)
  }, [navigate, location.pathname, reset, toast])

  return null
}

/**
 * RootRedirect - Smart root route that checks auth before redirecting
 *
 * Avoids the "flash of onboarding" for authenticated users by checking
 * auth state inline before deciding where to redirect.
 */
function RootRedirect() {
  const { status, isFullySetUp, needsPaymentSetup, refetch } = useAuthState()

  // Still checking - show skeleton (splash may be suppressed for returning users)
  if (status === 'unknown' || status === 'checking') {
    return <PageSkeleton />
  }

  // Network/server error - show retry UI instead of redirecting
  if (status === 'error') {
    return (
      <div className="auth-error-page">
        <div className="auth-error-content">
          <div className="auth-error-icon">!</div>
          <h1>Connection Error</h1>
          <p>Unable to connect. Please check your connection and try again.</p>
          <Pressable className="auth-error-retry-btn" onClick={() => refetch()}>
            Try Again
          </Pressable>
        </div>
      </div>
    )
  }

  // Authenticated - go to appropriate page
  if (status === 'authenticated') {
    if (isFullySetUp) {
      return <Navigate to="/dashboard" replace />
    }
    if (needsPaymentSetup) {
      // Allow dashboard access (Zero State will handle setup)
      return <Navigate to="/dashboard" replace />
    }
    // needsOnboarding - go to onboarding
    return <Navigate to="/onboarding" replace />
  }

  // Unauthenticated - go to onboarding (signup/login)
  return <Navigate to="/onboarding" replace />
}

/**
 * InitialRouteRedirect - Handles navigation from /onboarding once auth is confirmed
 *
 * This handles the case where user lands directly on /onboarding but is already authenticated.
 * Also hydrates the onboarding store from server data for resume functionality.
 */
function InitialRouteRedirect() {
  const navigate = useNavigate()
  const location = useLocation()
  const { status, isFullySetUp, needsPaymentSetup, onboarding } = useAuthState()
  const hasNavigated = useRef(false)
  const hasHydrated = useRef(false)
  const currentStep = useOnboardingStore((s) => s.currentStep)
  const resetOnboarding = useOnboardingStore((s) => s.reset)
  const hydrateFromServer = useOnboardingStore((s) => s.hydrateFromServer)

  // Only run on /onboarding path (/ is handled by RootRedirect)
  const isOnboardingPath = location.pathname === '/onboarding'

  useEffect(() => {
    // Only run on /onboarding path
    if (!isOnboardingPath) return
    // If an explicit ?step= is provided, do not auto-redirect away from onboarding.
    // This is critical for returning from payment onboarding flows (e.g., StripeComplete → /onboarding?step=6).
    const params = new URLSearchParams(location.search)
    if (params.has('step')) return

    // Only navigate once per mount
    if (hasNavigated.current) return

    // Wait for auth to be confirmed
    if (status !== 'authenticated' && status !== 'unauthenticated') return

    // Unauthenticated: reset stale post-auth state and stay on onboarding
    if (status === 'unauthenticated') {
      if (currentStep >= 3) {
        resetOnboarding()
      }
      return
    }

    // Authenticated - hydrate store from server if we have saved progress
    // This handles the case where user returns to /onboarding with saved progress
    if (
      !hasHydrated.current &&
      ((onboarding?.step && onboarding.step > 0) || currentStep < 3)
    ) {
      hasHydrated.current = true

      // If server has a saved step, use it.
      // If not, but we are authenticated, we must be at least at Step 3 (Identity).
      // This prevents the "Login Loop" (Start -> Email -> OTP -> Start).
      const serverStep = onboarding?.step || 0
      const safeStep = Math.max(serverStep, 3)

      // Only force update if we are sitting at Step 0, 1, or 2 (Auth steps)
      if (currentStep < 3) {
        hydrateFromServer({
          step: safeStep,
          data: onboarding?.data,
        })
      }
      // Don't navigate - let user continue onboarding from restored step
      return
    }


    // Authenticated - decide where to go
    hasNavigated.current = true

    // Check for returnTo in location state (e.g., from /unsubscribe)
    const returnTo = (location.state as { returnTo?: string } | null)?.returnTo

    if (isFullySetUp) {
      // Honor returnTo if present, otherwise go to dashboard
      navigate(returnTo || '/dashboard', { replace: true })
    } else if (needsPaymentSetup) {
      navigate('/dashboard', { replace: true })
    }
    // needsOnboarding: Stay on /onboarding - the flow handles this
  }, [isOnboardingPath, location.search, status, isFullySetUp, needsPaymentSetup, currentStep, onboarding, navigate, resetOnboarding, hydrateFromServer])

  // Reset flags when leaving /onboarding
  useEffect(() => {
    if (!isOnboardingPath) {
      hasNavigated.current = false
      hasHydrated.current = false
    }
  }, [isOnboardingPath])

  return null
}

/**
 * RequireAuth - Protected route wrapper
 *
 * Uses centralized auth state to:
 * - Show splash/skeleton while checking
 * - Show error UI with retry if network/server error
 * - Redirect to onboarding if unauthenticated or needs profile setup
 * - Redirect to payment settings if needs payment setup
 * - Render children if fully set up
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status, needsOnboarding, onboarding, refetch } = useAuthState()
  const location = useLocation()

  // Still checking - show skeleton to prevent content flash
  if (status === 'unknown' || status === 'checking') {
    return <PageSkeleton />
  }

  // Network/server error - show retry UI instead of redirecting
  // This prevents unwanted redirects during outages
  if (status === 'error') {
    return (
      <div className="auth-error-page">
        <div className="auth-error-content">
          <div className="auth-error-icon">!</div>
          <h1>Connection Error</h1>
          <p>Unable to verify your session. Please check your connection and try again.</p>
          <Pressable className="auth-error-retry-btn" onClick={() => refetch()}>
            Try Again
          </Pressable>
        </div>
      </div>
    )
  }

  // Unauthenticated - redirect to onboarding
  if (status === 'unauthenticated') {
    return <Navigate to="/onboarding" replace />
  }

  // Authenticated but needs to complete profile - redirect to onboarding
  // (unless on settings or my-subscriptions - subscriber-only users can manage their subscriptions)
  if (needsOnboarding) {
    const isSubscriberRoute =
      location.pathname.startsWith('/onboarding') ||
      location.pathname.startsWith('/my-subscriptions') ||
      location.pathname.startsWith('/settings') ||
      location.pathname.startsWith('/unsubscribe')

    if (!isSubscriberRoute) {
      return <Navigate to={onboarding?.redirectTo || '/onboarding'} replace />
    }
  }

  return <>{children}</>
}

/**
 * AppShell - Main app wrapper with Splashboard pattern
 *
 * Shows SplashScreen while auth is being checked,
 * then renders routes once auth state is confirmed.
 */
function AppShell() {
  const { isReady, status } = useAuthState()
  const location = useLocation()
  const navigate = useNavigate()

  // Only show splash on true cold start - not on remounts (HMR, error recovery, etc.)
  // Safe sessionStorage access - handles Safari private mode, in-app browsers
  const hasShownSplash = (() => {
    try {
      return sessionStorage.getItem('splash_shown') === 'true'
    } catch {
      return false
    }
  })()
  const [showSplash, setShowSplash] = useState(!hasShownSplash)
  const [splashExiting, setSplashExiting] = useState(false)
  const [minTimeElapsed, setMinTimeElapsed] = useState(false)
  const hasPrefetched = useRef(false)
  const enableMockRoutes =
    import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCK_ROUTES === 'true'

  // Mark splash as shown when it's hidden (persists across remounts within session)
  useEffect(() => {
    if (!showSplash) {
      try {
        sessionStorage.setItem('splash_shown', 'true')
      } catch {
        // Storage blocked - ignore
      }
    }
  }, [showSplash])

  // Prefetch main routes and core data when auth completes
  useEffect(() => {
    if (status === 'authenticated' && !hasPrefetched.current) {
      hasPrefetched.current = true
      // Prefetch main tab routes so they're ready when user lands on dashboard
      prefetchRoutes(['/dashboard', '/activity', '/subscribers', '/profile'])
      // Prefetch core data (profile, metrics) so navigation feels instant
      prefetchCoreData()
    }
  }, [status])

  // Deep link handler for iOS Universal Links / Android App Links
  // When the app is opened via a link (e.g., after Stripe redirect), navigate to the path
  useEffect(() => {
    const handleDeepLink = (event: URLOpenListenerEvent) => {
      // Extract path from URL (e.g., https://natepay.co/settings/payments/complete -> /settings/payments/complete)
      const url = new URL(event.url)
      const path = url.pathname + url.search

      // Navigate to the path
      if (path && path !== '/') {
        navigate(path, { replace: true })
      }
    }

    // Only listen on native platforms
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.addListener('appUrlOpen', handleDeepLink)

      return () => {
        CapacitorApp.removeAllListeners()
      }
    }
  }, [navigate])

  // Minimum splash display time to prevent flash (reduced from 600ms)
  useEffect(() => {
    const timer = setTimeout(() => setMinTimeElapsed(true), 200)
    return () => clearTimeout(timer)
  }, [])

  // Hide splash once auth is ready AND minimum time has elapsed
  // Uses exit animation for smooth transition
  useEffect(() => {
    if (isReady && minTimeElapsed && !splashExiting) {
      // Start exit animation
      setSplashExiting(true)
      // Remove splash after animation completes (300ms)
      const timer = setTimeout(() => setShowSplash(false), 300)
      return () => clearTimeout(timer)
    }
  }, [isReady, minTimeElapsed, splashExiting])

  // For public routes (and a few protected return routes), skip splash after minimum time
  const isPublic = isPublicRoute(location.pathname)
  const bypassSplash = isPublic || shouldBypassSplash(location.pathname)
  useEffect(() => {
    if (bypassSplash && minTimeElapsed && !splashExiting) {
      setSplashExiting(true)
      const timer = setTimeout(() => setShowSplash(false), 300)
      return () => clearTimeout(timer)
    }
  }, [bypassSplash, minTimeElapsed, splashExiting])

  // Show splash while checking auth (except for public routes after min time)
  // When splash is exiting, render content underneath so exit animation overlays it
  const showSplashOverlay = showSplash && !bypassSplash && !splashExiting

  return (
    <>
      {/* Splash overlay - shown during auth check, fades out when ready */}
      {showSplashOverlay && <SplashScreen />}
      {showSplash && splashExiting && <SplashScreen exiting />}

      {/* Global "Liquid Glass" Atmosphere - persists across all routes */}
      <AmbientBackground />
      <ScrollRestoration />
      <InitialRouteRedirect />
      <AuthErrorHandler />
      <Suspense fallback={<PageSkeleton />}>
        <Routes>
          {/* Root redirect - Smart redirect based on auth state */}
          <Route path="/" element={<RootRedirect />} />

          {/* Onboarding - public */}
          <Route path="/onboarding" element={<OnboardingFlow />} />
          <Route path="/onboarding/paystack" element={<PaystackConnect />} />
          <Route path="/onboarding/paystack/complete" element={<PaystackOnboardingComplete />} />

          {/* Main app with tab bar - protected routes using layout route pattern */}
          {/* RequireAuth + AppLayout persist across tab navigation, only content changes */}
          <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/subscribers" element={<Subscribers />} />
            <Route path="/profile" element={<Profile />} />
          </Route>

          {/* Analytics - protected but no tab bar */}
          <Route path="/analytics" element={<RequireAuth><Analytics /></RequireAuth>} />

          {/* Standalone protected pages (no tab bar) */}
          <Route path="/activity/:id" element={<RequireAuth><ActivityDetail /></RequireAuth>} />
          <Route path="/subscribers/:id" element={<RequireAuth><SubscriberDetail /></RequireAuth>} />
          <Route path="/requests" element={<RequireAuth><SentRequests /></RequireAuth>} />

          {/* Targeted Request Flow */}
          <Route path="/new-request" element={<RequireAuth><SelectRecipient /></RequireAuth>} />
          <Route path="/request/preview" element={<RequireAuth><RequestPreview /></RequireAuth>} />

          <Route path="/edit-page" element={<RequireAuth><EditPage /></RequireAuth>} />
          <Route path="/setup-page" element={<RequireAuth><PageSetupWizard /></RequireAuth>} />
          <Route path="/templates" element={<RequireAuth><Templates /></RequireAuth>} />
          <Route path="/settings/payments" element={<RequireAuth><PaymentSettings /></RequireAuth>} />
          <Route path="/settings/payments/complete" element={<RequireAuth><StripeComplete /></RequireAuth>} />
          <Route path="/settings/payments/refresh" element={<RequireAuth><StripeRefresh /></RequireAuth>} />
          <Route path="/settings/payouts" element={<RequireAuth><PayoutHistory /></RequireAuth>} />
          <Route path="/payment/success" element={<PaystackComplete />} />
          <Route path="/settings/billing" element={<RequireAuth><Billing /></RequireAuth>} />
          <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
          <Route path="/settings/help" element={<RequireAuth><HelpSupport /></RequireAuth>} />

          {/* Updates */}
          <Route path="/updates" element={<RequireAuth><UpdatesHistory /></RequireAuth>} />
          <Route path="/updates/new" element={<RequireAuth><NewUpdate /></RequireAuth>} />
          <Route path="/updates/preview" element={<RequireAuth><UpdatePreview /></RequireAuth>} />
          <Route path="/updates/:id" element={<RequireAuth><UpdateDetail /></RequireAuth>} />

          {/* Payroll (Service providers only) */}
          <Route path="/payroll" element={<RequireAuth><PayrollHistory /></RequireAuth>} />
          <Route path="/payroll/:periodId" element={<RequireAuth><PayrollDetail /></RequireAuth>} />

          {/* Public Payroll Verification */}
          <Route path="/verify/:code" element={<PayrollVerify />} />

          {/* Legal pages */}
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          {/* Legacy redirects for old static HTML links */}
          <Route path="/terms.html" element={<Navigate to="/terms" replace />} />
          <Route path="/privacy.html" element={<Navigate to="/privacy" replace />} />

          {/* Email management */}
          <Route path="/unsubscribe" element={<Unsubscribe />} />
          {/* 1-click subscription cancellation via signed token (Visa VAMP compliance) */}
          <Route path="/unsubscribe/:token" element={<CancelSubscription />} />
          <Route path="/my-subscriptions" element={<RequireAuth><MySubscriptions /></RequireAuth>} />

          {/* Public Request Pages - for payment/subscription requests */}
          <Route path="/r/:token" element={<PublicRequestPage />} />
          <Route path="/r/:token/success" element={<PublicRequestPage />} />

          {/* Screenshot / marketing mocks (only when enabled) */}
          {enableMockRoutes && (
            <>
              <Route path="/mocks" element={<MockIndex />} />
              <Route path="/mocks/dashboard" element={<MockDashboard />} />
              <Route path="/mocks/profile" element={<MockProfile />} />
              <Route path="/mocks/invoices" element={<MockInvoices />} />
              <Route path="/mocks/payroll" element={<MockPayroll />} />
            </>
          )}

          {/* Admin Dashboard - isolated from main app */}
          <Route path="/admin/*" element={
            <AdminRoute>
              <AdminLayout />
            </AdminRoute>
          } />

          {/* Vanity URLs - natepay.co/username */}
          {/* This must be LAST before the catch-all */}
          <Route path="/:username" element={<UserPage />} />

          {/* 404 Not Found - better UX than redirect to onboarding */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  )
}

// Use HashRouter for native apps (iOS/Android), BrowserRouter for web
const isNative = Capacitor.isNativePlatform()

function App() {
  // Conditionally render router based on platform
  const RouterComponent = isNative ? HashRouter : BrowserRouter

  return (
    <RouterComponent>
      <AppShell />
    </RouterComponent>
  )
}

export default App
// Force rebuild Wed Dec 17 16:21:37 SAST 2025
