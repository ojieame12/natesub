/**
 * Admins - Admin user management page
 *
 * Features:
 * - List all admin users
 * - Promote users to admin/super_admin
 * - Demote admins to regular user
 * - View admin action audit log
 */

import { useState } from 'react'
import {
  useAdminsList,
  usePromoteToAdmin,
  useDemoteAdmin,
  useAdminAuditLog,
  useAdminUsers,
} from '../api'
import { formatDate, formatDateTime } from '../utils/format'
import ActionModal from '../components/ActionModal'
import StatCard from '../components/StatCard'

function getRoleBadge(role: string): string {
  switch (role) {
    case 'super_admin': return 'error'
    case 'admin': return 'warning'
    default: return 'neutral'
  }
}

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

type TabType = 'admins' | 'promote' | 'audit'

export default function Admins() {
  const [activeTab, setActiveTab] = useState<TabType>('admins')
  const [demoteModal, setDemoteModal] = useState<{ id: string; email: string } | null>(null)
  const [promoteSearch, setPromoteSearch] = useState('')

  // Queries
  const { data: adminsData, isLoading: adminsLoading, error: adminsError, refetch } = useAdminsList()
  const { data: auditData, isLoading: auditLoading } = useAdminAuditLog(50)
  const { data: usersData, isLoading: usersLoading } = useAdminUsers({
    search: promoteSearch || undefined,
    status: 'active',
    limit: 20,
  })

  // Mutations
  const promoteMutation = usePromoteToAdmin()
  const demoteMutation = useDemoteAdmin()

  const handlePromote = async (userId: string, email: string, role: 'admin' | 'super_admin') => {
    if (!confirm(`Promote ${email} to ${role}?`)) return
    try {
      await promoteMutation.mutateAsync({ userId, role, reason: `Promoted via admin dashboard` })
      setPromoteSearch('')
    } catch (err) {
      console.error('Promote failed:', err)
      alert('Failed to promote user')
    }
  }

  const handleDemote = async (reason?: string) => {
    if (!demoteModal || !reason) return
    try {
      await demoteMutation.mutateAsync({ userId: demoteModal.id, reason })
      setDemoteModal(null)
    } catch (err) {
      console.error('Demote failed:', err)
      alert('Failed to demote admin')
    }
  }

  // Error state
  if (adminsError) {
    return (
      <div>
        <h1 className="admin-page-title">Admin Management</h1>
        <div className="admin-alert admin-alert-error" style={{ marginBottom: 16 }}>
          Failed to load admins: {adminsError.message}
        </div>
        <button className="admin-btn admin-btn-primary" onClick={() => refetch()}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 className="admin-page-title" style={{ margin: 0 }}>Admin Management</h1>
        <button
          className="admin-btn admin-btn-secondary"
          onClick={() => refetch()}
          disabled={adminsLoading}
        >
          {adminsLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Stats */}
      <div className="admin-stats-grid" style={{ marginBottom: 24 }}>
        <StatCard
          label="Total Admins"
          value={adminsData ? adminsData.total.toString() : '—'}
          loading={adminsLoading}
        />
        <StatCard
          label="Super Admins"
          value={adminsData ? adminsData.superAdminCount.toString() : '—'}
          variant="error"
          loading={adminsLoading}
        />
        <StatCard
          label="Regular Admins"
          value={adminsData ? adminsData.adminCount.toString() : '—'}
          variant="warning"
          loading={adminsLoading}
        />
      </div>

      {/* Tabs */}
      <div className="admin-tabs">
        <button
          className={`admin-tab ${activeTab === 'admins' ? 'active' : ''}`}
          onClick={() => setActiveTab('admins')}
        >
          Current Admins
        </button>
        <button
          className={`admin-tab ${activeTab === 'promote' ? 'active' : ''}`}
          onClick={() => setActiveTab('promote')}
        >
          Add Admin
        </button>
        <button
          className={`admin-tab ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          Audit Log
        </button>
      </div>

      {/* Admins Tab */}
      {activeTab === 'admins' && (
        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Role</th>
                <th>Granted By</th>
                <th>Granted At</th>
                <th>Last Login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {adminsLoading ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '32px' }}>Loading...</td></tr>
              ) : adminsData?.admins?.length ? (
                adminsData.admins.map((admin) => (
                  <tr key={admin.id}>
                    <td>{admin.email}</td>
                    <td>{admin.displayName || admin.username || '—'}</td>
                    <td>
                      <span className={`admin-badge ${getRoleBadge(admin.role)}`}>
                        {admin.role === 'super_admin' ? 'Super Admin' : 'Admin'}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {admin.adminGrantedByEmail || '—'}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {admin.adminGrantedAt ? formatDate(admin.adminGrantedAt) : '—'}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {admin.lastLoginAt ? timeAgo(admin.lastLoginAt) : 'Never'}
                    </td>
                    <td>
                      {admin.role !== 'super_admin' && (
                        <button
                          className="admin-btn admin-btn-danger admin-btn-small"
                          onClick={() => setDemoteModal({ id: admin.id, email: admin.email })}
                        >
                          Demote
                        </button>
                      )}
                      {admin.role === 'admin' && (
                        <button
                          className="admin-btn admin-btn-secondary admin-btn-small"
                          style={{ marginLeft: 4 }}
                          onClick={() => handlePromote(admin.id, admin.email, 'super_admin')}
                          disabled={promoteMutation.isPending}
                        >
                          → Super
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '32px' }}>No admins found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Promote Tab */}
      {activeTab === 'promote' && (
        <div>
          <div className="admin-form-group">
            <label className="admin-form-label">Search for a user to promote</label>
            <input
              type="text"
              className="admin-form-input"
              placeholder="Search by email..."
              value={promoteSearch}
              onChange={(e) => setPromoteSearch(e.target.value)}
            />
          </div>

          {promoteSearch && (
            <div className="admin-table-container" style={{ marginTop: 16 }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Username</th>
                    <th>Current Role</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {usersLoading ? (
                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: '32px' }}>Searching...</td></tr>
                  ) : usersData?.users?.length ? (
                    usersData.users
                      .filter(u => u.status === 'active')
                      .map((user) => (
                        <tr key={user.id}>
                          <td>{user.email}</td>
                          <td>{user.profile?.username || '—'}</td>
                          <td>
                            <span className={`admin-badge ${getRoleBadge(user.role || 'user')}`}>
                              {user.role || 'user'}
                            </span>
                          </td>
                          <td>
                            {user.role !== 'super_admin' && user.role !== 'admin' && (
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button
                                  className="admin-btn admin-btn-secondary admin-btn-small"
                                  onClick={() => handlePromote(user.id, user.email, 'admin')}
                                  disabled={promoteMutation.isPending}
                                >
                                  Make Admin
                                </button>
                                <button
                                  className="admin-btn admin-btn-danger admin-btn-small"
                                  onClick={() => handlePromote(user.id, user.email, 'super_admin')}
                                  disabled={promoteMutation.isPending}
                                >
                                  Make Super Admin
                                </button>
                              </div>
                            )}
                            {(user.role === 'admin' || user.role === 'super_admin') && (
                              <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
                                Already an admin
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                  ) : (
                    <tr><td colSpan={4} style={{ textAlign: 'center', padding: '32px' }}>
                      {promoteSearch ? 'No users found' : 'Enter a search term'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Audit Tab */}
      {activeTab === 'audit' && (
        <div className="admin-activity-list">
          {auditLoading ? (
            <div className="admin-empty">Loading audit log...</div>
          ) : auditData?.audit?.length ? (
            auditData.audit.map((log) => (
              <div key={log.id} className="admin-activity-item">
                <div className="admin-activity-message">{log.message}</div>
                <div className="admin-activity-time">
                  {formatDateTime(log.createdAt)}
                  {!!(log.metadata as Record<string, unknown>)?.targetEmail && (
                    <> · Target: <strong>{String((log.metadata as Record<string, unknown>).targetEmail)}</strong></>
                  )}
                  {!!(log.metadata as Record<string, unknown>)?.reason && (
                    <> · Reason: {String((log.metadata as Record<string, unknown>).reason)}</>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="admin-empty">
              <div className="admin-empty-text">No admin role changes recorded</div>
            </div>
          )}
        </div>
      )}

      {/* Demote Modal */}
      {demoteModal && (
        <ActionModal
          title="Demote Admin"
          message={`Remove admin access from ${demoteModal.email}? They will no longer be able to access the admin dashboard.`}
          confirmLabel="Demote to User"
          confirmVariant="danger"
          inputLabel="Reason (required)"
          inputPlaceholder="Enter reason for demotion..."
          inputRequired
          loading={demoteMutation.isPending}
          onConfirm={handleDemote}
          onCancel={() => setDemoteModal(null)}
        />
      )}
    </div>
  )
}
