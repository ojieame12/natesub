/**
 * SlideOutMenu - Dashboard navigation menu
 */

import { type LucideIcon, ChevronRight, X, UserPlus, Heart, BarChart3, DollarSign, Clock, FileText, Pen, Layout, CreditCard, Settings, HelpCircle } from 'lucide-react'
import { Pressable } from '../components'

interface MenuItem {
  id: string
  title: string
  icon: LucideIcon
  path: string
}

const menuItems: MenuItem[] = [
  { id: 'subscribers', title: 'Subscribers', icon: UserPlus, path: '/subscribers' },
  { id: 'my-subs', title: 'Following', icon: Heart, path: '/my-subscriptions' },
  { id: 'analytics', title: 'Analytics', icon: BarChart3, path: '/analytics' },
  { id: 'new-request', title: 'New Request', icon: DollarSign, path: '/new-request' },
  { id: 'sent-requests', title: 'Sent Requests', icon: Clock, path: '/requests' },
  { id: 'payroll', title: 'Payroll', icon: FileText, path: '/payroll' },
  { id: 'edit', title: 'Edit My Page', icon: Pen, path: '/edit-page' },
  { id: 'templates', title: 'Templates', icon: Layout, path: '/templates' },
  { id: 'payment', title: 'Payment Settings', icon: CreditCard, path: '/settings/payments' },
]

const menuFooterItems: MenuItem[] = [
  { id: 'settings', title: 'Settings', icon: Settings, path: '/settings' },
  { id: 'help', title: 'Help and Support', icon: HelpCircle, path: '/settings/help' },
]

interface SlideOutMenuProps {
  open: boolean
  onClose: () => void
  onNavigate: (path: string) => void
  displayName: string
  username: string
  avatarUrl?: string | null
}

export function SlideOutMenu({
  open,
  onClose,
  onNavigate,
  displayName,
  username,
  avatarUrl,
}: SlideOutMenuProps) {
  const handleNavigate = (path: string) => {
    onClose()
    onNavigate(path)
  }

  return (
    <>
      <div className={`menu-overlay ${open ? 'open' : ''}`} onClick={onClose} />
      <div className={`menu-panel ${open ? 'open' : ''}`}>
        <div className="menu-profile">
          <div className="menu-profile-info">
            <div className="menu-avatar">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="menu-avatar-img" />
              ) : (
                displayName ? displayName.charAt(0).toUpperCase() : 'U'
              )}
            </div>
            <div className="menu-profile-text">
              <span className="menu-profile-name">{displayName}</span>
              <span className="menu-profile-username">@{username}</span>
            </div>
          </div>
          <Pressable className="menu-close" onClick={onClose}>
            <X size={20} />
          </Pressable>
        </div>
        <div className="menu-items">
          {menuItems.map((item) => (
            <Pressable
              key={item.id}
              className="menu-item"
              onClick={() => handleNavigate(item.path)}
            >
              <item.icon size={20} className="menu-item-icon" />
              <div className="menu-item-content">
                <span className="menu-item-title">{item.title}</span>
                <ChevronRight size={18} className="menu-item-chevron" />
              </div>
            </Pressable>
          ))}
        </div>
        <div className="menu-footer">
          {menuFooterItems.map((item) => (
            <Pressable
              key={item.id}
              className="menu-item"
              onClick={() => handleNavigate(item.path)}
            >
              <item.icon size={20} className="menu-item-icon" />
              <div className="menu-item-content">
                <span className="menu-item-title">{item.title}</span>
                <ChevronRight size={18} className="menu-item-chevron" />
              </div>
            </Pressable>
          ))}
        </div>
      </div>
    </>
  )
}
