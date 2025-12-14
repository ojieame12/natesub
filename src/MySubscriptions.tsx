import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './api/client'
import type { MySubscription } from './api/client'
import { useToast, PageSkeleton } from './components'
import './Subscribers.css'

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
  }).format(amount)
}

export default function MySubscriptions() {
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'canceled'>('active')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['mySubscriptions', statusFilter],
    queryFn: () => api.mySubscriptions.list({ status: statusFilter }),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.mySubscriptions.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mySubscriptions'] })
      toast.success('Subscription cancelled')
    },
    onError: () => {
      toast.error('Failed to cancel subscription')
    },
  })

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => api.mySubscriptions.reactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mySubscriptions'] })
      toast.success('Subscription reactivated')
    },
    onError: () => {
      toast.error('Failed to reactivate subscription')
    },
  })

  const handleManage = async (sub: MySubscription) => {
    if (sub.hasStripe) {
      try {
        const { url } = await api.mySubscriptions.getPortalUrl(sub.id)
        window.location.href = url
      } catch {
        toast.error('Failed to open management portal')
      }
    }
  }

  if (isLoading) {
    return <PageSkeleton />
  }

  if (isError) {
    return (
      <div className="subscribers-page">
        <div className="subscribers-header">
          <button className="back-button" onClick={() => navigate(-1)}>
            <span className="back-icon">&larr;</span>
          </button>
          <h1>My Subscriptions</h1>
        </div>
        <div style={{ textAlign: 'center', padding: '48px 16px', color: '#666' }}>
          Failed to load subscriptions. Please try again.
        </div>
      </div>
    )
  }

  const subscriptions = data?.subscriptions || []

  return (
    <div className="subscribers-page">
      <div className="subscribers-header">
        <button className="back-button" onClick={() => navigate(-1)}>
          <span className="back-icon">&larr;</span>
        </button>
        <h1>My Subscriptions</h1>
      </div>

      <p style={{ color: '#666', padding: '0 16px 16px', margin: 0 }}>
        Services and creators you're subscribed to
      </p>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: '8px', padding: '0 16px 16px' }}>
        {(['active', 'canceled', 'all'] as const).map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            style={{
              padding: '8px 16px',
              borderRadius: '20px',
              border: 'none',
              background: statusFilter === status ? 'var(--primary-color, #007AFF)' : '#f0f0f0',
              color: statusFilter === status ? 'white' : '#666',
              fontWeight: 500,
              fontSize: '14px',
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {status}
          </button>
        ))}
      </div>

      {subscriptions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 16px', color: '#666' }}>
          {statusFilter === 'active' ? (
            <>
              <p>No active subscriptions</p>
              <p style={{ fontSize: '14px', marginTop: '8px' }}>
                When you subscribe to a service or creator, they'll appear here.
              </p>
            </>
          ) : (
            <p>No {statusFilter} subscriptions found</p>
          )}
        </div>
      ) : (
        <div className="subscribers-list">
          {subscriptions.map((sub) => (
            <div
              key={sub.id}
              className="subscriber-card"
              style={{ padding: '16px', borderBottom: '1px solid #eee' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                {sub.provider.avatarUrl ? (
                  <img
                    src={sub.provider.avatarUrl}
                    alt=""
                    style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: '50%',
                      background: '#f0f0f0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 600,
                      color: '#666',
                    }}
                  >
                    {sub.provider.displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{sub.provider.displayName}</div>
                  {sub.provider.username && (
                    <div style={{ fontSize: '14px', color: '#666' }}>@{sub.provider.username}</div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 600 }}>
                    {formatCurrency(sub.amount, sub.currency)}
                    <span style={{ fontSize: '12px', color: '#666', fontWeight: 400 }}>
                      /{sub.interval === 'month' ? 'mo' : sub.interval}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: sub.status === 'active' ? '#28a745' : sub.status === 'past_due' ? '#ffc107' : '#dc3545',
                      fontWeight: 500,
                    }}
                  >
                    {sub.cancelAtPeriodEnd ? 'Cancels at period end' : sub.status}
                  </div>
                </div>
              </div>

              <div style={{ fontSize: '13px', color: '#666', marginBottom: '12px' }}>
                {sub.tierName && <span>{sub.tierName} &middot; </span>}
                Since {formatDate(sub.startedAt)}
                {sub.currentPeriodEnd && <> &middot; Renews {formatDate(sub.currentPeriodEnd)}</>}
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                {sub.provider.username && (
                  <button
                    onClick={() => navigate(`/${sub.provider.username}`)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      border: '1px solid #ddd',
                      background: 'white',
                      color: '#333',
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    View Page
                  </button>
                )}

                {sub.hasStripe && sub.status !== 'canceled' && (
                  <button
                    onClick={() => handleManage(sub)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      border: '1px solid #ddd',
                      background: 'white',
                      color: '#333',
                      fontSize: '13px',
                      cursor: 'pointer',
                    }}
                  >
                    Manage
                  </button>
                )}

                {sub.cancelAtPeriodEnd && sub.status !== 'canceled' ? (
                  <button
                    onClick={() => reactivateMutation.mutate(sub.id)}
                    disabled={reactivateMutation.isPending}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      border: 'none',
                      background: 'var(--primary-color, #007AFF)',
                      color: 'white',
                      fontSize: '13px',
                      cursor: reactivateMutation.isPending ? 'not-allowed' : 'pointer',
                      opacity: reactivateMutation.isPending ? 0.7 : 1,
                    }}
                  >
                    {reactivateMutation.isPending ? 'Reactivating...' : 'Reactivate'}
                  </button>
                ) : sub.status !== 'canceled' && (
                  <button
                    onClick={() => cancelMutation.mutate(sub.id)}
                    disabled={cancelMutation.isPending}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      border: 'none',
                      background: '#dc3545',
                      color: 'white',
                      fontSize: '13px',
                      cursor: cancelMutation.isPending ? 'not-allowed' : 'pointer',
                      opacity: cancelMutation.isPending ? 0.7 : 1,
                    }}
                  >
                    {cancelMutation.isPending ? 'Cancelling...' : 'Cancel'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
