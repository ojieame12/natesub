import { useEffect, useRef, lazy, Suspense, useState } from 'react'
import { BrowserRouter, HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { useOnboardingStore } from './onboarding/store'
import { PageSkeleton, ScrollRestoration, useToast, SplashScreen, AmbientBackground } from './components'
import { useAuthState } from './hooks/useAuthState'
import { AUTH_ERROR_EVENT } from './api/client'
import { isReservedUsername } from './utils/constants'
import './index.css'

// NOTE: Auth token is persisted in localStorage and only cleared on explicit logout
// or when the server returns 401. No forced re-auth on cold start.

// App layout is used by multiple authenticated routes - load eagerly for smooth navigation
import AppLayout from './AppLayout'

// EAGERLY LOADED - main tab bar routes for instant navigation (no flicker)
import Dashboard from './Dashboard'
import Activity from './Activity'
import Profile from './Profile'
import Subscribers from './Subscribers'
import Settings from './Settings'

// Lazy-loaded routes (less frequently accessed)
const OnboardingFlow = lazy(() => import('./onboarding'))
const PaystackConnect = lazy(() => import('./onboarding/PaystackConnect'))
const PaystackOnboardingComplete = lazy(() => import('./PaystackOnboardingComplete'))
const ActivityDetail = lazy(() => import('./ActivityDetail'))
const SubscriberDetail = lazy(() => import('./SubscriberDetail'))
const SentRequests = lazy(() => import('./SentRequests'))
const SelectRecipient = lazy(() => import('./request/SelectRecipient'))
const SelectRelationship = lazy(() => import('./request/SelectRelationship'))
const RequestDetails = lazy(() => import('./request/RequestDetails'))
const PersonalizeRequest = lazy(() => import('./request/PersonalizeRequest'))
const RequestPreview = lazy(() => import('./request/RequestPreview'))
const EditPage = lazy(() => import('./EditPage'))
const Templates = lazy(() => import('./Templates'))
const PaymentSettings = lazy(() => import('./PaymentSettings'))
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
const NotFound = lazy(() => import('./NotFound'))

function isPublicCreatorPage(pathname: string): boolean {
  // Creator pages are single-segment vanity URLs like "/username"
  const slug = pathname.replace(/^\/+|\/+$/g, '')
  if (!slug || slug.includes('/')) return false
  if (!/^[a-z0-9_]{3,20}$/i.test(slug)) return false
  return !isReservedUsername(slug)
}

function isPublicRoute(pathname: string): boolean {
  return (
    pathname === '/onboarding' ||
    pathname === '/' ||
    pathname === '/terms' ||
    pathname === '/privacy' ||
    pathname === '/payment/success' ||
    pathname.startsWith('/onboarding/') ||
    pathname.startsWith('/r/') || // Public request pages
    pathname.startsWith('/verify/') || // Payroll verification pages
    isPublicCreatorPage(pathname)
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

// Storage key for payment confirmation flags (survives page refresh)
const PAYMENT_CONFIRMED_KEY = 'natepay_payment_confirmed'

export function setPaymentConfirmed() {
  try {
    localStorage.setItem(PAYMENT_CONFIRMED_KEY, Date.now().toString())
  } catch { /* ignore */ }
}

function checkAndClearPaymentConfirmed(): boolean {
  try {
    const timestamp = localStorage.getItem(PAYMENT_CONFIRMED_KEY)
    if (timestamp) {
      localStorage.removeItem(PAYMENT_CONFIRMED_KEY)
      // Only valid for 5 minutes (handles webhook race condition)
      const age = Date.now() - parseInt(timestamp, 10)
      return age < 5 * 60 * 1000
    }
  } catch { /* ignore */ }
  return false
}

/**
 * RootRedirect - Smart root route that checks auth before redirecting
 *
 * Avoids the "flash of onboarding" for authenticated users by checking
 * auth state inline before deciding where to redirect.
 */
function RootRedirect() {
  const { status, isFullySetUp, needsPaymentSetup } = useAuthState()

  // Still checking - render nothing (splash screen handles this)
  if (status === 'unknown' || status === 'checking') {
    return null
  }

  // Authenticated - go to appropriate page
  if (status === 'authenticated') {
    if (isFullySetUp) {
      return <Navigate to="/dashboard" replace />
    }
    if (needsPaymentSetup) {
      // Check for payment confirmation (handles webhook race condition)
      if (checkAndClearPaymentConfirmed()) {
        return <Navigate to="/dashboard" replace />
      }
      return <Navigate to="/settings/payments" replace />
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
 */
function InitialRouteRedirect() {
  const navigate = useNavigate()
  const location = useLocation()
  const { status, isFullySetUp, needsPaymentSetup } = useAuthState()
  const hasNavigated = useRef(false)
  const currentStep = useOnboardingStore((s) => s.currentStep)
  const resetOnboarding = useOnboardingStore((s) => s.reset)

  // Only run on /onboarding path (/ is handled by RootRedirect)
  const isOnboardingPath = location.pathname === '/onboarding'

  useEffect(() => {
    // Only run on /onboarding path
    if (!isOnboardingPath) return

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

    // Authenticated - decide where to go
    hasNavigated.current = true

    if (isFullySetUp) {
      navigate('/dashboard', { replace: true })
    } else if (needsPaymentSetup) {
      // Check for payment confirmation (handles webhook race condition)
      if (checkAndClearPaymentConfirmed()) {
        navigate('/dashboard', { replace: true })
      } else {
        navigate('/settings/payments', { replace: true })
      }
    }
    // needsOnboarding: Stay on /onboarding - the flow handles this
  }, [isOnboardingPath, status, isFullySetUp, needsPaymentSetup, currentStep, navigate, resetOnboarding])

  // Reset navigation flag when leaving /onboarding
  useEffect(() => {
    if (!isOnboardingPath) {
      hasNavigated.current = false
    }
  }, [isOnboardingPath])

  return null
}

/**
 * RequireAuth - Protected route wrapper
 *
 * Uses centralized auth state to:
 * - Show splash/skeleton while checking
 * - Redirect to onboarding if unauthenticated or needs profile setup
 * - Redirect to payment settings if needs payment setup
 * - Render children if fully set up
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status, needsOnboarding, needsPaymentSetup } = useAuthState()
  const location = useLocation()

  // Still checking - show skeleton to prevent content flash
  if (status === 'unknown' || status === 'checking') {
    return <PageSkeleton />
  }

  // Unauthenticated - redirect to onboarding
  if (status === 'unauthenticated') {
    return <Navigate to="/onboarding" replace />
  }

  // Authenticated but needs to complete profile - redirect to onboarding
  // (unless already on a settings route where they might be fixing things)
  if (needsOnboarding && !location.pathname.startsWith('/settings')) {
    return <Navigate to="/onboarding" replace />
  }

  // Has profile but needs payment setup - redirect to payment settings
  // (unless already on settings routes)
  if (needsPaymentSetup && !location.pathname.startsWith('/settings')) {
    // Check for payment confirmation (handles webhook race condition)
    if (!checkAndClearPaymentConfirmed()) {
      return <Navigate to="/settings/payments" replace />
    }
  }

  // Fully authenticated and set up - render children
  return <>{children}</>
}

/**
 * AppShell - Main app wrapper with Splashboard pattern
 *
 * Shows SplashScreen while auth is being checked,
 * then renders routes once auth state is confirmed.
 */
function AppShell() {
  const { isReady } = useAuthState()
  const location = useLocation()
  const [showSplash, setShowSplash] = useState(true)
  const [minTimeElapsed, setMinTimeElapsed] = useState(false)

  // Minimum splash display time to prevent flash
  useEffect(() => {
    const timer = setTimeout(() => setMinTimeElapsed(true), 600)
    return () => clearTimeout(timer)
  }, [])

  // Hide splash once auth is ready AND minimum time has elapsed
  useEffect(() => {
    if (isReady && minTimeElapsed) {
      // Small delay for smooth transition
      const timer = setTimeout(() => setShowSplash(false), 100)
      return () => clearTimeout(timer)
    }
  }, [isReady, minTimeElapsed])

  // For public routes, skip splash after minimum time
  const isPublic = isPublicRoute(location.pathname)
  useEffect(() => {
    if (isPublic && minTimeElapsed) {
      setShowSplash(false)
    }
  }, [isPublic, minTimeElapsed])

  // Show splash while checking auth (except for public routes after min time)
  if (showSplash && !isPublic) {
    return <SplashScreen />
  }

  return (
    <>
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

          {/* Main app with tab bar - protected routes */}
          <Route path="/dashboard" element={
            <RequireAuth>
              <AppLayout><Dashboard /></AppLayout>
            </RequireAuth>
          } />
          <Route path="/activity" element={
            <RequireAuth>
              <AppLayout><Activity /></AppLayout>
            </RequireAuth>
          } />
          <Route path="/subscribers" element={
            <RequireAuth>
              <AppLayout><Subscribers /></AppLayout>
            </RequireAuth>
          } />
          <Route path="/profile" element={
            <RequireAuth>
              <AppLayout><Profile /></AppLayout>
            </RequireAuth>
          } />

          {/* Standalone protected pages (no tab bar) */}
          <Route path="/activity/:id" element={<RequireAuth><ActivityDetail /></RequireAuth>} />
          <Route path="/subscribers/:id" element={<RequireAuth><SubscriberDetail /></RequireAuth>} />
          <Route path="/requests" element={<RequireAuth><SentRequests /></RequireAuth>} />

          {/* Targeted Request Flow */}
          <Route path="/request/new" element={<RequireAuth><SelectRecipient /></RequireAuth>} />
          <Route path="/request/relationship" element={<RequireAuth><SelectRelationship /></RequireAuth>} />
          <Route path="/request/details" element={<RequireAuth><RequestDetails /></RequireAuth>} />
          <Route path="/request/personalize" element={<RequireAuth><PersonalizeRequest /></RequireAuth>} />
          <Route path="/request/preview" element={<RequireAuth><RequestPreview /></RequireAuth>} />
          <Route path="/new-request" element={<RequireAuth><SelectRecipient /></RequireAuth>} />

          <Route path="/edit-page" element={<RequireAuth><EditPage /></RequireAuth>} />
          <Route path="/templates" element={<RequireAuth><Templates /></RequireAuth>} />
          <Route path="/settings/payments" element={<RequireAuth><PaymentSettings /></RequireAuth>} />
          <Route path="/settings/payments/complete" element={<RequireAuth><StripeComplete /></RequireAuth>} />
          <Route path="/settings/payments/refresh" element={<RequireAuth><StripeRefresh /></RequireAuth>} />
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

          {/* Public Request Pages - for payment/subscription requests */}
          <Route path="/r/:token" element={<PublicRequestPage />} />
          <Route path="/r/:token/success" element={<PublicRequestPage />} />

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
