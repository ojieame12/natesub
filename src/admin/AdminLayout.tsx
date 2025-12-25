/**
 * AdminLayout - Sidebar layout for admin dashboard
 *
 * Desktop: 240px sidebar + content area
 * Mobile: Collapsible sidebar with hamburger menu
 */

import { useState } from 'react'
import { NavLink, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthState } from '../hooks/useAuthState'
import { Pressable, PageTransition } from '../components'
import {
  LayoutGrid,
  TrendingUp,
  Users,
  UserPlus,
  CreditCard,
  RefreshCw,
  Mail,
  Bell,
  Terminal,
  FileText,
  Settings,
  HelpCircle,
  Menu,
  X,
  Home,
  Shield,
  type LucideIcon,
} from 'lucide-react'
import './admin.css'
import AdminErrorBoundary from './AdminErrorBoundary'

// Lazy load admin pages
import { lazy, Suspense } from 'react'

const Overview = lazy(() => import('./pages/Overview'))
const Revenue = lazy(() => import('./pages/Revenue'))
const UsersPage = lazy(() => import('./pages/Users'))
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
const Admins = lazy(() => import('./pages/Admins'))

// Navigation items with Lucide icons
const NAV_ITEMS: { path: string; label: string; Icon: LucideIcon }[] = [
  { path: '/admin', label: 'Overview', Icon: LayoutGrid },
  { path: '/admin/revenue', label: 'Revenue', Icon: TrendingUp },
  { path: '/admin/users', label: 'Users', Icon: Users },
  { path: '/admin/create-creator', label: 'Create Creator', Icon: UserPlus },
  { path: '/admin/payments', label: 'Payments', Icon: CreditCard },
  { path: '/admin/subscriptions', label: 'Subscriptions', Icon: RefreshCw },
  { path: '/admin/stripe', label: 'Stripe', Icon: CreditCard },
  { path: '/admin/emails', label: 'Emails', Icon: Mail },
  { path: '/admin/reminders', label: 'Reminders', Icon: Bell },
  { path: '/admin/logs', label: 'System Logs', Icon: Terminal },
  { path: '/admin/invoices', label: 'Invoices', Icon: FileText },
  { path: '/admin/ops', label: 'Operations', Icon: Settings },
  { path: '/admin/admins', label: 'Admin Users', Icon: Shield },
  { path: '/admin/support', label: 'Support', Icon: HelpCircle },
]

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
      {/* Mobile overlay - always rendered for fade animation */}
      <div
        className={`admin-sidebar-overlay ${sidebarOpen ? 'visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside className={`admin-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="admin-sidebar-header">
          <img src="/logo.svg" alt="NatePay" className="admin-logo" />
          <Pressable
            className="admin-sidebar-close"
            onClick={() => setSidebarOpen(false)}
          >
            <X size={18} />
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
              <item.Icon size={18} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <NavLink to="/dashboard" className="admin-nav-item">
            <Home size={18} />
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
            <Menu size={20} />
          </Pressable>
          <h1 className="admin-header-title">Admin Dashboard</h1>
        </header>

        <div className="admin-content">
          <AdminErrorBoundary>
            <Suspense fallback={<AdminSkeleton />}>
              <PageTransition>
                <Routes>
                  <Route index element={<Overview />} />
                  <Route path="revenue" element={<Revenue />} />
                  <Route path="users" element={<UsersPage />} />
                  <Route path="create-creator" element={<CreateCreator />} />
                  <Route path="payments" element={<Payments />} />
                  <Route path="subscriptions" element={<Subscriptions />} />
                  <Route path="stripe" element={<Stripe />} />
                  <Route path="emails" element={<Emails />} />
                  <Route path="reminders" element={<Reminders />} />
                  <Route path="logs" element={<Logs />} />
                  <Route path="invoices" element={<Invoices />} />
                  <Route path="ops" element={<Operations />} />
                  <Route path="admins" element={<Admins />} />
                  <Route path="support" element={<Support />} />
                  <Route path="*" element={<Navigate to="/admin" replace />} />
                </Routes>
              </PageTransition>
            </Suspense>
          </AdminErrorBoundary>
        </div>
      </main>
    </div>
  )
}
