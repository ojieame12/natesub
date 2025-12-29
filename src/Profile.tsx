import { useNavigate } from 'react-router-dom'
import { Pen, ExternalLink, ChevronRight, LogOut, Copy, Shield } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { Pressable, Skeleton, ErrorState, useToast } from './components'
import { useDelayedLoading } from './hooks'
import { useProfile, useMetrics, useLogout, useCurrentUser } from './api/hooks'
import { useOnboardingStore } from './onboarding/store'
import { getShareableLink, getShareableLinkFull, getPublicPageUrl } from './utils/constants'
import { getCurrencySymbol } from './utils/currency'
import { getAuthToken } from './api/client'
import { adminQueryKeys } from './api/queryKeys'
import './Profile.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// Check admin status via backend
async function checkAdminStatus(): Promise<{ isAdmin: boolean }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getAuthToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const response = await fetch(`${API_URL}/admin/me`, {
    credentials: 'include',
    headers,
  })
  if (!response.ok) return { isAdmin: false }
  return response.json()
}

const quickLinks = [
  { id: 'edit', title: 'Edit My Page', path: '/edit-page' },
  { id: 'payment', title: 'Payment Settings', path: '/settings/payments' },
  { id: 'settings', title: 'Settings', path: '/settings' },
]

// Format date
const formatMemberSince = (date: string | null) => {
  if (!date) return '-'
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  })
}

export default function Profile() {
  const navigate = useNavigate()
  const { mutate: logout } = useLogout()
  const toast = useToast()
  const resetOnboarding = useOnboardingStore((s) => s.reset)

  // Real API hooks
  const { data: userData } = useCurrentUser()
  const { data: profileData, isLoading: profileLoadingRaw, isError: profileError, refetch } = useProfile()
  const { data: metricsData, isLoading: metricsLoadingRaw } = useMetrics()

  // Delay showing skeletons to prevent flash on fast cache hits
  const profileLoading = useDelayedLoading(profileLoadingRaw)
  const metricsLoading = useDelayedLoading(metricsLoadingRaw)

  // Check if user is admin
  const { data: adminStatus } = useQuery({
    queryKey: adminQueryKeys.me,
    queryFn: checkAdminStatus,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: false,
  })
  const isAdmin = adminStatus?.isAdmin ?? false

  const profile = profileData?.profile
  const metrics = metricsData?.metrics

  const name = profile?.displayName || 'Your Name'
  const username = profile?.username || 'username'

  const stats = {
    subscribers: metrics?.subscriberCount ?? 0,
    mrr: metrics?.mrr ?? 0,
    memberSince: formatMemberSince(userData?.createdAt || null),
  }

  // Progressive loading: each section uses its specific loading state
  // instead of blocking all content on any loading state

  const handleViewPage = () => {
    window.open(getPublicPageUrl(username), '_blank')
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(getShareableLinkFull(username))
      toast.success('Link copied!')
    } catch {
      toast.error('Failed to copy')
    }
  }

  const handleLogout = () => {
    logout(undefined, {
      onSuccess: () => {
        resetOnboarding()
        navigate('/onboarding')
      },
    })
  }

  if (profileError) {
    return (
      <div className="profile-page">
        <header className="profile-header">
          <div style={{ width: 36 }} />
          <img src="/logo.svg" alt="NatePay" className="header-logo" />
          <div style={{ width: 36 }} />
        </header>
        <ErrorState
          title="Couldn't load profile"
          message="We had trouble loading your profile."
          onRetry={() => refetch()}
        />
      </div>
    )
  }

  return (
    <div className="profile-page">
      {/* Header */}
      <header className="profile-header">
        <div style={{ width: 36 }} />
        <img src="/logo.svg" alt="NatePay" className="header-logo" />
        <Pressable className="edit-btn" onClick={() => navigate('/edit-page')}>
          <Pen size={18} />
        </Pressable>
      </header>

      <div className="profile-content">
        {/* Profile Card - show skeleton only while profile loading */}
        <section className="profile-card">
          {profileLoading ? (
            <>
              <Skeleton width={80} height={80} borderRadius="50%" />
              <Skeleton width={120} height={24} style={{ marginTop: 16 }} />
              <Skeleton width={80} height={16} style={{ marginTop: 8 }} />
            </>
          ) : (
            <>
              <div className="profile-avatar">
                {name ? name.charAt(0).toUpperCase() : 'U'}
              </div>
              <h2 className="profile-name">{name}</h2>
              <p className="profile-username">@{username}</p>
              <div className="profile-link-actions">
                <Pressable className="view-page-btn" onClick={handleViewPage}>
                  <span>{getShareableLink(username)}</span>
                  <ExternalLink size={14} />
                </Pressable>
                <Pressable className="copy-link-btn" onClick={handleCopyLink}>
                  <Copy size={16} />
                </Pressable>
              </div>
            </>
          )}
        </section>

        {/* Stats - show skeleton only while metrics loading */}
        <section className="profile-stats-card">
          {metricsLoading ? (
            <>
              <div className="stat">
                <Skeleton width={40} height={28} />
                <Skeleton width={60} height={14} style={{ marginTop: 4 }} />
              </div>
              <div className="stat-divider" />
              <div className="stat">
                <Skeleton width={50} height={28} />
                <Skeleton width={40} height={14} style={{ marginTop: 4 }} />
              </div>
              <div className="stat-divider" />
              <div className="stat">
                <Skeleton width={60} height={28} />
                <Skeleton width={80} height={14} style={{ marginTop: 4 }} />
              </div>
            </>
          ) : (
            <>
              <div className="stat">
                <span className="stat-value">{stats.subscribers}</span>
                <span className="stat-label">Subscribers</span>
              </div>
              <div className="stat-divider" />
              <div className="stat">
                <span className="stat-value">{getCurrencySymbol(metrics?.currency || 'USD')}{stats.mrr.toLocaleString()}</span>
                <span className="stat-label">MRR</span>
              </div>
              <div className="stat-divider" />
              <div className="stat">
                <span className="stat-value">{stats.memberSince}</span>
                <span className="stat-label">Member Since</span>
              </div>
            </>
          )}
        </section>

        {/* Quick Links */}
        <section className="quick-links-section">
          <h3 className="section-label">Quick Links</h3>
          <div className="quick-links-card">
            {quickLinks.map((link) => (
              <Pressable
                key={link.id}
                className="quick-link-row"
                onClick={() => navigate(link.path)}
              >
                <span className="quick-link-title">{link.title}</span>
                <ChevronRight size={18} className="quick-link-chevron" />
              </Pressable>
            ))}
          </div>
        </section>

        {/* Admin Link - only visible to admins */}
        {isAdmin && (
          <section className="quick-links-section">
            <h3 className="section-label">Admin</h3>
            <div className="quick-links-card">
              <Pressable
                className="quick-link-row"
                onClick={() => navigate('/admin')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Shield size={18} style={{ color: 'var(--accent-primary)' }} />
                  <span className="quick-link-title">Admin Dashboard</span>
                </div>
                <ChevronRight size={18} className="quick-link-chevron" />
              </Pressable>
            </div>
          </section>
        )}

        {/* Logout */}
        <Pressable className="logout-btn" onClick={handleLogout}>
          <LogOut size={18} />
          <span>Log Out</span>
        </Pressable>
      </div>
    </div>
  )
}
