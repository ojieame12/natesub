import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Mail, Lock, Shield, Bell, Eye, Download, Trash2, LogOut, CreditCard } from 'lucide-react'
import { Pressable, useToast, Skeleton, SkeletonList } from './components'
import './Settings.css'

// Toggle component
interface ToggleProps {
  value: boolean
  onChange: (value: boolean) => void
}

const Toggle = ({ value, onChange }: ToggleProps) => {
  return (
    <div
      className={`toggle ${value ? 'on' : ''}`}
      onClick={() => onChange(!value)}
    >
      <div className="toggle-knob" />
    </div>
  )
}

// Load settings from localStorage
const loadSettings = () => {
  try {
    const saved = localStorage.getItem('natepay-settings')
    return saved ? JSON.parse(saved) : null
  } catch {
    return null
  }
}

export default function Settings() {
  const navigate = useNavigate()
  const toast = useToast()
  const saved = loadSettings()

  const [isLoading, setIsLoading] = useState(true)
  const [pushNotifications, setPushNotifications] = useState(saved?.pushNotifications ?? true)
  const [emailNotifications, setEmailNotifications] = useState(saved?.emailNotifications ?? true)
  const [newSubscriberAlerts, setNewSubscriberAlerts] = useState(saved?.newSubscriberAlerts ?? true)
  const [paymentAlerts, setPaymentAlerts] = useState(saved?.paymentAlerts ?? true)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Simulate initial data load
  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 500)
    return () => clearTimeout(timer)
  }, [])

  // Save settings when they change
  useEffect(() => {
    localStorage.setItem('natepay-settings', JSON.stringify({
      pushNotifications,
      emailNotifications,
      newSubscriberAlerts,
      paymentAlerts,
    }))
  }, [pushNotifications, emailNotifications, newSubscriberAlerts, paymentAlerts])

  const handleLogout = () => {
    localStorage.removeItem('natepay-onboarding')
    localStorage.removeItem('natepay-settings')
    localStorage.removeItem('natepay-request')
    navigate('/onboarding')
  }

  const handleDeleteAccount = () => {
    localStorage.clear()
    setShowDeleteConfirm(false)
    toast.success('Account deleted')
    navigate('/onboarding')
  }

  const handleEmailChange = () => {
    toast.info('Email change coming soon')
  }

  const handlePasswordChange = () => {
    toast.info('Password change coming soon')
  }

  const handleTwoFactor = () => {
    toast.info('Two-factor settings coming soon')
  }

  const handleProfileVisibility = () => {
    toast.info('Profile visibility coming soon')
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
        <span className="settings-title">Settings</span>
        <div className="header-spacer" />
      </header>

      <div className="settings-content">
        {isLoading ? (
          <>
            <section className="settings-section">
              <Skeleton width={80} height={14} style={{ marginBottom: 12 }} />
              <SkeletonList count={3} />
            </section>
            <section className="settings-section">
              <Skeleton width={100} height={14} style={{ marginBottom: 12 }} />
              <SkeletonList count={4} />
            </section>
          </>
        ) : (
          <>
        {/* Account Section */}
        <section className="settings-section">
          <h3 className="section-label">Account</h3>
          <div className="settings-card">
            <Pressable className="settings-row" onClick={handleEmailChange}>
              <Mail size={20} className="settings-icon" />
              <div className="settings-info">
                <span className="settings-row-title">Email</span>
                <span className="settings-row-value">john@example.com</span>
              </div>
              <ChevronRight size={18} className="settings-chevron" />
            </Pressable>
            <Pressable className="settings-row" onClick={handlePasswordChange}>
              <Lock size={20} className="settings-icon" />
              <div className="settings-info">
                <span className="settings-row-title">Password</span>
                <span className="settings-row-value">••••••••</span>
              </div>
              <ChevronRight size={18} className="settings-chevron" />
            </Pressable>
            <Pressable className="settings-row" onClick={handleTwoFactor}>
              <Shield size={20} className="settings-icon" />
              <div className="settings-info">
                <span className="settings-row-title">Two-Factor Auth</span>
                <span className="settings-row-value">Enabled</span>
              </div>
              <ChevronRight size={18} className="settings-chevron" />
            </Pressable>
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
                <span className="settings-row-value">Free Trial - 23 days left</span>
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
              <Toggle value={pushNotifications} onChange={setPushNotifications} />
            </div>
            <div className="settings-row">
              <Mail size={20} className="settings-icon" />
              <div className="settings-info">
                <span className="settings-row-title">Email Notifications</span>
              </div>
              <Toggle value={emailNotifications} onChange={setEmailNotifications} />
            </div>
            <div className="settings-row">
              <Bell size={20} className="settings-icon" />
              <div className="settings-info">
                <span className="settings-row-title">New Subscriber Alerts</span>
              </div>
              <Toggle value={newSubscriberAlerts} onChange={setNewSubscriberAlerts} />
            </div>
            <div className="settings-row">
              <Bell size={20} className="settings-icon" />
              <div className="settings-info">
                <span className="settings-row-title">Payment Alerts</span>
              </div>
              <Toggle value={paymentAlerts} onChange={setPaymentAlerts} />
            </div>
          </div>
        </section>

        {/* Privacy Section */}
        <section className="settings-section">
          <h3 className="section-label">Privacy</h3>
          <div className="settings-card">
            <Pressable className="settings-row" onClick={handleProfileVisibility}>
              <Eye size={20} className="settings-icon" />
              <div className="settings-info">
                <span className="settings-row-title">Profile Visibility</span>
                <span className="settings-row-value">Public</span>
              </div>
              <ChevronRight size={18} className="settings-chevron" />
            </Pressable>
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
          <h3 className="section-label">Danger Zone</h3>
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
          </>
        )}
      </div>

      {/* Delete Account Confirmation Modal */}
      {showDeleteConfirm && (
        <>
          <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)} />
          <div className="delete-modal">
            <h3 className="delete-modal-title">Delete Account?</h3>
            <p className="delete-modal-text">
              This will permanently delete your account and all your data. This action cannot be undone.
            </p>
            <div className="delete-modal-buttons">
              <Pressable className="delete-modal-cancel" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </Pressable>
              <Pressable className="delete-modal-confirm" onClick={handleDeleteAccount}>
                Delete Account
              </Pressable>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
