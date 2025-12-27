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
import { adminQueryKeys } from '../../api/queryKeys'
import { useToast } from '../../components'
import StatCard from '../components/StatCard'
import ActionModal from '../components/ActionModal'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const ADMIN_FETCH_TIMEOUT_MS = 20_000

async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    ...(options.headers as Record<string, string>),
  }

  // Only set Content-Type when there's a body (avoids CORS preflight on GETs)
  const hasBody = options.body !== undefined && options.body !== null
  if (hasBody) {
    headers['Content-Type'] = 'application/json'
  }

  const token = getAuthToken()
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), ADMIN_FETCH_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers,
      signal: options.signal ?? controller.signal,
    })
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Request timed out')
    }
    throw err
  } finally {
    window.clearTimeout(timeoutId)
  }

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

type TabType = 'health' | 'webhooks' | 'reconciliation' | 'disputes' | 'blocked'

export default function Operations() {
  const [activeTab, setActiveTab] = useState<TabType>('health')
  const [retryModal, setRetryModal] = useState<{ id: string; provider: string } | null>(null)
  const [reconciliationMessage, setReconciliationMessage] = useState<string | null>(null)
  const [reconciliationError, setReconciliationError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const toast = useToast()

  // Health check
  const { data: healthData, isLoading: healthLoading, refetch: refetchHealth } = useQuery({
    queryKey: adminQueryKeys.health,
    queryFn: () => adminFetch<{ status: string; timestamp: string }>('/admin/health'),
    staleTime: 30 * 1000,
  })

  // Webhook stats
  const { data: webhookStats, isLoading: webhooksLoading } = useQuery({
    queryKey: adminQueryKeys.webhooks.stats,
    queryFn: () => adminFetch<{
      failed: Record<string, number>
      deadLetter: number
      processedLast24h: number
    }>('/admin/webhooks/stats'),
    staleTime: 60 * 1000,
  })

  // Failed webhooks list
  const { data: failedWebhooks } = useQuery({
    queryKey: adminQueryKeys.webhooks.failed,
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
    queryKey: adminQueryKeys.disputes.stats,
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
    queryKey: adminQueryKeys.blockedSubscribers,
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

  // Reconciliation: Paystack missing transactions
  const { data: paystackMissing, isLoading: paystackMissingLoading, refetch: refetchPaystackMissing } = useQuery({
    queryKey: adminQueryKeys.reconciliation.paystackMissing(48),
    queryFn: () => adminFetch<{
      periodHours: number
      count: number
      windowStart: string
      windowEnd: string
      transactions: Array<{
        reference: string
        amount: number
        currency: string
        paidAt: string
        customerEmail: string
      }>
      warning: string | null
    }>('/admin/reconciliation/missing?hours=48'),
    enabled: activeTab === 'reconciliation',
    staleTime: 60 * 1000,
  })

  // Reconciliation: Stripe missing invoices
  const { data: stripeMissing, isLoading: stripeMissingLoading, refetch: refetchStripeMissing } = useQuery({
    queryKey: adminQueryKeys.reconciliation.stripeMissing(20),
    queryFn: () => adminFetch<{
      missing: Array<{
        invoiceId: string
        amount: number
        currency: string
        customerEmail: string | null
        created: string
        subscriptionId: string | null
      }>
      total: number
      checked: number
    }>('/admin/sync/stripe-missing?limit=20'),
    enabled: activeTab === 'reconciliation',
    staleTime: 60 * 1000,
  })

  // Retry webhook mutation
  const retryMutation = useMutation({
    mutationFn: (webhookId: string) =>
      adminFetch(`/admin/webhooks/${webhookId}/retry`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.webhooks.all })
      setRetryModal(null)
      toast.success('Webhook queued for retry')
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to retry webhook')
    },
  })

  // Paystack reconciliation runner (requires super_admin)
  const runPaystackReconciliationMutation = useMutation({
    mutationFn: () =>
      adminFetch<{
        success: boolean
        missingInDb?: unknown[]
        statusMismatches?: unknown[]
      }>('/admin/reconciliation/run', {
        method: 'POST',
        body: JSON.stringify({ periodHours: 48, autoFix: false }),
      }),
    onSuccess: (data) => {
      const missing = Array.isArray(data.missingInDb) ? data.missingInDb.length : 0
      const mismatches = Array.isArray(data.statusMismatches) ? data.statusMismatches.length : 0
      setReconciliationMessage(`Paystack reconciliation completed: ${missing} missing, ${mismatches} mismatches.`)
      setReconciliationError(null)
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.reconciliation.all })
    },
    onError: (err: any) => {
      setReconciliationError(err?.message || 'Reconciliation failed')
      setReconciliationMessage(null)
    },
  })

  // Stripe replay runner (requires super_admin)
  const runStripeReplayMutation = useMutation({
    mutationFn: () =>
      adminFetch<{ success: boolean; scanned: number; processed: number; message?: string }>(
        '/admin/reconciliation/stripe?limit=100',
        { method: 'POST' }
      ),
    onSuccess: (data) => {
      setReconciliationMessage(data.message || `Stripe replay completed: processed ${data.processed}/${data.scanned}.`)
      setReconciliationError(null)
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.reconciliation.all })
    },
    onError: (err: any) => {
      setReconciliationError(err?.message || 'Stripe replay failed')
      setReconciliationMessage(null)
    },
  })

  // Manual Stripe invoice sync (calls normal webhook handler)
  const syncStripeInvoiceMutation = useMutation({
    mutationFn: (invoiceId: string) =>
      adminFetch<{ success: boolean; message?: string }>(
        '/admin/sync/stripe-invoice',
        {
          method: 'POST',
          body: JSON.stringify({ invoiceId }),
        }
      ),
    onSuccess: (data) => {
      setReconciliationMessage(data.message || 'Invoice synced')
      setReconciliationError(null)
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.reconciliation.all })
      toast.success('Invoice synced successfully')
    },
    onError: (err: any) => {
      setReconciliationError(err?.message || 'Sync failed')
      setReconciliationMessage(null)
      toast.error(err?.message || 'Failed to sync invoice')
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
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.blockedSubscribers })
      toast.success('Subscriber unblocked')
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to unblock subscriber')
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
      queryClient.invalidateQueries({ queryKey: adminQueryKeys.blockedSubscribers })
      setBlockModal(null)
      setBlockSearchEmail('')
      setBlockSearchResult(null)
      toast.success('Subscriber blocked')
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to block subscriber')
    },
  })

  const failedCounts = webhookStats?.failed
  const totalFailed = failedCounts
    ? (typeof failedCounts.total === 'number'
      ? failedCounts.total
      : Object.entries(failedCounts)
        .filter(([provider]) => provider !== 'total')
        .reduce((sum, [, count]) => sum + count, 0))
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
          className={`admin-tab ${activeTab === 'reconciliation' ? 'active' : ''}`}
          onClick={() => setActiveTab('reconciliation')}
        >
          Reconciliation
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
            {failedCounts && Object.entries(failedCounts)
              .filter(([provider]) => provider !== 'total')
              .map(([provider, count]) => (
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

      {/* Reconciliation Tab */}
      {activeTab === 'reconciliation' && (
        <div>
          {(reconciliationError || reconciliationMessage) && (
            <div style={{ marginBottom: 16 }}>
              {reconciliationError && (
                <p style={{ color: 'var(--error)', margin: 0 }}>{reconciliationError}</p>
              )}
              {reconciliationMessage && (
                <p style={{ color: 'var(--text-secondary)', margin: 0 }}>{reconciliationMessage}</p>
              )}
            </div>
          )}

          <div className="admin-stats-grid">
            <StatCard
              label="Paystack Missing (48h)"
              value={paystackMissing?.count?.toString() || '0'}
              variant={(paystackMissing?.count || 0) > 0 ? 'warning' : 'success'}
              loading={paystackMissingLoading}
            />
            <StatCard
              label="Stripe Missing Invoices"
              value={stripeMissing?.total?.toString() || '0'}
              variant={(stripeMissing?.total || 0) > 0 ? 'warning' : 'success'}
              loading={stripeMissingLoading}
            />
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
            <button
              className="admin-btn admin-btn-secondary"
              onClick={() => {
                setReconciliationError(null)
                setReconciliationMessage(null)
                refetchPaystackMissing()
                refetchStripeMissing()
              }}
            >
              Refresh
            </button>
            <button
              className="admin-btn admin-btn-primary"
              onClick={() => runPaystackReconciliationMutation.mutate()}
              disabled={runPaystackReconciliationMutation.isPending}
              title="Calls provider APIs to detect missing or mismatched transactions"
            >
              {runPaystackReconciliationMutation.isPending ? 'Running Paystack...' : 'Run Paystack Reconciliation'}
            </button>
            <button
              className="admin-btn admin-btn-primary"
              onClick={() => runStripeReplayMutation.mutate()}
              disabled={runStripeReplayMutation.isPending}
              title="Replays recent Stripe invoice.paid events through the normal webhook handler"
            >
              {runStripeReplayMutation.isPending ? 'Replaying Stripe...' : 'Replay Stripe invoice.paid (last 100)'}
            </button>
          </div>

          {/* Paystack Missing Transactions */}
          <div className="admin-section" style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Paystack Transactions Missing From DB</h3>
            {paystackMissing?.warning && (
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 0 }}>
                {paystackMissing.warning}
              </p>
            )}
            {paystackMissingLoading ? (
              <div className="admin-empty"><p>Loading…</p></div>
            ) : paystackMissing?.transactions?.length ? (
              <div className="admin-table-container">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Reference</th>
                      <th>Amount</th>
                      <th>Email</th>
                      <th>Paid At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paystackMissing.transactions.slice(0, 25).map((t) => (
                      <tr key={t.reference}>
                        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{t.reference}</td>
                        <td style={{ textTransform: 'uppercase' }}>
                          {t.currency} {(t.amount / 100).toFixed(2)}
                        </td>
                        <td>{t.customerEmail}</td>
                        <td>{formatDate(t.paidAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {paystackMissing.transactions.length > 25 && (
                  <p style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: 12 }}>
                    Showing first 25 of {paystackMissing.transactions.length}
                  </p>
                )}
              </div>
            ) : (
              <div className="admin-empty"><p>No missing Paystack transactions detected.</p></div>
            )}
          </div>

          {/* Stripe Missing Invoices */}
          <div className="admin-section" style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Stripe Invoices Missing From DB</h3>
            {stripeMissingLoading ? (
              <div className="admin-empty"><p>Loading…</p></div>
            ) : stripeMissing?.missing?.length ? (
              <div className="admin-table-container">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Amount</th>
                      <th>Customer</th>
                      <th>Created</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stripeMissing.missing.slice(0, 25).map((inv) => (
                      <tr key={inv.invoiceId}>
                        <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{inv.invoiceId}</td>
                        <td style={{ textTransform: 'uppercase' }}>
                          {inv.currency} {(inv.amount / 100).toFixed(2)}
                        </td>
                        <td>{inv.customerEmail || '-'}</td>
                        <td>{formatDate(inv.created)}</td>
                        <td>
                          <button
                            className="admin-btn admin-btn-primary admin-btn-small"
                            onClick={() => syncStripeInvoiceMutation.mutate(inv.invoiceId)}
                            disabled={syncStripeInvoiceMutation.isPending}
                          >
                            Sync
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {stripeMissing.missing.length > 25 && (
                  <p style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: 12 }}>
                    Showing first 25 of {stripeMissing.missing.length}
                  </p>
                )}
              </div>
            ) : (
              <div className="admin-empty"><p>No missing Stripe invoices detected.</p></div>
            )}
          </div>
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
