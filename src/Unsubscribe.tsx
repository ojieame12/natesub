import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthState } from './hooks/useAuthState'
import { useToast, PageSkeleton } from './components'
import { api } from './api/client'
import './Settings.css'

export default function Unsubscribe() {
  const navigate = useNavigate()
  const toast = useToast()
  const { status, isFullySetUp } = useAuthState()
  const [isUpdating, setIsUpdating] = useState(false)
  const [unsubscribed, setUnsubscribed] = useState(false)

  const handleUnsubscribe = async () => {
    if (status !== 'authenticated') {
      // Redirect to login with return URL
      navigate('/onboarding', { state: { returnTo: '/unsubscribe' } })
      return
    }

    setIsUpdating(true)
    try {
      // Update notification preferences to disable email updates
      // Use the correct settings endpoint (PATCH /profile/settings)
      const currentSettings = await api.profile.getSettings()
      const currentPrefs = currentSettings.notificationPrefs || {
        push: true,
        email: true,
        subscriberAlerts: true,
        paymentAlerts: true,
      }

      await api.profile.updateSettings({
        notificationPrefs: {
          ...currentPrefs,
          email: false,
          subscriberAlerts: false,
        }
      })

      setUnsubscribed(true)
      toast.success('Successfully unsubscribed from marketing emails')
    } catch (err) {
      console.error('Failed to unsubscribe:', err)
      toast.error('Failed to update preferences. Please try again.')
    } finally {
      setIsUpdating(false)
    }
  }

  // Loading state
  if (status === 'unknown' || status === 'checking') {
    return <PageSkeleton />
  }

  return (
    <div className="settings-page" style={{ minHeight: '100vh', padding: '24px 16px' }}>
      <div style={{ maxWidth: '480px', margin: '0 auto', textAlign: 'center' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 600, marginBottom: '16px' }}>
          Email Preferences
        </h1>

        {unsubscribed ? (
          <div style={{ padding: '32px 0' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>✓</div>
            <h2 style={{ fontSize: '18px', fontWeight: 500, marginBottom: '8px' }}>
              You've been unsubscribed
            </h2>
            <p style={{ color: '#666', marginBottom: '24px' }}>
              You will no longer receive marketing emails from Nate.
            </p>
            {isFullySetUp && (
              <button
                onClick={() => navigate('/settings')}
                style={{
                  padding: '12px 24px',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'var(--primary-color, #007AFF)',
                  color: 'white',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Go to Settings
              </button>
            )}
          </div>
        ) : (
          <div style={{ padding: '32px 0' }}>
            <p style={{ color: '#666', marginBottom: '24px', lineHeight: 1.5 }}>
              {status === 'authenticated'
                ? 'Click below to unsubscribe from marketing emails. You will still receive important transactional emails about your account and payments.'
                : 'Sign in to manage your email preferences and unsubscribe from marketing emails.'
              }
            </p>

            <button
              onClick={handleUnsubscribe}
              disabled={isUpdating}
              style={{
                padding: '12px 24px',
                borderRadius: '8px',
                border: 'none',
                background: status === 'authenticated' ? '#dc3545' : 'var(--primary-color, #007AFF)',
                color: 'white',
                fontWeight: 500,
                cursor: isUpdating ? 'not-allowed' : 'pointer',
                opacity: isUpdating ? 0.7 : 1,
              }}
            >
              {isUpdating ? 'Updating...' : status === 'authenticated' ? 'Unsubscribe' : 'Sign In to Manage Preferences'}
            </button>

            <p style={{ color: '#999', fontSize: '13px', marginTop: '24px' }}>
              Note: You will continue to receive important emails about payments, security, and your account.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
