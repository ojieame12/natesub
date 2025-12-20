import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Mail, Bell, Download, Trash2, LogOut, CreditCard, Loader2, MapPin, X, Check, Smartphone } from 'lucide-react'
import { Pressable, useToast, Toggle } from './components'
import { useCurrentUser, useLogout, useDeleteAccount, useSettings, useUpdateSettings, useBillingStatus, useUpdateProfile } from './api/hooks'
import { useOnboardingStore } from './onboarding/store'
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

function BillingAddressSection({ user }: { user: any }) {
  const [isEditing, setIsEditing] = useState(false)
  const [address, setAddress] = useState(user?.profile?.address || '')
  const [city, setCity] = useState(user?.profile?.city || '')
  const [state, setState] = useState(user?.profile?.state || '')
  const [zip, setZip] = useState(user?.profile?.zip || '')

  const { mutateAsync: updateProfile, isPending } = useUpdateProfile()
  const toast = useToast()

  // Sync with user prop changes
  useEffect(() => {
    if (!isEditing && user?.profile) {
      const timer = window.setTimeout(() => {
        setAddress(user.profile.address || '')
        setCity(user.profile.city || '')
        setState(user.profile.state || '')
        setZip(user.profile.zip || '')
      }, 0)
      return () => window.clearTimeout(timer)
    }
  }, [user, isEditing])

  const handleSave = async () => {
    try {
      await updateProfile({
        address,
        city,
        state,
        zip
      })
      toast.success('Address updated')
      setIsEditing(false)
    } catch (err: any) {
      toast.error(err.message || 'Failed to update address')
    }
  }

  const hasAddress = user?.profile?.address || user?.profile?.city
  const displayAddress = hasAddress
    ? `${user.profile.address || ''}, ${user.profile.city || ''} ${user.profile.state || ''} ${user.profile.zip || ''}`
    : 'Not set'

  if (isEditing) {
    return (
      <div className="settings-row column">
        <div className="settings-row-header">
          <div className="settings-info">
            <span className="settings-row-title">Billing Address</span>
          </div>
          <div className="row-actions">
            <Pressable onClick={() => setIsEditing(false)} disabled={isPending}>
              <X size={18} className="settings-icon-subtle" />
            </Pressable>
            <Pressable onClick={handleSave} disabled={isPending}>
              {isPending ? <Loader2 size={18} className="spin" /> : <Check size={18} className="settings-icon-primary" />}
            </Pressable>
          </div>
        </div>

        <div className="address-form">
          <input
            className="settings-input"
            placeholder="Street Address"
            value={address}
            onChange={e => setAddress(e.target.value)}
          />
          <div className="form-row">
            <input
              className="settings-input"
              placeholder="City"
              value={city}
              onChange={e => setCity(e.target.value)}
              style={{ flex: 2 }}
            />
            <input
              className="settings-input"
              placeholder="State"
              value={state}
              onChange={e => setState(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>
          <input
            className="settings-input"
            placeholder="ZIP / Postal Code"
            value={zip}
            onChange={e => setZip(e.target.value)}
            style={{ width: '100px' }}
          />
        </div>
      </div>
    )
  }

  return (
    <Pressable className="settings-row" onClick={() => setIsEditing(true)}>
      <MapPin size={20} className="settings-icon" />
      <div className="settings-info">
        <span className="settings-row-title">Billing Address</span>
        <span className="settings-row-value truncate">{displayAddress}</span>
      </div>
      <ChevronRight size={18} className="settings-chevron" />
    </Pressable>
  )
}

function PhoneNumberSection({ user }: { user: any }) {
  const [isEditing, setIsEditing] = useState(false)
  const [phone, setPhone] = useState(user?.profile?.phone || '')

  const { mutateAsync: updateProfile, isPending } = useUpdateProfile()
  const toast = useToast()

  // Sync with user prop changes
  useEffect(() => {
    if (!isEditing && user?.profile) {
      const timer = window.setTimeout(() => {
        setPhone(user.profile.phone || '')
      }, 0)
      return () => window.clearTimeout(timer)
    }
  }, [user, isEditing])

  // Format phone for display (hide middle digits)
  const formatPhone = (p: string) => {
    if (!p || p.length < 8) return p
    return p.slice(0, 6) + '****' + p.slice(-2)
  }

  // Validate E.164 format
  const isValidE164 = (p: string) => {
    if (!p) return true // Empty is valid (optional)
    return /^\+[1-9]\d{6,14}$/.test(p)
  }

  const handleSave = async () => {
    if (phone && !isValidE164(phone)) {
      toast.error('Phone must be in E.164 format (e.g., +2348012345678)')
      return
    }

    try {
      await updateProfile({ phone: phone || null })
      toast.success('Phone number updated')
      setIsEditing(false)
    } catch (err: any) {
      toast.error(err.message || 'Failed to update phone')
    }
  }

  const displayPhone = user?.profile?.phone ? formatPhone(user.profile.phone) : 'Not set'

  if (isEditing) {
    return (
      <div className="settings-row column">
        <div className="settings-row-header">
          <div className="settings-info">
            <span className="settings-row-title">Phone Number</span>
            <span className="settings-row-hint">For SMS notifications (E.164 format)</span>
          </div>
          <div className="row-actions">
            <Pressable onClick={() => setIsEditing(false)} disabled={isPending}>
              <X size={18} className="settings-icon-subtle" />
            </Pressable>
            <Pressable onClick={handleSave} disabled={isPending}>
              {isPending ? <Loader2 size={18} className="spin" /> : <Check size={18} className="settings-icon-primary" />}
            </Pressable>
          </div>
        </div>

        <input
          className="settings-input"
          placeholder="+2348012345678"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          type="tel"
        />
      </div>
    )
  }

  return (
    <Pressable className="settings-row" onClick={() => setIsEditing(true)}>
      <Smartphone size={20} className="settings-icon" />
      <div className="settings-info">
        <span className="settings-row-title">Phone Number</span>
        <span className="settings-row-value">{displayPhone}</span>
      </div>
      <ChevronRight size={18} className="settings-chevron" />
    </Pressable>
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Sync local state with server data
  useEffect(() => {
    if (settings) {
      const prefs = settings.notificationPrefs
      const timer = window.setTimeout(() => {
        setPushNotifications(prefs?.push ?? true)
        setEmailNotifications(prefs?.email ?? true)
        setNewSubscriberAlerts(prefs?.subscriberAlerts ?? true)
        setPaymentAlerts(prefs?.paymentAlerts ?? true)
      }, 0)
      return () => window.clearTimeout(timer)
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

  const handleLogout = async () => {
    try {
      await logout()
      // Reset Zustand store in-memory state (localStorage removal alone doesn't clear it)
      useOnboardingStore.getState().reset()
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
      // Reset Zustand store in-memory state (same as logout)
      useOnboardingStore.getState().reset()
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

            <PhoneNumberSection user={user} />

            <BillingAddressSection user={user} />
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
                  ) : isService && subscriptionStatus === 'canceled' ? (
                    'Subscription Canceled'
                  ) : isService && subscriptionStatus === 'unpaid' ? (
                    'Payment Required'
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

        {/* Data Section */}
        <section className="settings-section">
          <h3 className="section-label">Data</h3>
          <div className="settings-card">
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
