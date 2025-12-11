import { useNavigate } from 'react-router-dom'
import { Pen, ExternalLink, ChevronRight, LogOut } from 'lucide-react'
import { useOnboardingStore } from './onboarding/store'
import { Pressable } from './components'
import './Profile.css'

const quickLinks = [
  { id: 'edit', title: 'Edit My Page', path: '/edit-page' },
  { id: 'payment', title: 'Payment Settings', path: '/settings/payments' },
  { id: 'settings', title: 'Settings', path: '/settings' },
]

export default function Profile() {
  const navigate = useNavigate()
  const { name, username } = useOnboardingStore()

  // Mock stats
  const stats = {
    subscribers: 12,
    mrr: 285,
    memberSince: 'Jan 2025',
  }

  const handleViewPage = () => {
    window.open(`https://nate.to/${username}`, '_blank')
  }

  const handleLogout = () => {
    navigate('/onboarding')
  }

  return (
    <div className="profile-page">
      {/* Header */}
      <header className="profile-header">
        <span className="profile-page-title">Profile</span>
        <Pressable className="edit-btn" onClick={() => navigate('/edit-page')}>
          <Pen size={18} />
        </Pressable>
      </header>

      <div className="profile-content">
        {/* Profile Card */}
        <section className="profile-card">
          <div className="profile-avatar">
            {name ? name.charAt(0).toUpperCase() : 'U'}
          </div>
          <h2 className="profile-name">{name || 'Your Name'}</h2>
          <p className="profile-username">@{username || 'username'}</p>
          <Pressable className="view-page-btn" onClick={handleViewPage}>
            <span>nate.to/{username || 'username'}</span>
            <ExternalLink size={14} />
          </Pressable>
        </section>

        {/* Stats */}
        <section className="profile-stats-card">
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
