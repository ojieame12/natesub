import { useState, useEffect } from 'react'
import { ArrowLeft, Search, X } from 'lucide-react'
import { Pressable, SkeletonList, ErrorState } from './components'
import { useViewTransition } from './hooks'
import './Subscribers.css'

// Mock data
const subscribersData = [
  { id: 1, name: 'Sarah K.', username: 'sarahk', tier: 'Supporter', amount: 10, status: 'active', since: 'Jan 2025', avatar: null },
  { id: 2, name: 'James T.', username: 'jamest', tier: 'VIP', amount: 25, status: 'active', since: 'Dec 2024', avatar: null },
  { id: 3, name: 'Mike R.', username: 'miker', tier: 'Fan', amount: 5, status: 'active', since: 'Feb 2025', avatar: null },
  { id: 4, name: 'Lisa M.', username: 'lisam', tier: 'Supporter', amount: 10, status: 'cancelled', since: 'Nov 2024', avatar: null },
  { id: 5, name: 'Alex P.', username: 'alexp', tier: 'VIP', amount: 25, status: 'active', since: 'Jan 2025', avatar: null },
  { id: 6, name: 'Emma W.', username: 'emmaw', tier: 'Fan', amount: 5, status: 'active', since: 'Mar 2025', avatar: null },
]

type FilterType = 'all' | 'active' | 'cancelled'

export default function Subscribers() {
  const { navigate, goBack } = useViewTransition()
  const [filter, setFilter] = useState<FilterType>('all')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)

  // Load data with error handling
  const loadData = async () => {
    setIsLoading(true)
    setHasError(false)
    try {
      await new Promise(resolve => setTimeout(resolve, 600))
    } catch {
      setHasError(true)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Filter subscribers
  const filteredSubscribers = subscribersData.filter(sub => {
    const matchesFilter = filter === 'all' || sub.status === filter
    const matchesSearch = searchQuery === '' ||
      sub.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sub.username.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesFilter && matchesSearch
  })

  // Stats
  const totalActive = subscribersData.filter(s => s.status === 'active').length
  const totalCancelled = subscribersData.filter(s => s.status === 'cancelled').length
  const thisMonth = 3 // Mock

  return (
    <div className="subscribers-page">
      {/* Header */}
      <header className="subscribers-header">
        {searchOpen ? (
          <div className="search-bar">
            <Search size={18} className="search-icon" />
            <input
              type="text"
              placeholder="Search subscribers..."
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
            <span className="subscribers-title">Subscribers</span>
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
          <span className="stat-value text-green">+{thisMonth}</span>
          <span className="stat-label">This month</span>
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
          className={`filter-tab ${filter === 'cancelled' ? 'active' : ''}`}
          onClick={() => setFilter('cancelled')}
        >
          Cancelled
        </Pressable>
      </div>

      {/* Subscriber List */}
      <div className="subscribers-content">
        {hasError ? (
          <ErrorState
            title="Couldn't load subscribers"
            message="We had trouble loading your subscribers. Please try again."
            onRetry={loadData}
          />
        ) : isLoading ? (
          <SkeletonList count={6} />
        ) : filteredSubscribers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Search size={32} />
            </div>
            <p className="empty-title">No subscribers found</p>
            <p className="empty-desc">
              {searchQuery ? 'Try a different search term' : 'Share your page to get started'}
            </p>
          </div>
        ) : (
          <div className="subscribers-list">
            {filteredSubscribers.map((subscriber) => (
              <Pressable
                key={subscriber.id}
                className="subscriber-row"
                onClick={() => navigate(`/subscribers/${subscriber.id}`, { type: 'zoom-in' })}
              >
                <div
                  className="subscriber-avatar"
                  style={{ viewTransitionName: `avatar-${subscriber.id}` } as React.CSSProperties}
                >
                  {subscriber.name.charAt(0)}
                </div>
                <div className="subscriber-info">
                  <span className="subscriber-name">{subscriber.name}</span>
                  <span className="subscriber-username">@{subscriber.username}</span>
                </div>
                <div className="subscriber-meta">
                  <span className="subscriber-tier">{subscriber.tier}</span>
                  <span className="subscriber-amount">${subscriber.amount}/mo</span>
                </div>
              </Pressable>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
