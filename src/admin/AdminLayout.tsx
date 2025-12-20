/**
 * AdminLayout - Sidebar layout for admin dashboard
 *
 * Desktop: 240px sidebar + content area
 * Mobile: Collapsible sidebar with hamburger menu
 */

import { useState } from 'react'
import { NavLink, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthState } from '../hooks/useAuthState'
import { Pressable } from '../components'
import './admin.css'

// Lazy load admin pages
import { lazy, Suspense } from 'react'

const Overview = lazy(() => import('./pages/Overview'))
const Revenue = lazy(() => import('./pages/Revenue'))
const Users = lazy(() => import('./pages/Users'))
const CreateCreator = lazy(() => import('./pages/CreateCreator'))
const Payments = lazy(() => import('./pages/Payments'))
const Subscriptions = lazy(() => import('./pages/Subscriptions'))
const Stripe = lazy(() => import('./pages/Stripe'))
const Emails = lazy(() => import('./pages/Emails'))
const Reminders = lazy(() => import('./pages/Reminders'))
const Logs = lazy(() => import('./pages/Logs'))
const Invoices = lazy(() => import('./pages/Invoices'))
const Operations = lazy(() => import('./pages/Operations'))
const Support = lazy(() => import('./pages/Support'))

// Navigation items
const NAV_ITEMS = [
  { path: '/admin', label: 'Overview', icon: 'grid' },
  { path: '/admin/revenue', label: 'Revenue', icon: 'chart' },
  { path: '/admin/users', label: 'Users', icon: 'users' },
  { path: '/admin/create-creator', label: 'Create Creator', icon: 'plus' },
  { path: '/admin/payments', label: 'Payments', icon: 'credit-card' },
  { path: '/admin/subscriptions', label: 'Subscriptions', icon: 'repeat' },
  { path: '/admin/stripe', label: 'Stripe', icon: 'stripe' },
  { path: '/admin/emails', label: 'Emails', icon: 'mail' },
  { path: '/admin/reminders', label: 'Reminders', icon: 'bell' },
  { path: '/admin/logs', label: 'System Logs', icon: 'terminal' },
  { path: '/admin/invoices', label: 'Invoices', icon: 'file-text' },
  { path: '/admin/ops', label: 'Operations', icon: 'ops' },
  { path: '/admin/support', label: 'Support', icon: 'support' },
]

// Simple icon component using CSS
function NavIcon({ name }: { name: string }) {
  const icons: Record<string, string> = {
    grid: '\u2637',
    chart: '\u2191',
    users: '\u263B',
    plus: '+',
    'credit-card': '\u2610',
    repeat: '\u21BB',
    stripe: 'S',
    mail: '\u2709',
    bell: '\u266A',
    terminal: '>_',
    'file-text': '\u2630',
    ops: '\u2699',
    support: '\u2753',
    menu: '\u2630',
    x: '\u2715',
    'log-out': '\u2192',
    home: '\u2302',
  }
  return <span className="admin-nav-icon">{icons[name] || '\u25CF'}</span>
}

function AdminSkeleton() {
  return (
    <div className="admin-skeleton">
      <div className="admin-skeleton-header"></div>
      <div className="admin-skeleton-grid">
        <div className="admin-skeleton-card"></div>
        <div className="admin-skeleton-card"></div>
        <div className="admin-skeleton-card"></div>
        <div className="admin-skeleton-card"></div>
      </div>
      <div className="admin-skeleton-table"></div>
    </div>
  )
}

export default function AdminLayout() {
  const { user } = useAuthState()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="admin-layout">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="admin-sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="admin-sidebar-header">
          <span className="admin-logo">NatePay Admin</span>
          <Pressable
            className="admin-sidebar-close"
            onClick={() => setSidebarOpen(false)}
          >
            <NavIcon name="x" />
          </Pressable>
        </div>

        <nav className="admin-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/admin'}
              className={({ isActive }) =>
                `admin-nav-item ${isActive ? 'active' : ''}`
              }
              onClick={() => setSidebarOpen(false)}
            >
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <NavLink to="/dashboard" className="admin-nav-item">
            <NavIcon name="home" />
            <span>Back to App</span>
          </NavLink>
          <div className="admin-user-info">
            <span className="admin-user-email">{user?.email}</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="admin-main">
        <header className="admin-header">
          <Pressable
            className="admin-menu-btn"
            onClick={() => setSidebarOpen(true)}
          >
            <NavIcon name="menu" />
          </Pressable>
          <h1 className="admin-header-title">Admin Dashboard</h1>
        </header>

        <div className="admin-content">
          <Suspense fallback={<AdminSkeleton />}>
            <Routes>
              <Route index element={<Overview />} />
              <Route path="revenue" element={<Revenue />} />
              <Route path="users" element={<Users />} />
              <Route path="create-creator" element={<CreateCreator />} />
              <Route path="payments" element={<Payments />} />
              <Route path="subscriptions" element={<Subscriptions />} />
              <Route path="stripe" element={<Stripe />} />
              <Route path="emails" element={<Emails />} />
              <Route path="reminders" element={<Reminders />} />
              <Route path="logs" element={<Logs />} />
              <Route path="invoices" element={<Invoices />} />
              <Route path="ops" element={<Operations />} />
              <Route path="support" element={<Support />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </Suspense>
        </div>
      </main>
    </div>
  )
}
