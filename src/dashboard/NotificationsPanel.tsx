/**
 * NotificationsPanel - Slide-out notifications overlay
 */

import { Bell, X, AlertCircle, RefreshCw } from 'lucide-react'
import { Pressable } from '../components'
import { formatRelativeTime } from './utils'

interface Notification {
  id: string
  title: string
  description: string
  time: Date | string
  read: boolean
}

interface NotificationsPanelProps {
  open: boolean
  onClose: () => void
  notifications: Notification[]
  unreadCount: number
  isError?: boolean
  onRetry?: () => void
  onMarkAsRead: (id: string) => void
  onMarkAllAsRead: () => void
}

export function NotificationsPanel({
  open,
  onClose,
  notifications,
  unreadCount,
  isError,
  onRetry,
  onMarkAsRead,
  onMarkAllAsRead,
}: NotificationsPanelProps) {
  if (!open) return null

  return (
    <>
      <div className="menu-overlay" onClick={onClose} />
      <div className="notifications-panel">
        <div className="notifications-header">
          <span className="notifications-title">Notifications</span>
          <Pressable className="menu-close" onClick={onClose}>
            <X size={24} />
          </Pressable>
        </div>
        <div className="notifications-list">
          {isError ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <AlertCircle size={32} style={{ opacity: 0.5, marginBottom: 8, color: 'var(--error)' }} />
              <p style={{ fontSize: 14, marginBottom: 12 }}>Failed to load notifications</p>
              {onRetry && (
                <Pressable
                  onClick={onRetry}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 16px',
                    background: 'var(--glass-bg)',
                    borderRadius: 8,
                    fontSize: 14,
                    color: 'var(--text-primary)',
                  }}
                >
                  <RefreshCw size={14} />
                  Retry
                </Pressable>
              )}
            </div>
          ) : notifications.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <Bell size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
              <p style={{ fontSize: 14 }}>No notifications yet</p>
            </div>
          ) : (
            notifications.map((notif) => (
              <Pressable
                key={notif.id}
                className={`notification-item ${notif.read ? 'read' : ''}`}
                onClick={() => {
                  if (!notif.read) onMarkAsRead(notif.id)
                }}
              >
                <div className="notification-content">
                  <div className="notification-title">{notif.title}</div>
                  <div className="notification-desc">{notif.description}</div>
                  <div className="notification-time">{formatRelativeTime(notif.time)}</div>
                </div>
                {!notif.read && <div className="notification-unread-dot" />}
              </Pressable>
            ))
          )}
        </div>
        {notifications.length > 0 && unreadCount > 0 && (
          <Pressable className="notifications-footer" onClick={onMarkAllAsRead}>
            <span>Mark all as read</span>
          </Pressable>
        )}
      </div>
    </>
  )
}
