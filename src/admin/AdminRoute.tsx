/**
 * AdminRoute - Auth guard for admin routes
 *
 * Checks if the current user is an admin by calling /admin/me.
 * The backend is the single source of truth for admin access.
 * Non-admins see an "Access Denied" page.
 */

import { useAuthState } from '../hooks/useAuthState'
import { PageSkeleton, Pressable } from '../components'
import { Navigate, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getAuthToken } from '../api/client'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// Check admin status via backend (single source of truth)
async function checkAdminStatus(): Promise<{ isAdmin: boolean; email?: string | null; role?: string }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const token = getAuthToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_URL}/admin/me`, {
    credentials: 'include',
    headers,
  })

  if (!response.ok) {
    // Auth failures should route to "Access Denied"; server/network failures should show "Connection Error".
    if (response.status === 401 || response.status === 403) {
      return { isAdmin: false, email: null }
    }

    const body = await response.json().catch(() => null) as any
    const message =
      body?.error ||
      body?.message ||
      `Admin verification failed (${response.status})`
    throw new Error(message)
  }

  return response.json()
}

interface AdminRouteProps {
  children: React.ReactNode
}

export default function AdminRoute({ children }: AdminRouteProps) {
  const { status, user, refetch } = useAuthState()
  const navigate = useNavigate()

  // Check admin status via backend
  const { data: adminStatus, isLoading: adminLoading, error: adminError, refetch: refetchAdmin } = useQuery({
    queryKey: ['admin', 'me'],
    queryFn: checkAdminStatus,
    enabled: status === 'authenticated',
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    retry: 1,
  })

  // Still checking auth
  if (status === 'unknown' || status === 'checking' || (status === 'authenticated' && adminLoading)) {
    return <PageSkeleton />
  }

  // Network/server error
  if (status === 'error' || adminError) {
    return (
      <div className="admin-error-page">
        <div className="admin-error-content">
          <div className="admin-error-icon">!</div>
          <h1>Connection Error</h1>
          <p>Unable to verify your session. Please check your connection.</p>
          <Pressable className="admin-error-btn" onClick={() => { refetch(); refetchAdmin(); }}>
            Try Again
          </Pressable>
        </div>
      </div>
    )
  }

  // Not authenticated
  if (status === 'unauthenticated') {
    return <Navigate to="/onboarding" replace />
  }

  // Authenticated but not an admin
  if (!adminStatus?.isAdmin) {
    return (
      <div className="admin-denied-page">
        <div className="admin-denied-content">
          <div className="admin-denied-icon">🔒</div>
          <h1>Access Denied</h1>
          <p>You don't have permission to access the admin dashboard.</p>
          <p className="admin-denied-email">Logged in as: {user?.email}</p>
          <Pressable className="admin-denied-btn" onClick={() => navigate('/dashboard')}>
            Go to Dashboard
          </Pressable>
        </div>
      </div>
    )
  }

  // Admin - render children
  return <>{children}</>
}
