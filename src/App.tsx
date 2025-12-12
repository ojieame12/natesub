import { useEffect, useState, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { useOnboardingStore } from './onboarding/store'
import { PageSkeleton, ScrollRestoration } from './components'
import { useCurrentUser } from './api/hooks'
import { getAuthToken, AUTH_ERROR_EVENT } from './api/client'
import './index.css'

// Critical paths - load eagerly
import OnboardingFlow from './onboarding'
import AppLayout from './AppLayout'
import Dashboard from './Dashboard'

// Lazy-loaded routes
const PaystackConnect = lazy(() => import('./onboarding/PaystackConnect'))
const Activity = lazy(() => import('./Activity'))
const ActivityDetail = lazy(() => import('./ActivityDetail'))
const Subscribers = lazy(() => import('./Subscribers'))
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
const Settings = lazy(() => import('./Settings'))
const HelpSupport = lazy(() => import('./HelpSupport'))
const Profile = lazy(() => import('./Profile'))
const UserPage = lazy(() => import('./subscribe/UserPage'))
const NewUpdate = lazy(() => import('./updates/NewUpdate'))
const UpdatePreview = lazy(() => import('./updates/UpdatePreview'))
const UpdatesHistory = lazy(() => import('./updates/UpdatesHistory'))
const UpdateDetail = lazy(() => import('./updates/UpdateDetail'))
const PayrollHistory = lazy(() => import('./payroll/PayrollHistory'))
const PayrollDetail = lazy(() => import('./payroll/PayrollDetail'))
const StripeComplete = lazy(() => import('./StripeComplete'))
const StripeRefresh = lazy(() => import('./StripeRefresh'))

// Global auth error handler - listens for 401 errors and redirects to login
function AuthErrorHandler() {
  const navigate = useNavigate()
  const location = useLocation()
  const { reset } = useOnboardingStore()

  useEffect(() => {
    function handleAuthError() {
      // Don't redirect if already on onboarding
      if (location.pathname === '/onboarding' || location.pathname === '/') {
        return
      }

      // Clear onboarding store and redirect to login
      reset()
      navigate('/onboarding', { replace: true, state: { sessionExpired: true } })
    }

    window.addEventListener(AUTH_ERROR_EVENT, handleAuthError)
    return () => window.removeEventListener(AUTH_ERROR_EVENT, handleAuthError)
  }, [navigate, location.pathname, reset])

  return null
}

// Auth check on app launch - redirects based on user state
function AuthRedirect() {
  const navigate = useNavigate()
  const location = useLocation()
  const [checked, setChecked] = useState(false)

  // Only check auth if we have a token
  const hasToken = !!getAuthToken()
  const { data: user, isLoading, error } = useCurrentUser()

  useEffect(() => {
    // Skip if already checked, loading, or no token
    if (checked || isLoading) return
    if (!hasToken) {
      setChecked(true)
      return
    }

    // If error (401), token is invalid - stay on current route
    if (error) {
      setChecked(true)
      return
    }

    // If we have user data, check their state
    if (user?.onboarding) {
      const { hasProfile, hasActivePayment } = user.onboarding

      // Only redirect if we're on a route that should be redirected
      const shouldRedirect = location.pathname === '/' ||
        location.pathname === '/onboarding'

      if (shouldRedirect) {
        if (hasProfile && hasActivePayment) {
          // Fully set up - go to dashboard
          navigate('/dashboard', { replace: true })
        } else if (hasProfile && !hasActivePayment) {
          // Profile exists but no payment - go to payment settings
          navigate('/settings/payments', { replace: true })
        }
        // Note: Don't auto-resume onboarding here - let OtpStep handle it
        // after the user verifies their email. This prevents bypassing OTP.
      }
    }

    setChecked(true)
  }, [user, isLoading, error, hasToken, checked, location.pathname])

  return null
}

function App() {
  return (
    <BrowserRouter>
      <ScrollRestoration />
      <AuthRedirect />
      <AuthErrorHandler />
      <Suspense fallback={<PageSkeleton />}>
        <Routes>
          {/* Onboarding - eager loaded */}
          <Route path="/onboarding" element={<OnboardingFlow />} />
          <Route path="/onboarding/paystack" element={<PaystackConnect />} />

          {/* Main app with tab bar */}
          <Route path="/dashboard" element={
            <AppLayout>
              <Dashboard />
            </AppLayout>
          } />
          <Route path="/activity" element={
            <AppLayout>
              <Suspense fallback={<PageSkeleton variant="list" />}>
                <Activity />
              </Suspense>
            </AppLayout>
          } />
          <Route path="/subscribers" element={
            <AppLayout>
              <Suspense fallback={<PageSkeleton variant="list" />}>
                <Subscribers />
              </Suspense>
            </AppLayout>
          } />
          <Route path="/profile" element={
            <AppLayout>
              <Suspense fallback={<PageSkeleton variant="detail" />}>
                <Profile />
              </Suspense>
            </AppLayout>
          } />

          {/* Standalone pages (no tab bar) */}
          <Route path="/activity/:id" element={<ActivityDetail />} />
          <Route path="/subscribers/:id" element={<SubscriberDetail />} />
          <Route path="/requests" element={<SentRequests />} />

          {/* Targeted Request Flow */}
          <Route path="/request/new" element={<SelectRecipient />} />
          <Route path="/request/relationship" element={<SelectRelationship />} />
          <Route path="/request/details" element={<RequestDetails />} />
          <Route path="/request/personalize" element={<PersonalizeRequest />} />
          <Route path="/request/preview" element={<RequestPreview />} />
          <Route path="/new-request" element={<SelectRecipient />} />

          <Route path="/edit-page" element={<EditPage />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="/settings/payments" element={<PaymentSettings />} />
          <Route path="/settings/payments/complete" element={<StripeComplete />} />
          <Route path="/settings/payments/refresh" element={<StripeRefresh />} />
          <Route path="/settings/billing" element={<Billing />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/help" element={<HelpSupport />} />

          {/* Updates */}
          <Route path="/updates" element={<UpdatesHistory />} />
          <Route path="/updates/new" element={<NewUpdate />} />
          <Route path="/updates/preview" element={<UpdatePreview />} />
          <Route path="/updates/:id" element={<UpdateDetail />} />

          {/* Payroll (Service providers only) */}
          <Route path="/payroll" element={<PayrollHistory />} />
          <Route path="/payroll/:periodId" element={<PayrollDetail />} />

          {/* Vanity URLs - natepay.co/username */}
          {/* This must be LAST before the catch-all */}
          <Route path="/:username" element={<UserPage />} />

          {/* Default redirect */}
          <Route path="*" element={<Navigate to="/onboarding" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
