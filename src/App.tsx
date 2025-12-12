import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import OnboardingFlow from './onboarding'
import PaystackConnect from './onboarding/PaystackConnect'
import { useOnboardingStore } from './onboarding/store'
import AppLayout from './AppLayout'
import Dashboard from './Dashboard'
import Activity from './Activity'
import ActivityDetail from './ActivityDetail'
import Subscribers from './Subscribers'
import SubscriberDetail from './SubscriberDetail'
import SentRequests from './SentRequests'
import SelectRecipient from './request/SelectRecipient'
import SelectRelationship from './request/SelectRelationship'
import RequestDetails from './request/RequestDetails'
import PersonalizeRequest from './request/PersonalizeRequest'
import RequestPreview from './request/RequestPreview'
import EditPage from './EditPage'
import Templates from './Templates'
import PaymentSettings from './PaymentSettings'
import Billing from './Billing'
import Settings from './Settings'
import HelpSupport from './HelpSupport'
import Profile from './Profile'
import UserPage from './subscribe/UserPage'
import NewUpdate from './updates/NewUpdate'
import UpdatePreview from './updates/UpdatePreview'
import UpdatesHistory from './updates/UpdatesHistory'
import UpdateDetail from './updates/UpdateDetail'
import PayrollHistory from './payroll/PayrollHistory'
import PayrollDetail from './payroll/PayrollDetail'
import StripeComplete from './StripeComplete'
import StripeRefresh from './StripeRefresh'
import { useCurrentUser } from './api/hooks'
import { getAuthToken } from './api/client'
import './index.css'

// Auth check on app launch - redirects based on user state
function AuthRedirect() {
  const navigate = useNavigate()
  const location = useLocation()
  const { hydrateFromServer } = useOnboardingStore()
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
      const { hasProfile, hasActivePayment, step, branch, data } = user.onboarding

      // Only redirect if we're on a route that should be redirected
      const shouldRedirect = location.pathname === '/' ||
        location.pathname === '/onboarding'

      if (shouldRedirect) {
        if (hasProfile && hasActivePayment) {
          navigate('/dashboard', { replace: true })
        } else if (hasProfile && !hasActivePayment) {
          navigate('/settings/payments', { replace: true })
        } else if (step && step >= 3) {
          // Resume onboarding from saved step
          hydrateFromServer({ step, branch, data })
          navigate('/onboarding', { replace: true })
        }
      }
    }

    setChecked(true)
  }, [user, isLoading, error, hasToken, checked, location.pathname])

  return null
}

function App() {
  return (
    <BrowserRouter>
      <AuthRedirect />
      <Routes>
        {/* Onboarding */}
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
            <Activity />
          </AppLayout>
        } />
        <Route path="/subscribers" element={
          <AppLayout>
            <Subscribers />
          </AppLayout>
        } />
        <Route path="/profile" element={
          <AppLayout>
            <Profile />
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
    </BrowserRouter>
  )
}

export default App
