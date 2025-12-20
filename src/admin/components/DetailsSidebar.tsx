/**
 * DetailsSidebar - Slide-out panel for viewing record details
 */

import { X, Copy, ExternalLink } from 'lucide-react'

interface DetailField {
  label: string
  value: string | number | null | undefined
  copyable?: boolean
  link?: string
  badge?: string
}

interface DetailsSidebarProps {
  title: string
  onClose: () => void
  fields: DetailField[]
  actions?: React.ReactNode
}

export default function DetailsSidebar({
  title,
  onClose,
  fields,
  actions,
}: DetailsSidebarProps) {
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const getBadgeClass = (badge: string) => {
    switch (badge) {
      case 'success': return 'admin-badge success'
      case 'error': return 'admin-badge error'
      case 'warning': return 'admin-badge warning'
      case 'info': return 'admin-badge info'
      default: return 'admin-badge neutral'
    }
  }

  return (
    <>
      <div className="admin-sidebar-overlay" onClick={onClose} />
      <aside className="admin-details-sidebar">
        <div className="admin-details-header">
          <h2 className="admin-details-title">{title}</h2>
          <button className="admin-details-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="admin-details-content">
          {fields.map((field, idx) => (
            <div key={idx} className="admin-details-field">
              <div className="admin-details-label">{field.label}</div>
              <div className="admin-details-value">
                {field.value == null || field.value === '' ? (
                  <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                ) : field.badge ? (
                  <span className={getBadgeClass(field.badge)}>{String(field.value)}</span>
                ) : field.link ? (
                  <a
                    href={field.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="admin-details-link"
                  >
                    {String(field.value)}
                    <ExternalLink size={12} />
                  </a>
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={field.copyable ? { fontFamily: 'monospace', fontSize: 12 } : undefined}>
                      {String(field.value)}
                    </span>
                    {field.copyable && (
                      <button
                        className="admin-copy-btn"
                        onClick={() => copyToClipboard(String(field.value))}
                        title="Copy to clipboard"
                      >
                        <Copy size={12} />
                      </button>
                    )}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        {actions && (
          <div className="admin-details-actions">
            {actions}
          </div>
        )}
      </aside>
    </>
  )
}
