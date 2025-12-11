import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import OnboardingFlow from './onboarding'
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
import StripeComplete from './StripeComplete'
import StripeRefresh from './StripeRefresh'
import './index.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Onboarding */}
        <Route path="/onboarding" element={<OnboardingFlow />} />

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
