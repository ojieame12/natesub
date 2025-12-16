import { ChevronRight, Copy, ExternalLink, LogOut, Pen } from 'lucide-react'
import { Pressable, useToast } from '../components'
import { getPublicPageUrl, getShareableLink, getShareableLinkFull } from '../utils/constants'
import { formatSmartAmount } from '../utils/currency'
import '../Profile.css'

const noop = () => {}

export default function MockProfile() {
  const toast = useToast()

  const name = 'Nate Creator'
  const username = 'nate'
  const memberSince = 'Dec 2025'
  const subscribers = 128
  const currencyCode = 'USD'
  const mrr = 12_500

  const handleViewPage = () => {
    window.open(getPublicPageUrl(username), '_blank', 'noopener,noreferrer')
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(getShareableLinkFull(username))
      toast.success('Link copied!')
    } catch {
      toast.error('Failed to copy')
    }
  }

  return (
    <div className="profile-page">
      <header className="profile-header">
        <div style={{ width: 36 }} />
        <img src="/logo.svg" alt="NatePay" className="header-logo" />
        <Pressable className="edit-btn" onClick={noop}>
          <Pen size={18} />
        </Pressable>
      </header>

      <div className="profile-content">
        <section className="profile-card">
          <div className="profile-avatar">{name.charAt(0).toUpperCase()}</div>
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
        </section>

        <section className="profile-stats-card">
          <div className="stat">
            <span className="stat-value">{subscribers}</span>
            <span className="stat-label">Subscribers</span>
          </div>
          <div className="stat-divider" />
          <div className="stat">
            <span className="stat-value">{formatSmartAmount(mrr, currencyCode, 12)}</span>
            <span className="stat-label">MRR</span>
          </div>
          <div className="stat-divider" />
          <div className="stat">
            <span className="stat-value">{memberSince}</span>
            <span className="stat-label">Member Since</span>
          </div>
        </section>

        <section className="quick-links-section">
          <h3 className="section-label">Quick Links</h3>
          <div className="quick-links-card">
            {[
              { id: 'edit', title: 'Edit My Page' },
              { id: 'payment', title: 'Payment Settings' },
              { id: 'settings', title: 'Settings' },
            ].map((link) => (
              <Pressable key={link.id} className="quick-link-row" onClick={noop}>
                <span className="quick-link-title">{link.title}</span>
                <ChevronRight size={18} className="quick-link-chevron" />
              </Pressable>
            ))}
          </div>
        </section>

        <Pressable className="logout-btn" onClick={noop}>
          <LogOut size={18} />
          <span>Log Out</span>
        </Pressable>
      </div>
    </div>
  )
}

