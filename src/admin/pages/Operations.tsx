/**
 * Operations - System health and operational monitoring
 *
 * Surfaces existing backend endpoints for:
 * - Webhook monitoring and retry
 * - Transfer monitoring
 * - Reconciliation status
 * - Disputes overview
 * - Blocked subscribers
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAuthToken } from '../../api/client'
import StatCard from '../components/StatCard'
import ActionModal from '../components/ActionModal'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  const token = getAuthToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  })

  const data = await response.json().catch(() => ({ error: 'Invalid response' }))
  if (!response.ok) throw new Error(data.error || 'Request failed')
  return data
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

type TabType = 'health' | 'webhooks' | 'disputes' | 'blocked'

export default function Operations() {
  const [activeTab, setActiveTab] = useState<TabType>('health')
  const [retryModal, setRetryModal] = useState<{ id: string; provider: string } | null>(null)
  const queryClient = useQueryClient()

  // Health check
  const { data: healthData, isLoading: healthLoading, refetch: refetchHealth } = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: () => adminFetch<{ status: string; timestamp: string }>('/admin/health'),
    staleTime: 30 * 1000,
  })

  // Webhook stats
  const { data: webhookStats, isLoading: webhooksLoading } = useQuery({
    queryKey: ['admin', 'webhooks', 'stats'],
    queryFn: () => adminFetch<{
      failed: Record<string, number>
      deadLetter: number
      processedLast24h: number
    }>('/admin/webhooks/stats'),
    staleTime: 60 * 1000,
  })

  // Failed webhooks list
  const { data: failedWebhooks } = useQuery({
    queryKey: ['admin', 'webhooks', 'failed'],
    queryFn: () => adminFetch<{
      events: Array<{
        id: string
        provider: string
        type: string
        status: string
        retryCount: number
        createdAt: string
        error: string | null
      }>
    }>('/admin/webhooks/failed'),
    enabled: activeTab === 'webhooks',
    staleTime: 30 * 1000,
  })

  // Disputes
  const { data: disputeStats } = useQuery({
    queryKey: ['admin', 'disputes', 'stats'],
    queryFn: () => adminFetch<{
      current: { open: number; blockedSubscribers: number }
      thisMonth: { won: number; lost: number }
      allTime: { total: number; winRate: string }
    }>('/admin/disputes/stats'),
    enabled: activeTab === 'disputes',
    staleTime: 60 * 1000,
  })

  // Blocked subscribers
  const { data: blockedData } = useQuery({
    queryKey: ['admin', 'blocked-subscribers'],
    queryFn: () => adminFetch<{
      blockedSubscribers: Array<{
        id: string
        email: string
        disputeCount: number
        blockedReason: string | null
        createdAt: string
      }>
      pagination: { total: number }
    }>('/admin/blocked-subscribers'),
    enabled: activeTab === 'blocked',
    staleTime: 60 * 1000,
  })

  // Retry webhook mutation
  const retryMutation = useMutation({
    mutationFn: (webhookId: string) =>
      adminFetch(`/admin/webhooks/${webhookId}/retry`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'webhooks'] })
      setRetryModal(null)
    },
  })

  // Unblock subscriber mutation
  const unblockMutation = useMutation({
    mutationFn: (userId: string) =>
      adminFetch(`/admin/blocked-subscribers/${userId}/unblock`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Admin review' }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'blocked-subscribers'] })
    },
  })

  // Block subscriber mutation
  const [blockModal, setBlockModal] = useState<{ email: string } | null>(null)
  const [blockSearchEmail, setBlockSearchEmail] = useState('')
  const [blockSearchResult, setBlockSearchResult] = useState<{ id: string; email: string } | null>(null)
  const [blockSearchError, setBlockSearchError] = useState('')

  const searchUserMutation = useMutation({
    mutationFn: (email: string) =>
      adminFetch<{ users: Array<{ id: string; email: string }> }>(`/admin/users?search=${encodeURIComponent(email)}&limit=1`),
    onSuccess: (data) => {
      if (data.users && data.users.length > 0) {
        setBlockSearchResult(data.users[0])
        setBlockSearchError('')
      } else {
        setBlockSearchResult(null)
        setBlockSearchError('No user found with that email')
      }
    },
    onError: () => {
      setBlockSearchResult(null)
      setBlockSearchError('Search failed')
    },
  })

  const blockSubscriberMutation = useMutation({
    mutationFn: ({ userId, reason }: { userId: string; reason: string }) =>
      adminFetch(`/admin/subscribers/${userId}/block`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'blocked-subscribers'] })
      setBlockModal(null)
      setBlockSearchEmail('')
      setBlockSearchResult(null)
    },
  })

  const totalFailed = webhookStats?.failed
    ? Object.values(webhookStats.failed).reduce((a, b) => a + b, 0)
    : 0

  return (
    <div>
      <h1 className="admin-page-title">Operations</h1>

      {/* Tab Navigation */}
      <div className="admin-tabs">
        <button
          className={`admin-tab ${activeTab === 'health' ? 'active' : ''}`}
          onClick={() => setActiveTab('health')}
        >
          System Health
        </button>
        <button
          className={`admin-tab ${activeTab === 'webhooks' ? 'active' : ''}`}
          onClick={() => setActiveTab('webhooks')}
        >
          Webhooks
        </button>
        <button
          className={`admin-tab ${activeTab === 'disputes' ? 'active' : ''}`}
          onClick={() => setActiveTab('disputes')}
        >
          Disputes
        </button>
        <button
          className={`admin-tab ${activeTab === 'blocked' ? 'active' : ''}`}
          onClick={() => setActiveTab('blocked')}
        >
          Blocked Users
        </button>
      </div>

      {/* Health Tab */}
      {activeTab === 'health' && (
        <div>
          <div className="admin-stats-grid">
            <StatCard
              label="API Status"
              value={healthData?.status === 'healthy' ? 'Healthy' : healthData?.status === 'degraded' ? 'Degraded' : healthData?.status === 'unhealthy' ? 'Unhealthy' : 'Unknown'}
              variant={healthData?.status === 'healthy' ? 'success' : healthData?.status === 'degraded' ? 'warning' : healthData?.status === 'unhealthy' ? 'error' : 'default'}
              loading={healthLoading}
            />
            <StatCard
              label="Webhooks (24h)"
              value={webhookStats?.processedLast24h?.toString() || '0'}
              loading={webhooksLoading}
            />
            <StatCard
              label="Failed Webhooks"
              value={totalFailed.toString()}
              variant={totalFailed > 0 ? 'error' : 'success'}
              loading={webhooksLoading}
            />
            <StatCard
              label="Dead Letters"
              value={webhookStats?.deadLetter?.toString() || '0'}
              variant={(webhookStats?.deadLetter || 0) > 0 ? 'warning' : 'success'}
              loading={webhooksLoading}
            />
          </div>

          <div style={{ marginTop: '24px' }}>
            <button
              className="admin-btn admin-btn-secondary"
              onClick={() => refetchHealth()}
            >
              Refresh Status
            </button>
          </div>
        </div>
      )}

      {/* Webhooks Tab */}
      {activeTab === 'webhooks' && (
        <div>
          <div className="admin-stats-grid">
            {webhookStats?.failed && Object.entries(webhookStats.failed).map(([provider, count]) => (
              <StatCard
                key={provider}
                label={`${provider} Failed`}
                value={count.toString()}
                variant={count > 0 ? 'error' : 'success'}
              />
            ))}
          </div>

          {failedWebhooks?.events && failedWebhooks.events.length > 0 && (
            <div className="admin-table-container" style={{ marginTop: '24px' }}>
              <h3 style={{ marginBottom: '16px' }}>Failed Webhooks</h3>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Retries</th>
                    <th>Error</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {failedWebhooks.events.map((wh) => (
                    <tr key={wh.id}>
                      <td>{wh.provider}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>{wh.type}</td>
                      <td>
                        <span className={`admin-badge ${wh.status === 'failed' ? 'error' : 'warning'}`}>
                          {wh.status}
                        </span>
                      </td>
                      <td>{wh.retryCount}</td>
                      <td style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {wh.error || '-'}
                      </td>
                      <td>{formatDate(wh.createdAt)}</td>
                      <td>
                        <button
                          className="admin-btn admin-btn-primary admin-btn-small"
                          onClick={() => setRetryModal({ id: wh.id, provider: wh.provider })}
                        >
                          Retry
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(!failedWebhooks?.events || failedWebhooks.events.length === 0) && (
            <div className="admin-empty" style={{ marginTop: '24px' }}>
              <p>No failed webhooks</p>
            </div>
          )}
        </div>
      )}

      {/* Disputes Tab */}
      {activeTab === 'disputes' && (
        <div>
          <div className="admin-stats-grid">
            <StatCard
              label="Open Disputes"
              value={disputeStats?.current?.open?.toString() || '0'}
              variant={(disputeStats?.current?.open || 0) > 0 ? 'error' : 'success'}
            />
            <StatCard
              label="Won (This Month)"
              value={disputeStats?.thisMonth?.won?.toString() || '0'}
              variant="success"
            />
            <StatCard
              label="Lost (This Month)"
              value={disputeStats?.thisMonth?.lost?.toString() || '0'}
              variant={(disputeStats?.thisMonth?.lost || 0) > 0 ? 'error' : 'default'}
            />
            <StatCard
              label="Win Rate (All Time)"
              value={disputeStats?.allTime?.winRate || 'N/A'}
            />
          </div>

          <div className="admin-stats-grid" style={{ marginTop: '16px' }}>
            <StatCard
              label="Total Disputes"
              value={disputeStats?.allTime?.total?.toString() || '0'}
            />
            <StatCard
              label="Blocked Subscribers"
              value={disputeStats?.current?.blockedSubscribers?.toString() || '0'}
              variant={(disputeStats?.current?.blockedSubscribers || 0) > 0 ? 'warning' : 'default'}
            />
          </div>
        </div>
      )}

      {/* Blocked Users Tab */}
      {activeTab === 'blocked' && (
        <div>
          {/* Block Subscriber Form */}
          <div className="admin-card" style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Block a Subscriber</h3>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                  Subscriber Email
                </label>
                <input
                  type="email"
                  className="admin-search-input"
                  placeholder="Enter subscriber email..."
                  value={blockSearchEmail}
                  onChange={(e) => setBlockSearchEmail(e.target.value)}
                  style={{ width: '100%', maxWidth: 'none' }}
                />
              </div>
              <button
                className="admin-btn admin-btn-secondary"
                onClick={() => searchUserMutation.mutate(blockSearchEmail)}
                disabled={!blockSearchEmail || searchUserMutation.isPending}
              >
                {searchUserMutation.isPending ? 'Searching...' : 'Search'}
              </button>
            </div>

            {blockSearchError && (
              <p style={{ color: 'var(--error)', marginTop: '8px', fontSize: '13px' }}>{blockSearchError}</p>
            )}

            {blockSearchResult && (
              <div style={{ marginTop: '12px', padding: '12px', background: 'var(--bg-tertiary)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '14px' }}>
                  Found: <strong>{blockSearchResult.email}</strong>
                </span>
                <button
                  className="admin-btn admin-btn-danger admin-btn-small"
                  onClick={() => setBlockModal({ email: blockSearchResult.email })}
                >
                  Block This User
                </button>
              </div>
            )}
          </div>

          <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px' }}>Currently Blocked</h3>
          <p style={{ marginBottom: '16px', color: 'var(--text-secondary)', fontSize: '13px' }}>
            Subscribers blocked due to disputes or admin action.
          </p>

          {blockedData?.blockedSubscribers && blockedData.blockedSubscribers.length > 0 ? (
            <div className="admin-table-container">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Disputes</th>
                    <th>Reason</th>
                    <th>Since</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {blockedData.blockedSubscribers.map((user) => (
                    <tr key={user.id}>
                      <td>{user.email}</td>
                      <td>{user.disputeCount}</td>
                      <td>{user.blockedReason || '-'}</td>
                      <td>{formatDate(user.createdAt)}</td>
                      <td>
                        <button
                          className="admin-btn admin-btn-secondary admin-btn-small"
                          onClick={() => unblockMutation.mutate(user.id)}
                          disabled={unblockMutation.isPending}
                        >
                          Unblock
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="admin-empty">
              <p>No blocked subscribers</p>
            </div>
          )}
        </div>
      )}

      {/* Retry Modal */}
      {retryModal && (
        <ActionModal
          title="Retry Webhook"
          message={`Retry processing this ${retryModal.provider} webhook?`}
          confirmLabel="Retry"
          confirmVariant="primary"
          loading={retryMutation.isPending}
          onConfirm={() => retryMutation.mutate(retryModal.id)}
          onCancel={() => setRetryModal(null)}
        />
      )}

      {/* Block Subscriber Modal */}
      {blockModal && blockSearchResult && (
        <ActionModal
          title="Block Subscriber"
          message={`Block ${blockModal.email}? This will:\n• Prevent them from subscribing to any creator\n• Cancel all their active subscriptions`}
          confirmLabel="Block Subscriber"
          confirmVariant="danger"
          inputLabel="Reason for blocking"
          inputPlaceholder="e.g., Fraudulent activity, repeated disputes..."
          inputRequired
          loading={blockSubscriberMutation.isPending}
          onConfirm={(reason) => blockSubscriberMutation.mutate({ userId: blockSearchResult.id, reason: reason || 'Blocked by admin' })}
          onCancel={() => setBlockModal(null)}
        />
      )}
    </div>
  )
}
