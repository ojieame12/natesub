import { ArrowLeft, Check, ChevronRight, Clock, Eye, Filter, RefreshCw, Send, X } from 'lucide-react'
import { Pressable } from '../components'
import { formatCompactNumber, getCurrencySymbol } from '../utils/currency'
import '../SentRequests.css'

type DisplayStatus = 'pending' | 'viewed' | 'accepted' | 'declined' | 'expired'

const getStatusIcon = (status: DisplayStatus) => {
  switch (status) {
    case 'pending': return <Clock size={16} />
    case 'viewed': return <Eye size={16} />
    case 'accepted': return <Check size={16} />
    case 'declined': return <X size={16} />
    case 'expired': return <Clock size={16} />
    default: return <Clock size={16} />
  }
}

const getStatusLabel = (status: DisplayStatus) => {
  switch (status) {
    case 'pending': return 'Pending'
    case 'viewed': return 'Viewed'
    case 'accepted': return 'Accepted'
    case 'declined': return 'Declined'
    case 'expired': return 'Expired'
    default: return 'Pending'
  }
}

const noop = () => {}

export default function MockInvoices() {
  const currencyCode = 'USD'
  const currencySymbol = getCurrencySymbol(currencyCode)

  const requests: Array<{
    id: string
    recipientName: string
    amount: number
    isRecurring: boolean
    relationship: string
    status: DisplayStatus
    date: string
    sendMethod: 'email' | 'link'
  }> = [
    {
      id: 'r1',
      recipientName: 'Ada',
      amount: 250,
      isRecurring: true,
      relationship: 'client',
      status: 'viewed',
      date: 'Dec 16, 2025',
      sendMethod: 'email',
    },
    {
      id: 'r2',
      recipientName: 'Samuel',
      amount: 1200,
      isRecurring: false,
      relationship: 'service',
      status: 'accepted',
      date: 'Dec 12, 2025',
      sendMethod: 'link',
    },
    {
      id: 'r3',
      recipientName: 'Tomi',
      amount: 99,
      isRecurring: false,
      relationship: 'family',
      status: 'pending',
      date: 'Dec 10, 2025',
      sendMethod: 'email',
    },
    {
      id: 'r4',
      recipientName: 'Jordan',
      amount: 5000,
      isRecurring: false,
      relationship: 'client',
      status: 'declined',
      date: 'Dec 2, 2025',
      sendMethod: 'link',
    },
    {
      id: 'r5',
      recipientName: 'Maria',
      amount: 750,
      isRecurring: false,
      relationship: 'client',
      status: 'expired',
      date: 'Nov 28, 2025',
      sendMethod: 'link',
    },
  ]

  const stats = {
    total: requests.length,
    pending: requests.filter(r => r.status === 'pending').length,
    accepted: requests.filter(r => r.status === 'accepted').length,
    declined: requests.filter(r => r.status === 'declined').length,
  }

  return (
    <div className="sent-requests-page">
      <header className="sent-requests-header">
        <Pressable className="back-btn" onClick={noop}>
          <ArrowLeft size={20} />
        </Pressable>
        <img src="/logo.svg" alt="NatePay" className="header-logo" />
        <Pressable className="filter-btn" onClick={noop}>
          <Filter size={20} />
        </Pressable>
      </header>

      <div className="requests-stats-row">
        <div className="requests-stat">
          <span className="requests-stat-value">{stats.total}</span>
          <span className="requests-stat-label">Total</span>
        </div>
        <div className="requests-stat-divider" />
        <div className="requests-stat">
          <span className="requests-stat-value pending">{stats.pending}</span>
          <span className="requests-stat-label">Pending</span>
        </div>
        <div className="requests-stat-divider" />
        <div className="requests-stat">
          <span className="requests-stat-value accepted">{stats.accepted}</span>
          <span className="requests-stat-label">Accepted</span>
        </div>
        <div className="requests-stat-divider" />
        <div className="requests-stat">
          <span className="requests-stat-value declined">{stats.declined}</span>
          <span className="requests-stat-label">Declined</span>
        </div>
      </div>

      <div className="sent-requests-content">
        <div className="requests-list">
          {requests.map((request, index) => (
            <div
              key={request.id}
              className="request-card animate-fade-in-up"
              style={{ animationDelay: `${index * 0.05}s`, animationFillMode: 'both' }}
            >
              <Pressable className="request-card-main" onClick={noop}>
                <div className="request-avatar">
                  {request.recipientName.charAt(0).toUpperCase()}
                </div>
                <div className="request-info">
                  <div className="request-top-row">
                    <span className="request-recipient">{request.recipientName}</span>
                    <span className="request-amount">
                      {currencySymbol}{formatCompactNumber(request.amount)}{request.isRecurring ? '/mo' : ''}
                    </span>
                  </div>
                  <div className="request-bottom-row">
                    <span className="request-purpose">{request.relationship}</span>
                    <span className="request-date">{request.date}</span>
                  </div>
                </div>
                <ChevronRight size={18} className="request-chevron" />
              </Pressable>

              <div className="request-card-footer">
                <div className={`request-status ${request.status}`}>
                  {getStatusIcon(request.status)}
                  <span>{getStatusLabel(request.status)}</span>
                </div>

                <div className="request-actions">
                  {(request.status === 'declined' || request.status === 'expired') ? (
                    <Pressable className="request-action-btn" onClick={noop}>
                      <RefreshCw size={14} />
                      <span>Resend</span>
                    </Pressable>
                  ) : request.status === 'pending' ? (
                    <span className="request-via">via {request.sendMethod}</span>
                  ) : (
                    <span className="request-via">—</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="requests-empty" style={{ marginTop: 24, padding: 0 }}>
          <div className="requests-empty-icon">
            <Send size={32} />
          </div>
          <p className="requests-empty-title">Mock page for screenshots</p>
          <p className="requests-empty-desc">No API calls. Safe to capture.</p>
        </div>
      </div>
    </div>
  )
}
