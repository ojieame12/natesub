import { useState, useMemo, useCallback, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Search, X } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Virtuoso } from 'react-virtuoso'
import { api } from './api/client'
import type { MySubscription } from './api/client'
import { Pressable, useToast, SkeletonList, ErrorState, LoadingButton } from './components'
import { useViewTransition, useScrolled } from './hooks'
import { getCurrencySymbol, formatCompactNumber } from './utils/currency'
import './Subscribers.css' // Reuse Subscribers styles for consistency

type FilterType = 'all' | 'active' | 'canceled'

// Memoized subscription row for virtualization performance
interface SubscriptionRowProps {
  subscription: MySubscription
  onViewPage: (username: string) => void
  onCancel: (id: string) => void
  onReactivate: (id: string) => void
  cancellingId: string | null
  reactivatingId: string | null
}

const SubscriptionRow = memo(function SubscriptionRow({
  subscription,
  onViewPage,
  onCancel,
  onReactivate,
  cancellingId,
  reactivatingId,
}: SubscriptionRowProps) {
  const provider = subscription.provider
  const name = provider.displayName || provider.username || 'Unknown'
  const amount = subscription.amount || 0
  const status = subscription.status
  const currencySymbol = getCurrencySymbol(subscription.currency || 'USD')
  const isCancelling = subscription.cancelAtPeriodEnd

  return (
    <div className="subscriber-row" style={{ cursor: 'default' }}>
      <div className="subscriber-avatar">
        {provider.avatarUrl ? (
          <img
            src={provider.avatarUrl}
            alt=""
            style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : (
          name.charAt(0).toUpperCase()
        )}
      </div>
      <div className="subscriber-info">
        <span className="subscriber-name">{name}</span>
        {provider.username && (
          <span className="subscriber-username">@{provider.username}</span>
        )}
      </div>
      <div className="subscriber-meta">
        <span className={`subscriber-tier ${status === 'canceled' || isCancelling ? 'cancelled' : ''}`}>
          {isCancelling ? 'Cancelling' : status === 'canceled' ? 'Cancelled' : 'Active'}
        </span>
        <span className="subscriber-amount">{currencySymbol}{formatCompactNumber(amount)}/mo</span>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, marginLeft: 12 }}>
        {provider.username && (
          <Pressable
            className="action-chip"
            onClick={() => onViewPage(provider.username!)}
            style={{
              padding: '6px 12px',
              background: 'var(--neutral-100)',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            View
          </Pressable>
        )}

        {status !== 'canceled' && (
          isCancelling ? (
            <LoadingButton
              className="action-chip"
              onClick={() => onReactivate(subscription.id)}
              loading={reactivatingId === subscription.id}
              style={{
                padding: '6px 12px',
                background: 'var(--success)',
                color: 'white',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 500,
                border: 'none',
              }}
            >
              Reactivate
            </LoadingButton>
          ) : (
            <LoadingButton
              className="action-chip"
              onClick={() => onCancel(subscription.id)}
              loading={cancellingId === subscription.id}
              style={{
                padding: '6px 12px',
                background: 'transparent',
                color: 'var(--error)',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 500,
                border: '1px solid var(--error)',
              }}
            >
              Cancel
            </LoadingButton>
          )
        )}
      </div>
    </div>
  )
})

export default function MySubscriptions() {
  const { goBack } = useViewTransition()
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [scrollRef, isScrolled] = useScrolled()
  const [filter, setFilter] = useState<FilterType>('active')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [reactivatingId, setReactivatingId] = useState<string | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['mySubscriptions', filter],
    queryFn: () => api.mySubscriptions.list({ status: filter }),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.mySubscriptions.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mySubscriptions'] })
      toast.success('Subscription cancelled')
      setCancellingId(null)
    },
    onError: () => {
      toast.error('Failed to cancel subscription')
      setCancellingId(null)
    },
  })

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => api.mySubscriptions.reactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mySubscriptions'] })
      toast.success('Subscription reactivated')
      setReactivatingId(null)
    },
    onError: () => {
      toast.error('Failed to reactivate subscription')
      setReactivatingId(null)
    },
  })

  const subscriptions = data?.subscriptions || []

  // Filter by search query
  const filteredSubscriptions = useMemo(() => {
    if (!searchQuery) return subscriptions
    const query = searchQuery.toLowerCase()
    return subscriptions.filter((sub) => {
      const name = sub.provider.displayName || sub.provider.username || ''
      const username = sub.provider.username || ''
      return name.toLowerCase().includes(query) || username.toLowerCase().includes(query)
    })
  }, [subscriptions, searchQuery])

  // Stats
  const totalActive = subscriptions.filter((s) => s.status === 'active' && !s.cancelAtPeriodEnd).length
  const totalCancelling = subscriptions.filter((s) => s.cancelAtPeriodEnd).length
  const totalCancelled = subscriptions.filter((s) => s.status === 'canceled').length

  const handleViewPage = useCallback((username: string) => {
    navigate(`/${username}`)
  }, [navigate])

  const handleCancel = useCallback((id: string) => {
    setCancellingId(id)
    cancelMutation.mutate(id)
  }, [cancelMutation])

  const handleReactivate = useCallback((id: string) => {
    setReactivatingId(id)
    reactivateMutation.mutate(id)
  }, [reactivateMutation])

  return (
    <div className="subscribers-page" ref={scrollRef}>
      {/* Header */}
      <header className={`subscribers-header ${isScrolled ? 'scrolled' : ''}`}>
        {searchOpen ? (
          <div className="search-bar">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder="Search subscriptions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
              className="search-input"
            />
            <Pressable className="search-close" onClick={() => { setSearchOpen(false); setSearchQuery('') }}>
              <X size={18} />
            </Pressable>
          </div>
        ) : (
          <>
            <Pressable className="back-btn" onClick={goBack}>
              <ArrowLeft size={20} />
            </Pressable>
            <img src="/logo.svg" alt="NatePay" className="header-logo" />
            <Pressable className="search-btn" onClick={() => setSearchOpen(true)}>
              <Search size={20} />
            </Pressable>
          </>
        )}
      </header>

      {/* Stats Row */}
      <div className="stats-row">
        <div className="stat-item">
          <span className="stat-value">{totalActive}</span>
          <span className="stat-label">Active</span>
        </div>
        <div className="stat-divider" />
        <div className="stat-item">
          <span className="stat-value text-muted">{totalCancelling}</span>
          <span className="stat-label">Cancelling</span>
        </div>
        <div className="stat-divider" />
        <div className="stat-item">
          <span className="stat-value text-muted">{totalCancelled}</span>
          <span className="stat-label">Cancelled</span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="filter-tabs">
        <Pressable
          className={`filter-tab ${filter === 'active' ? 'active' : ''}`}
          onClick={() => setFilter('active')}
        >
          Active
        </Pressable>
        <Pressable
          className={`filter-tab ${filter === 'canceled' ? 'active' : ''}`}
          onClick={() => setFilter('canceled')}
        >
          Cancelled
        </Pressable>
        <Pressable
          className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All
        </Pressable>
      </div>

      {/* Subscription List */}
      <div className="subscribers-content">
        {isError ? (
          <ErrorState
            title="Couldn't load subscriptions"
            message="We had trouble loading your subscriptions. Please try again."
            onRetry={refetch}
          />
        ) : isLoading ? (
          <SkeletonList count={6} />
        ) : filteredSubscriptions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Search size={32} />
            </div>
            <p className="empty-title">No subscriptions found</p>
            <p className="empty-desc">
              {searchQuery ? 'Try a different search term' : 'Subscribe to creators to see them here'}
            </p>
          </div>
        ) : (
          <Virtuoso
            className="subscribers-list virtuoso-list"
            data={filteredSubscriptions}
            overscan={200}
            itemContent={(_, subscription) => (
              <SubscriptionRow
                key={subscription.id}
                subscription={subscription}
                onViewPage={handleViewPage}
                onCancel={handleCancel}
                onReactivate={handleReactivate}
                cancellingId={cancellingId}
                reactivatingId={reactivatingId}
              />
            )}
          />
        )}
      </div>
    </div>
  )
}
