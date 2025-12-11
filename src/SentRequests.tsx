import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    ArrowLeft,
    Clock,
    Eye,
    Check,
    X,
    ChevronRight,
    Send,
    RefreshCw,
    Filter,
} from 'lucide-react'
import { Pressable, useToast, SkeletonList } from './components'
import './SentRequests.css'

// Mock sent requests data
type RequestStatus = 'pending' | 'viewed' | 'accepted' | 'declined' | 'expired'

interface SentRequest {
    id: string
    recipientName: string
    recipientEmail?: string
    recipientPhone?: string
    amount: number
    isRecurring: boolean
    purpose: string
    status: RequestStatus
    sentAt: string
    sentVia: 'sms' | 'email' | 'link'
    viewedAt?: string
    respondedAt?: string
}

const mockRequests: SentRequest[] = [
    {
        id: '1',
        recipientName: 'Mom',
        recipientPhone: '+1 (555) 123-4567',
        amount: 50,
        isRecurring: true,
        purpose: 'Monthly allowance',
        status: 'accepted',
        sentAt: 'Dec 10, 2024',
        sentVia: 'sms',
        viewedAt: 'Dec 10, 2024',
        respondedAt: 'Dec 11, 2024',
    },
    {
        id: '2',
        recipientName: 'Sarah Johnson',
        recipientEmail: 'sarah@email.com',
        amount: 25,
        isRecurring: true,
        purpose: 'Support my work',
        status: 'viewed',
        sentAt: 'Dec 12, 2024',
        sentVia: 'email',
        viewedAt: 'Dec 12, 2024',
    },
    {
        id: '3',
        recipientName: 'Mike Chen',
        recipientEmail: 'mike@gmail.com',
        amount: 10,
        isRecurring: false,
        purpose: 'Coffee tip',
        status: 'pending',
        sentAt: 'Dec 14, 2024',
        sentVia: 'email',
    },
    {
        id: '4',
        recipientName: 'Dad',
        recipientPhone: '+1 (555) 234-5678',
        amount: 100,
        isRecurring: true,
        purpose: 'Help with bills',
        status: 'declined',
        sentAt: 'Dec 8, 2024',
        sentVia: 'sms',
        viewedAt: 'Dec 8, 2024',
        respondedAt: 'Dec 9, 2024',
    },
    {
        id: '5',
        recipientName: 'Jessica Williams',
        recipientPhone: '+1 (555) 345-6789',
        amount: 15,
        isRecurring: true,
        purpose: 'Fan subscription',
        status: 'expired',
        sentAt: 'Nov 20, 2024',
        sentVia: 'link',
    },
]

const getStatusIcon = (status: RequestStatus) => {
    switch (status) {
        case 'pending': return <Clock size={16} />
        case 'viewed': return <Eye size={16} />
        case 'accepted': return <Check size={16} />
        case 'declined': return <X size={16} />
        case 'expired': return <Clock size={16} />
    }
}

const getStatusLabel = (status: RequestStatus) => {
    switch (status) {
        case 'pending': return 'Pending'
        case 'viewed': return 'Viewed'
        case 'accepted': return 'Accepted'
        case 'declined': return 'Declined'
        case 'expired': return 'Expired'
    }
}

type FilterType = 'all' | 'pending' | 'viewed' | 'accepted' | 'declined'

export default function SentRequests() {
    const navigate = useNavigate()
    const toast = useToast()
    const [filter, setFilter] = useState<FilterType>('all')
    const [showFilters, setShowFilters] = useState(false)
    const [isLoading, setIsLoading] = useState(true)

    // Simulate initial data load
    useEffect(() => {
        const timer = setTimeout(() => setIsLoading(false), 600)
        return () => clearTimeout(timer)
    }, [])

    const filteredRequests = mockRequests.filter(req => {
        if (filter === 'all') return true
        return req.status === filter
    })

    // Stats
    const stats = {
        total: mockRequests.length,
        pending: mockRequests.filter(r => r.status === 'pending').length,
        accepted: mockRequests.filter(r => r.status === 'accepted').length,
        declined: mockRequests.filter(r => r.status === 'declined').length,
    }

    const handleResend = (id: string) => {
        // Would resend via API
        toast.success('Request resent')
        console.log('Resend request:', id)
    }

    return (
        <div className="sent-requests-page">
            {/* Header */}
            <header className="sent-requests-header">
                <Pressable className="back-btn" onClick={() => navigate(-1)}>
                    <ArrowLeft size={20} />
                </Pressable>
                <span className="sent-requests-title">Sent Requests</span>
                <Pressable className="filter-btn" onClick={() => setShowFilters(!showFilters)}>
                    <Filter size={20} />
                </Pressable>
            </header>

            {/* Stats Row */}
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

            {/* Filter Tabs */}
            {showFilters && (
                <div className="requests-filter-tabs">
                    {(['all', 'pending', 'viewed', 'accepted', 'declined'] as FilterType[]).map((f) => (
                        <Pressable
                            key={f}
                            className={`requests-filter-tab ${filter === f ? 'active' : ''}`}
                            onClick={() => setFilter(f)}
                        >
                            {f.charAt(0).toUpperCase() + f.slice(1)}
                        </Pressable>
                    ))}
                </div>
            )}

            {/* Requests List */}
            <div className="sent-requests-content">
                {isLoading ? (
                    <SkeletonList count={5} />
                ) : filteredRequests.length === 0 ? (
                    <div className="requests-empty">
                        <div className="requests-empty-icon">
                            <Send size={32} />
                        </div>
                        <p className="requests-empty-title">No requests found</p>
                        <p className="requests-empty-desc">
                            {filter === 'all'
                                ? 'Send your first request to get started'
                                : `No ${filter} requests`}
                        </p>
                        <Pressable
                            className="requests-empty-btn"
                            onClick={() => navigate('/request/new')}
                        >
                            <Send size={18} />
                            <span>New Request</span>
                        </Pressable>
                    </div>
                ) : (
                    <div className="requests-list">
                        {filteredRequests.map((request) => (
                            <div key={request.id} className="request-card">
                                <Pressable className="request-card-main">
                                    <div className="request-avatar">
                                        {request.recipientName.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="request-info">
                                        <div className="request-top-row">
                                            <span className="request-recipient">{request.recipientName}</span>
                                            <span className="request-amount">
                                                ${request.amount}{request.isRecurring ? '/mo' : ''}
                                            </span>
                                        </div>
                                        <div className="request-bottom-row">
                                            <span className="request-purpose">{request.purpose}</span>
                                            <span className="request-date">{request.sentAt}</span>
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
                                        {(request.status === 'declined' || request.status === 'expired') && (
                                            <Pressable
                                                className="request-action-btn"
                                                onClick={() => handleResend(request.id)}
                                            >
                                                <RefreshCw size={14} />
                                                <span>Resend</span>
                                            </Pressable>
                                        )}
                                        {request.status === 'pending' && (
                                            <span className="request-via">via {request.sentVia}</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* FAB for new request */}
            <Pressable className="requests-fab" onClick={() => navigate('/request/new')}>
                <Send size={24} />
            </Pressable>
        </div>
    )
}
