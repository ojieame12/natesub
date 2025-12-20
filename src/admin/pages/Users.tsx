/**
 * Users - User management page
 */

import { useState } from 'react'
import { useAdminUsers, useAdminUserBlock, useAdminUserUnblock, useAdminUserDelete } from '../api'
import FilterBar from '../components/FilterBar'
import Pagination from '../components/Pagination'
import ActionModal from '../components/ActionModal'

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function Users() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const limit = 50

  const [blockModal, setBlockModal] = useState<{ userId: string; email: string } | null>(null)
  const [unblockModal, setUnblockModal] = useState<{ userId: string; email: string } | null>(null)
  const [deleteModal, setDeleteModal] = useState<{ userId: string; email: string } | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  const { data, isLoading, refetch } = useAdminUsers({
    search: search || undefined,
    status: status !== 'all' ? status : undefined,
    page,
    limit,
  })

  const blockMutation = useAdminUserBlock()
  const unblockMutation = useAdminUserUnblock()
  const deleteMutation = useAdminUserDelete()

  const handleBlock = async (reason?: string) => {
    if (!blockModal) return
    try {
      await blockMutation.mutateAsync({ userId: blockModal.userId, reason })
      setBlockModal(null)
      refetch()
    } catch (err) {
      console.error('Block failed:', err)
    }
  }

  const handleUnblock = async () => {
    if (!unblockModal) return
    try {
      await unblockMutation.mutateAsync(unblockModal.userId)
      setUnblockModal(null)
      refetch()
    } catch (err) {
      console.error('Unblock failed:', err)
    }
  }

  const handleDelete = async (reason?: string) => {
    if (!deleteModal || deleteConfirmText !== 'DELETE') return
    try {
      await deleteMutation.mutateAsync({ userId: deleteModal.userId, reason })
      setDeleteModal(null)
      setDeleteConfirmText('')
      refetch()
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  const clearFilters = () => {
    setSearch('')
    setStatus('all')
    setPage(1)
  }

  return (
    <div>
      <h1 className="admin-page-title">Users</h1>

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
              <th>Email</th>
              <th>Username</th>
              <th>Country</th>
              <th>Provider</th>
              <th>Status</th>
              <th>Revenue</th>
              <th>Subscribers</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '32px' }}>Loading...</td></tr>
            ) : data?.users?.length ? (
              data.users.map((user) => (
                <tr key={user.id}>
                  <td>{user.email}</td>
                  <td>{user.profile?.username || '-'}</td>
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
                  <td>{formatCurrency(user.revenueTotal)}</td>
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

        {data && data.totalPages > 1 && (
          <Pagination
            page={page}
            totalPages={data.totalPages}
            total={data.total}
            limit={limit}
            onPageChange={setPage}
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
          onCancel={() => setBlockModal(null)}
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
          onCancel={() => setUnblockModal(null)}
        />
      )}

      {/* Delete Modal - Custom since it needs a confirmation phrase */}
      {deleteModal && (
        <div className="admin-modal-overlay" onClick={() => setDeleteModal(null)}>
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
                onClick={() => setDeleteModal(null)}
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
