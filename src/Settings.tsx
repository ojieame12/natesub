import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Mail, Bell, Eye, Download, Trash2, LogOut, CreditCard, Loader2 } from 'lucide-react'
import { Pressable, useToast } from './components'
import { useCurrentUser, useLogout, useDeleteAccount, useSettings, useUpdateSettings, useBillingStatus } from './api/hooks'
import { getPricing } from './utils/pricing'

import './Settings.css'

// Helper to get days remaining in trial
function getTrialDaysRemaining(trialEndsAt: string | null): number {
  if (!trialEndsAt) return 0
  const now = new Date()
  const end = new Date(trialEndsAt)
  const diff = end.getTime() - now.getTime()
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)))
}

// Toggle component
interface ToggleProps {
  value: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}

const Toggle = ({ value, onChange, disabled }: ToggleProps) => {
  return (
    <div
      className={`toggle ${value ? 'on' : ''} ${disabled ? 'disabled' : ''}`}
      onClick={() => !disabled && onChange(!value)}
    >
      <div className="toggle-knob" />
    </div>
  )
}

export default function Settings() {
  const navigate = useNavigate()
  const toast = useToast()

  // API hooks
  const { data: user } = useCurrentUser()
  const { data: settings } = useSettings()
  const { data: billingData } = useBillingStatus()
  const { mutateAsync: updateSettings } = useUpdateSettings()
  const { mutateAsync: logout } = useLogout()
  const { mutateAsync: deleteAccount, isPending: isDeleting } = useDeleteAccount()

  // Billing status
  const isService = user?.profile?.purpose === 'service'
  const subscriptionStatus = billingData?.subscription?.status
  const trialDaysLeft = getTrialDaysRemaining(billingData?.subscription?.trialEndsAt || null)

  // Local state for toggles (optimistic UI)
  const [pushNotifications, setPushNotifications] = useState(true)
  const [emailNotifications, setEmailNotifications] = useState(true)
  const [newSubscriberAlerts, setNewSubscriberAlerts] = useState(true)
  const [paymentAlerts, setPaymentAlerts] = useState(true)
  const [isPublic, setIsPublic] = useState(true)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Sync local state with server data
  useEffect(() => {
    if (settings) {
      const prefs = settings.notificationPrefs
      setPushNotifications(prefs?.push ?? true)
      setEmailNotifications(prefs?.email ?? true)
      setNewSubscriberAlerts(prefs?.subscriberAlerts ?? true)
      setPaymentAlerts(prefs?.paymentAlerts ?? true)
      setIsPublic(settings.isPublic ?? true)
    }
  }, [settings])

  // Don't block UI for loading - show UI immediately

  // Save notification preference to backend
  const handleNotificationChange = async (key: string, value: boolean) => {
    // Optimistic update
    switch (key) {
      case 'push': setPushNotifications(value); break
      case 'email': setEmailNotifications(value); break
      case 'subscriberAlerts': setNewSubscriberAlerts(value); break
      case 'paymentAlerts': setPaymentAlerts(value); break
    }

    try {
      await updateSettings({
        notificationPrefs: {
          push: key === 'push' ? value : pushNotifications,
          email: key === 'email' ? value : emailNotifications,
          subscriberAlerts: key === 'subscriberAlerts' ? value : newSubscriberAlerts,
          paymentAlerts: key === 'paymentAlerts' ? value : paymentAlerts,
        },
      })
    } catch {
      // Revert on error
      switch (key) {
        case 'push': setPushNotifications(!value); break
        case 'email': setEmailNotifications(!value); break
        case 'subscriberAlerts': setNewSubscriberAlerts(!value); break
        case 'paymentAlerts': setPaymentAlerts(!value); break
      }
      toast.error('Failed to update setting')
    }
  }

  // Toggle profile visibility
  const handleVisibilityToggle = async () => {
    const newValue = !isPublic
    setIsPublic(newValue)

    try {
      await updateSettings({ isPublic: newValue })
      toast.success(newValue ? 'Profile is now public' : 'Profile is now private')
    } catch {
      setIsPublic(!newValue)
      toast.error('Failed to update visibility')
    }
  }

  const handleLogout = async () => {
    try {
      await logout()
      localStorage.removeItem('natepay-onboarding')
      localStorage.removeItem('natepay-request')
      navigate('/onboarding')
    } catch {
      toast.error('Failed to log out')
    }
  }

  const handleDeleteAccount = async () => {
    try {
      await deleteAccount()
      localStorage.clear()
      setShowDeleteConfirm(false)
      toast.success('Account deleted')
      navigate('/onboarding')
    } catch {
      toast.error('Failed to delete account')
    }
  }

  const handleExportData = () => {
    toast.info('Data export coming soon')
  }

  return (
    <div className="settings-page">
      {/* Header */}
      <header className="settings-header">
        <Pressable className="back-btn" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </Pressable>
        <img src="/logo.svg" alt="NatePay" className="header-logo" />
        <div className="header-spacer" />
      </header>

      <div className="settings-content">
        {/* Account Section */}
        <section className="settings-section">
          <h3 className="section-label">Account</h3>
          <div className="settings-card">
            <div className="settings-row">
              <Mail size={20} className="settings-icon" />
              <div className="settings-info">
                <span className="settings-row-title">Email</span>
                <span className="settings-row-value">{user?.email || 'Not set'}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Subscription Section */}
        <section className="settings-section">
          <h3 className="section-label">Subscription</h3>
          <div className="settings-card">
            <Pressable className="settings-row" onClick={() => navigate('/settings/billing')}>
              <CreditCard size={20} className="settings-icon" />
              <div className="settings-info">
                <span className="settings-row-title">Billing</span>
                <span className="settings-row-value">
                  {isService && subscriptionStatus === 'trialing' ? (
                    `Free Trial · ${trialDaysLeft} days left`
                  ) : isService && subscriptionStatus === 'active' ? (
                    'Service Plan · $5/mo'
                  ) : isService && subscriptionStatus === 'past_due' ? (
                    'Payment Failed'
                  ) : isService && !subscriptionStatus ? (
                    'Start Free Trial'
                  ) : (
                    `${getPricing(user?.profile?.purpose).planName} · ${getPricing(user?.profile?.purpose).transactionFeeLabel} fees`
                  )}
                </span>
              </div>
              <ChevronRight size={18} className="settings-chevron" />
            </Pressable>
          </div>
        </section>

        {/* Notifications Section */}
        <section className="settings-section">
          <h3 className="section-label">Notifications</h3>
          <div className="settings-card">
            <div className="settings-row">
              <Bell size={20} className="settings-icon" />
              <div className="settings-info">
                <span className="settings-row-title">Push Notifications</span>
              </div>
              <Toggle value={pushNotifications} onChange={(v) => handleNotificationChange('push', v)} />
            </div>
            <div className="settings-row">
              <Mail size={20} className="settings-icon" />
              <div className="settings-info">
                <span className="settings-row-title">Email Notifications</span>
              </div>
              <Toggle value={emailNotifications} onChange={(v) => handleNotificationChange('email', v)} />
            </div>
            <div className="settings-row">
              <Bell size={20} className="settings-icon" />
              <div className="settings-info">
                <span className="settings-row-title">New Subscriber Alerts</span>
              </div>
              <Toggle value={newSubscriberAlerts} onChange={(v) => handleNotificationChange('subscriberAlerts', v)} />
            </div>
            <div className="settings-row">
              <Bell size={20} className="settings-icon" />
              <div className="settings-info">
                <span className="settings-row-title">Payment Alerts</span>
              </div>
              <Toggle value={paymentAlerts} onChange={(v) => handleNotificationChange('paymentAlerts', v)} />
            </div>
          </div>
        </section>

        {/* Privacy Section */}
        <section className="settings-section">
          <h3 className="section-label">Privacy</h3>
          <div className="settings-card">
            <div className="settings-row">
              <Eye size={20} className="settings-icon" />
              <div className="settings-info">
                <span className="settings-row-title">Profile Visibility</span>
                <span className="settings-row-value">{isPublic ? 'Public' : 'Private'}</span>
              </div>
              <Toggle value={isPublic} onChange={handleVisibilityToggle} />
            </div>
            <Pressable className="settings-row" onClick={handleExportData}>
              <Download size={20} className="settings-icon" />
              <div className="settings-info">
                <span className="settings-row-title">Export Data</span>
              </div>
              <ChevronRight size={18} className="settings-chevron" />
            </Pressable>
          </div>
        </section>

        {/* Danger Zone */}
        <section className="settings-section">
          <h3 className="section-label danger">Danger Zone</h3>
          <div className="settings-card">
            <Pressable className="settings-row" onClick={handleLogout}>
              <LogOut size={20} className="settings-icon" />
              <div className="settings-info">
                <span className="settings-row-title">Log Out</span>
              </div>
            </Pressable>
            <Pressable className="settings-row danger" onClick={() => setShowDeleteConfirm(true)}>
              <Trash2 size={20} className="settings-icon" />
              <div className="settings-info">
                <span className="settings-row-title">Delete Account</span>
              </div>
            </Pressable>
          </div>
        </section>

        {/* App Info */}
        <div className="app-info">
          <span>NatePay v1.0.0</span>
        </div>
      </div>

      {/* Delete Account Confirmation Modal */}
      {showDeleteConfirm && (
        <>
          <div className="modal-overlay" onClick={() => !isDeleting && setShowDeleteConfirm(false)} />
          <div className="delete-modal">
            <h3 className="delete-modal-title">Delete Account?</h3>
            <p className="delete-modal-text">
              This will permanently delete your account and all your data. This action cannot be undone.
            </p>
            <div className="delete-modal-buttons">
              <Pressable
                className="delete-modal-cancel"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={isDeleting}
              >
                Cancel
              </Pressable>
              <Pressable
                className="delete-modal-confirm"
                onClick={handleDeleteAccount}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <Loader2 size={16} className="spin" style={{ marginRight: 8 }} />
                    Deleting...
                  </>
                ) : (
                  'Delete Account'
                )}
              </Pressable>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
