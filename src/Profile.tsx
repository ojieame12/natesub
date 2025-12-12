import { useNavigate } from 'react-router-dom'
import { Pen, ExternalLink, ChevronRight, LogOut } from 'lucide-react'
import { Pressable, Skeleton, ErrorState } from './components'
import { useProfile, useMetrics, useLogout } from './api/hooks'
import './Profile.css'

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

  // Real API hooks
  const { data: profileData, isLoading: profileLoading, isError: profileError, refetch } = useProfile()
  const { data: metricsData, isLoading: metricsLoading } = useMetrics()

  const profile = profileData?.profile
  const metrics = metricsData?.metrics

  const name = profile?.displayName || 'Your Name'
  const username = profile?.username || 'username'

  const stats = {
    subscribers: metrics?.subscriberCount ?? 0,
    mrr: metrics?.mrr ?? 0,
    memberSince: formatMemberSince(profile?.id ? new Date().toISOString() : null), // TODO: Add createdAt to profile
  }

  const isLoading = profileLoading || metricsLoading

  const handleViewPage = () => {
    window.open(`https://nate.to/${username}`, '_blank')
  }

  const handleLogout = () => {
    logout(undefined, {
      onSuccess: () => navigate('/onboarding'),
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
        {/* Profile Card */}
        <section className="profile-card">
          {isLoading ? (
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
              <Pressable className="view-page-btn" onClick={handleViewPage}>
                <span>nate.to/{username}</span>
                <ExternalLink size={14} />
              </Pressable>
            </>
          )}
        </section>

        {/* Stats */}
        <section className="profile-stats-card">
          {isLoading ? (
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
                <span className="stat-value">${stats.mrr}</span>
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

        {/* Logout */}
        <Pressable className="logout-btn" onClick={handleLogout}>
          <LogOut size={18} />
          <span>Log Out</span>
        </Pressable>
      </div>
    </div>
  )
}
