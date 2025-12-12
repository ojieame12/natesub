import { useNavigate } from 'react-router-dom'
import {
    ArrowLeft,
    Send,
    Image,
    Clock,
    Users,
    Eye,
    ChevronRight,
} from 'lucide-react'
import { Pressable, SkeletonList, ErrorState } from '../components'
import { useUpdates } from '../api/hooks'
import './UpdatesHistory.css'

// Format date for display
const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    })
}

const getAudienceLabel = (audience: string) => {
    switch (audience) {
        case 'all': return 'All Subscribers'
        case 'supporters': return 'Supporters+'
        case 'vip': return 'VIPs Only'
        default: return 'Selected Tier'
    }
}

export default function UpdatesHistory() {
    const navigate = useNavigate()

    // Real API hook
    const { data, isLoading, isError, refetch } = useUpdates()
    const updates = data?.updates || []

    return (
        <div className="updates-history-page">
            {/* Header */}
            <header className="updates-history-header">
                <Pressable className="back-btn" onClick={() => navigate(-1)}>
                    <ArrowLeft size={20} />
                </Pressable>
                <img src="/logo.svg" alt="NatePay" className="header-logo" />
                <Pressable className="new-btn" onClick={() => navigate('/updates/new')}>
                    <Send size={20} />
                </Pressable>
            </header>

            {/* Content */}
            <div className="updates-history-content">
                {isError ? (
                    <ErrorState
                        title="Couldn't load updates"
                        message="We had trouble loading your updates. Please try again."
                        onRetry={refetch}
                    />
                ) : isLoading ? (
                    <SkeletonList count={4} />
                ) : updates.length === 0 ? (
                    <div className="updates-empty">
                        <div className="updates-empty-icon">
                            <Send size={32} />
                        </div>
                        <h3 className="updates-empty-title">No updates yet</h3>
                        <p className="updates-empty-desc">
                            Send updates to your subscribers to keep them engaged.
                        </p>
                        <Pressable
                            className="updates-empty-btn"
                            onClick={() => navigate('/updates/new')}
                        >
                            <Send size={18} />
                            <span>Send First Update</span>
                        </Pressable>
                    </div>
                ) : (
                    <div className="updates-list">
                        {updates.map((update: any) => {
                            const displayDate = update.sentAt
                                ? formatDate(update.sentAt)
                                : formatDate(update.createdAt)

                            return (
                                <Pressable key={update.id} className="update-card" onClick={() => navigate(`/updates/${update.id}`)}>
                                    <div className="update-card-main">
                                        {update.photoUrl ? (
                                            <div className="update-thumbnail">
                                                <Image size={20} />
                                            </div>
                                        ) : (
                                            <div className="update-thumbnail text-only">
                                                <Send size={20} />
                                            </div>
                                        )}
                                        <div className="update-content">
                                            <p className="update-caption">{update.body}</p>
                                            <div className="update-meta">
                                                <Clock size={12} />
                                                <span>{displayDate}</span>
                                            </div>
                                        </div>
                                        <ChevronRight size={18} className="update-chevron" />
                                    </div>
                                    <div className="update-card-footer">
                                        <span className="update-audience">
                                            <Users size={14} />
                                            {getAudienceLabel(update.audience)}
                                        </span>
                                        <span className="update-views">
                                            <Eye size={14} />
                                            {update.viewCount || 0}/{update.recipientCount || 0}
                                        </span>
                                    </div>
                                </Pressable>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    )
}
