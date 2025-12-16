import { useState, useMemo, useCallback, memo } from 'react'
import { ArrowLeft, Search, X } from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'
import { Pressable, SkeletonList, ErrorState } from './components'
import { useAuthState, useViewTransition, useScrolled } from './hooks'
import { useSubscriptions } from './api/hooks'
import { getCurrencySymbol, formatCompactNumber } from './utils/currency'
import './Subscribers.css'

type FilterType = 'all' | 'active' | 'canceled'

// Memoized subscriber row for virtualization performance
interface SubscriberRowProps {
  subscription: any
  defaultTier: string
  onNavigate: (id: string) => void
}

const SubscriberRow = memo(function SubscriberRow({ subscription, defaultTier, onNavigate }: SubscriberRowProps) {
  const subscriber = subscription.subscriber || {}
  const name = subscriber.displayName || subscriber.email || 'Unknown'
  const email = subscriber.email || ''
  const amount = subscription.amount || 0
  const tier = subscription.tierName || defaultTier
  const status = subscription.status
  const currencySymbol = getCurrencySymbol(subscription.currency || 'USD')

  return (
    <Pressable
      className="subscriber-row"
      onClick={() => onNavigate(subscription.id)}
    >
      <div className="subscriber-avatar">
        {name.charAt(0).toUpperCase()}
      </div>
      <div className="subscriber-info">
        <span className="subscriber-name">{name}</span>
        <span className="subscriber-username">{email}</span>
      </div>
      <div className="subscriber-meta">
        <span className={`subscriber-tier ${status === 'canceled' ? 'cancelled' : ''}`}>
          {tier}
        </span>
        <span className="subscriber-amount">{currencySymbol}{formatCompactNumber(amount)}/mo</span>
      </div>
    </Pressable>
  )
})

export default function Subscribers() {
  const { goBack, navigateWithSharedElements } = useViewTransition()
  const [scrollRef, isScrolled] = useScrolled()
  const { user } = useAuthState()
  const isService = user?.profile?.purpose === 'service'
  const peopleLabel = isService ? 'clients' : 'subscribers'
  const defaultTier = isService ? 'Client' : 'Supporter'
  const [filter, setFilter] = useState<FilterType>('all')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Real API hook - fetch all subscriptions
  const {
    data,
    isLoading,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useSubscriptions(filter === 'all' ? 'all' : filter)

  // Flatten paginated data
  const allSubscriptions = useMemo(() => {
    return data?.pages.flatMap(page => page.subscriptions) || []
  }, [data])

  // Filter by search query (client-side search)
  const filteredSubscribers = useMemo(() => {
    if (!searchQuery) return allSubscriptions
    const query = searchQuery.toLowerCase()
    return allSubscriptions.filter((sub: any) => {
      const name = sub.subscriber?.displayName || sub.subscriber?.email || ''
      const email = sub.subscriber?.email || ''
      return name.toLowerCase().includes(query) || email.toLowerCase().includes(query)
    })
  }, [allSubscriptions, searchQuery])

  // Stats
  const totalActive = allSubscriptions.filter((s: any) => s.status === 'active').length
  const totalCancelled = allSubscriptions.filter((s: any) => s.status === 'canceled').length

  const loadData = () => {
    refetch()
  }

  // Memoized navigation handler for virtualized list
  const handleNavigate = useCallback((id: string) => {
    navigateWithSharedElements(`/subscribers/${id}`)
  }, [navigateWithSharedElements])

  // Load more when reaching end of list
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <div className="subscribers-page" ref={scrollRef}>
      {/* Header */}
      <header className={`subscribers-header ${isScrolled ? 'scrolled' : ''}`}>
        {searchOpen ? (
          <div className="search-bar">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder={`Search ${peopleLabel}...`}
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
          <span className="stat-value">{allSubscriptions.length}</span>
          <span className="stat-label">Total</span>
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
          className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All
        </Pressable>
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
      </div>

      {/* Subscriber List */}
      <div className="subscribers-content">
        {isError ? (
          <ErrorState
            title={`Couldn't load ${peopleLabel}`}
            message={`We had trouble loading your ${peopleLabel}. Please try again.`}
            onRetry={loadData}
          />
        ) : isLoading ? (
          <SkeletonList count={6} />
        ) : filteredSubscribers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Search size={32} />
            </div>
            <p className="empty-title">No {peopleLabel} found</p>
            <p className="empty-desc">
              {searchQuery ? 'Try a different search term' : 'Share your page to get started'}
            </p>
          </div>
        ) : (
          <Virtuoso
            className="subscribers-list virtuoso-list"
            data={filteredSubscribers}
            endReached={handleEndReached}
            overscan={200}
            itemContent={(_, subscription) => (
              <SubscriberRow
                key={subscription.id}
                subscription={subscription}
                defaultTier={defaultTier}
                onNavigate={handleNavigate}
              />
            )}
            components={{
              Footer: () => isFetchingNextPage ? (
                <div className="load-more-loading">Loading...</div>
              ) : null
            }}
          />
        )}
      </div>
    </div>
  )
}
