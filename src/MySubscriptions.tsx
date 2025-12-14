import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { api } from './api/client'
import type { MySubscription } from './api/client'
import { Pressable, useToast, PageSkeleton, LoadingButton } from './components'
import './MySubscriptions.css'

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
  const [managingId, setManagingId] = useState<string | null>(null)

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
      setManagingId(sub.id)
      try {
        const { url } = await api.mySubscriptions.getPortalUrl(sub.id)
        window.location.href = url
      } catch {
        toast.error('Failed to open management portal')
        setManagingId(null)
      }
    }
  }

  if (isLoading) {
    return <PageSkeleton />
  }

  if (isError) {
    return (
      <div className="subscribers-page">
        <div className="my-subs-header">
          <Pressable className="back-btn" onClick={() => navigate(-1)}>
            <ChevronLeft size={24} />
          </Pressable>
          <h1>My Subscriptions</h1>
        </div>
        <div className="my-subs-error">
          Failed to load subscriptions. Please try again.
        </div>
      </div>
    )
  }

  const subscriptions = data?.subscriptions || []

  return (
    <div className="subscribers-page">
      <div className="my-subs-header">
        <Pressable className="back-btn" onClick={() => navigate(-1)}>
          <ChevronLeft size={24} />
        </Pressable>
        <h1>My Subscriptions</h1>
      </div>

      <p className="my-subs-subtitle">
        Services and creators you're subscribed to
      </p>

      {/* Filter tabs */}
      <div className="my-subs-filters">
        {(['active', 'canceled', 'all'] as const).map((status) => (
          <Pressable
            key={status}
            className={`my-subs-filter-btn ${statusFilter === status ? 'active' : ''}`}
            onClick={() => setStatusFilter(status)}
          >
            {status}
          </Pressable>
        ))}
      </div>

      {subscriptions.length === 0 ? (
        <div className="my-subs-empty">
          {statusFilter === 'active' ? (
            <>
              <p>No active subscriptions</p>
              <p className="secondary">
                When you subscribe to a service or creator, they'll appear here.
              </p>
            </>
          ) : (
            <p>No {statusFilter} subscriptions found</p>
          )}
        </div>
      ) : (
        <div className="my-subs-list">
          {subscriptions.map((sub) => (
            <div key={sub.id} className="my-sub-card">
              <div className="my-sub-main">
                {sub.provider.avatarUrl ? (
                  <img
                    src={sub.provider.avatarUrl}
                    alt=""
                    className="my-sub-avatar"
                  />
                ) : (
                  <div className="my-sub-avatar-placeholder">
                    {sub.provider.displayName.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="my-sub-info">
                  <div className="my-sub-name">{sub.provider.displayName}</div>
                  {sub.provider.username && (
                    <div className="my-sub-username">@{sub.provider.username}</div>
                  )}
                </div>
                <div className="my-sub-pricing">
                  <div className="my-sub-amount">
                    {formatCurrency(sub.amount, sub.currency)}
                    <span className="my-sub-interval">
                      /{sub.interval === 'month' ? 'mo' : sub.interval}
                    </span>
                  </div>
                  <div className={`my-sub-status ${sub.cancelAtPeriodEnd ? 'canceling' : sub.status}`}>
                    {sub.cancelAtPeriodEnd ? 'Cancels at period end' : sub.status}
                  </div>
                </div>
              </div>

              <div className="my-sub-meta">
                {sub.tierName && <span>{sub.tierName} &middot; </span>}
                Since {formatDate(sub.startedAt)}
                {sub.currentPeriodEnd && <> &middot; Renews {formatDate(sub.currentPeriodEnd)}</>}
              </div>

              <div className="my-sub-actions">
                {sub.provider.username && (
                  <Pressable
                    className="my-sub-action-btn"
                    onClick={() => navigate(`/${sub.provider.username}`)}
                  >
                    View Page
                  </Pressable>
                )}

                {sub.hasStripe && sub.status !== 'canceled' && (
                  <LoadingButton
                    className="my-sub-action-btn"
                    onClick={() => handleManage(sub)}
                    loading={managingId === sub.id}
                    variant="secondary"
                  >
                    Manage
                  </LoadingButton>
                )}

                {sub.cancelAtPeriodEnd && sub.status !== 'canceled' ? (
                  <LoadingButton
                    className="my-sub-action-btn primary"
                    onClick={() => reactivateMutation.mutate(sub.id)}
                    loading={reactivateMutation.isPending && reactivateMutation.variables === sub.id}
                  >
                    Reactivate
                  </LoadingButton>
                ) : sub.status !== 'canceled' && (
                  <LoadingButton
                    className="my-sub-action-btn danger"
                    onClick={() => cancelMutation.mutate(sub.id)}
                    loading={cancelMutation.isPending && cancelMutation.variables === sub.id}
                  >
                    Cancel
                  </LoadingButton>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
