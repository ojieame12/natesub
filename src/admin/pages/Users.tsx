/**
 * Users - User management page
 */

import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAdminUsers, useAdminUserBlock, useAdminUserUnblock, useAdminUserDelete, useExportUsers, downloadCSV } from '../api'
import { formatCurrency, formatDate } from '../utils/format'
import FilterBar from '../components/FilterBar'
import Pagination from '../components/Pagination'
import ActionModal from '../components/ActionModal'
import { SkeletonTableRows } from '../components/SkeletonTableRows'

type SortField = 'email' | 'revenue' | 'subscribers' | 'created'
type SortOrder = 'asc' | 'desc'

export default function Users() {
  const location = useLocation()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('active')
  const [page, setPage] = useState(1)
  const [sortField, setSortField] = useState<SortField>('created')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const limit = 50

  const [blockModal, setBlockModal] = useState<{ userId: string; email: string } | null>(null)
  const [unblockModal, setUnblockModal] = useState<{ userId: string; email: string } | null>(null)
  const [deleteModal, setDeleteModal] = useState<{ userId: string; email: string } | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const { data, isLoading, error, refetch } = useAdminUsers({
    search: search || undefined,
    status: status !== 'all' ? status : undefined,
    page,
    limit,
  })

  // Allow deep-linking into the users table (e.g. from Stripe detail view)
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const nextSearch = (params.get('search') || '').trim()
    const nextStatus = (params.get('status') || '').trim()

    if (nextSearch && nextSearch !== search) {
      setSearch(nextSearch)
      setPage(1)
    }

    if (nextStatus && nextStatus !== status) {
      setStatus(nextStatus)
      setPage(1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search])

  const blockMutation = useAdminUserBlock()
  const unblockMutation = useAdminUserUnblock()
  const deleteMutation = useAdminUserDelete()
  const exportMutation = useExportUsers()

  const handleExport = async () => {
    try {
      const result = await exportMutation.mutateAsync({
        role: 'all',
        includeDeleted: status === 'deleted',
        limit: 10000,
      })
      downloadCSV(result.csv, result.filename)
    } catch (err) {
      console.error('Export failed:', err)
    }
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return ' ↕'
    return sortOrder === 'asc' ? ' ↑' : ' ↓'
  }

  // Client-side sorting (backend doesn't support sorting yet)
  const sortedUsers = data?.users?.slice().sort((a, b) => {
    const modifier = sortOrder === 'asc' ? 1 : -1
    switch (sortField) {
      case 'email':
        return a.email.localeCompare(b.email) * modifier
      case 'revenue':
        return (a.revenueTotal - b.revenueTotal) * modifier
      case 'subscribers':
        return (a.subscriberCount - b.subscriberCount) * modifier
      case 'created':
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * modifier
      default:
        return 0
    }
  })

  const handleBlock = async (reason?: string) => {
    if (!blockModal) return
    setActionError(null)
    try {
      await blockMutation.mutateAsync({ userId: blockModal.userId, reason })
      setBlockModal(null)
      refetch()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Block failed'
      setActionError(message)
      console.error('Block failed:', err)
    }
  }

  const handleUnblock = async () => {
    if (!unblockModal) return
    setActionError(null)
    try {
      await unblockMutation.mutateAsync(unblockModal.userId)
      setUnblockModal(null)
      refetch()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unblock failed'
      setActionError(message)
      console.error('Unblock failed:', err)
    }
  }

  const handleDelete = async (reason?: string) => {
    if (!deleteModal || deleteConfirmText !== 'DELETE') return
    setActionError(null)
    try {
      await deleteMutation.mutateAsync({ userId: deleteModal.userId, reason })
      setDeleteModal(null)
      setDeleteConfirmText('')
      refetch()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Delete failed'
      setActionError(message)
      console.error('Delete failed:', err)
    }
  }

  const clearFilters = () => {
    setSearch('')
    setStatus('all')
    setPage(1)
  }

  // Error state
  if (error) {
    return (
      <div>
        <h1 className="admin-page-title">Users</h1>
        <div className="admin-alert admin-alert-error" style={{ marginBottom: 16 }}>
          Failed to load users: {error.message}
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
        <h1 className="admin-page-title" style={{ margin: 0 }}>Users</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="admin-btn admin-btn-secondary"
            onClick={() => refetch()}
            disabled={isLoading}
          >
            {isLoading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            className="admin-btn admin-btn-secondary"
            onClick={handleExport}
            disabled={exportMutation.isPending}
          >
            {exportMutation.isPending ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="admin-alert admin-alert-error" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}
          >
            ×
          </button>
        </div>
      )}

      <FilterBar
        searchValue={search}
        onSearchChange={(v) => { setSearch(v); setPage(1) }}
        searchPlaceholder="Search by email or username..."
        filters={[
          {
            name: 'status',
            value: status,
            options: [
              { value: 'all', label: 'All Status' },
              { value: 'active', label: 'Active' },
              { value: 'blocked', label: 'Blocked' },
              { value: 'deleted', label: 'Deleted' },
            ],
            onChange: (v) => { setStatus(v); setPage(1) },
          },
        ]}
        onClear={clearFilters}
      />

      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('email')} style={{ cursor: 'pointer' }}>
                Email{getSortIcon('email')}
              </th>
              <th>Username</th>
              <th>Country</th>
              <th>Provider</th>
              <th>Status</th>
              <th onClick={() => handleSort('revenue')} style={{ cursor: 'pointer' }}>
                Revenue{getSortIcon('revenue')}
              </th>
              <th onClick={() => handleSort('subscribers')} style={{ cursor: 'pointer' }}>
                Subscribers{getSortIcon('subscribers')}
              </th>
              <th onClick={() => handleSort('created')} style={{ cursor: 'pointer' }}>
                Created{getSortIcon('created')}
              </th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonTableRows columns={9} rows={5} />
            ) : sortedUsers?.length ? (
              sortedUsers.map((user) => (
                <tr key={user.id}>
                  <td>
                    <a
                      href={`mailto:${user.email}`}
                      style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {user.email}
                    </a>
                  </td>
                  <td>
                    {user.profile?.username ? (
                      <span
                        style={{ color: 'var(--accent-primary)', cursor: 'pointer' }}
                        onClick={() => window.open(`/${user.profile?.username}`, '_blank')}
                        title="View public page"
                      >
                        {user.profile.username}
                      </span>
                    ) : '-'}
                  </td>
                  <td>{user.profile?.country || '-'}</td>
                  <td>{user.profile?.paymentProvider || '-'}</td>
                  <td>
                    <span className={`admin-badge ${
                      user.status === 'deleted' ? 'neutral' :
                      user.status === 'blocked' ? 'error' : 'success'
                    }`}>
                      {user.status}
                    </span>
                  </td>
                  <td>{formatCurrency(user.revenueTotal, user.profile?.currency || 'USD')}</td>
                  <td>{user.subscriberCount}</td>
                  <td>{formatDate(user.createdAt)}</td>
                  <td>
                    {user.status === 'deleted' ? (
                      <span style={{ color: 'var(--text-muted, #999)', fontSize: 12 }}>
                        (deleted)
                      </span>
                    ) : (
                      <div style={{ display: 'flex', gap: 4 }}>
                        {user.status === 'blocked' ? (
                          <button
                            className="admin-btn admin-btn-secondary admin-btn-small"
                            onClick={() => setUnblockModal({ userId: user.id, email: user.email })}
                          >
                            Unblock
                          </button>
                        ) : (
                          <button
                            className="admin-btn admin-btn-danger admin-btn-small"
                            onClick={() => setBlockModal({ userId: user.id, email: user.email })}
                          >
                            Block
                          </button>
                        )}
                        <button
                          className="admin-btn admin-btn-danger admin-btn-small"
                          onClick={() => { setDeleteModal({ userId: user.id, email: user.email }); setDeleteConfirmText('') }}
                          style={{ opacity: 0.7 }}
                          title="Permanently delete user"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '32px' }}>No users found</td></tr>
            )}
          </tbody>
        </table>

        {data && data.total > 0 && (
          <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
            Showing {sortedUsers?.length || 0} of {data.total} users
          </div>
        )}

        {data && data.totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={data.totalPages}
            total={data.total}
            limit={limit}
            onPageChange={setPage}
            loading={isLoading}
          />
        )}
      </div>

      {/* Block Modal */}
      {blockModal && (
        <ActionModal
          title="Block User"
          message={`Are you sure you want to block ${blockModal.email}? They will not be able to receive payments.`}
          confirmLabel="Block User"
          confirmVariant="danger"
          inputLabel="Reason (optional)"
          inputPlaceholder="Enter reason for blocking..."
          loading={blockMutation.isPending}
          onConfirm={handleBlock}
          onCancel={() => { setBlockModal(null); setActionError(null) }}
        />
      )}

      {/* Unblock Modal */}
      {unblockModal && (
        <ActionModal
          title="Unblock User"
          message={`Are you sure you want to unblock ${unblockModal.email}?`}
          confirmLabel="Unblock User"
          confirmVariant="primary"
          loading={unblockMutation.isPending}
          onConfirm={handleUnblock}
          onCancel={() => { setUnblockModal(null); setActionError(null) }}
        />
      )}

      {/* Delete Modal - Custom since it needs a confirmation phrase */}
      {deleteModal && (
        <div className="admin-modal-overlay" onClick={() => { setDeleteModal(null); setActionError(null) }}>
          <div className="admin-modal" onClick={e => e.stopPropagation()}>
            <div className="admin-modal-header">
              <h2 className="admin-modal-title">Delete User</h2>
            </div>
            <div className="admin-modal-body">
              <p style={{ color: 'var(--text-error, #dc2626)', marginBottom: 12, fontWeight: 500 }}>
                This action cannot be undone.
              </p>
              <p style={{ color: 'var(--text-secondary)', marginBottom: 12 }}>
                Deleting <strong>{deleteModal.email}</strong> will:
              </p>
              <ul style={{ margin: '0 0 16px 0', paddingLeft: 20, fontSize: 14, color: 'var(--text-secondary)' }}>
                <li>Cancel all Stripe subscriptions</li>
                <li>Anonymize their email (GDPR)</li>
                <li>Delete their profile and sessions</li>
              </ul>
              <div className="admin-form-group">
                <label className="admin-form-label">Type DELETE to confirm:</label>
                <input
                  type="text"
                  className="admin-form-input"
                  value={deleteConfirmText}
                  onChange={e => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  style={{
                    borderColor: deleteConfirmText === 'DELETE' ? 'var(--text-success, #16a34a)' : undefined,
                  }}
                />
              </div>
              <div className="admin-form-group">
                <label className="admin-form-label">Reason (optional):</label>
                <input
                  type="text"
                  className="admin-form-input"
                  id="delete-reason"
                  placeholder="Reason for deletion..."
                />
              </div>
            </div>
            <div className="admin-modal-footer">
              <button
                className="admin-btn admin-btn-secondary"
                onClick={() => { setDeleteModal(null); setActionError(null) }}
              >
                Cancel
              </button>
              <button
                className="admin-btn admin-btn-danger"
                onClick={() => {
                  const reason = (document.getElementById('delete-reason') as HTMLInputElement)?.value
                  handleDelete(reason)
                }}
                disabled={deleteConfirmText !== 'DELETE' || deleteMutation.isPending}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
