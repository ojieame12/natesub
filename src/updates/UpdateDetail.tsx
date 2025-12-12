import { useParams, useNavigate } from 'react-router-dom'
import {
    ArrowLeft,
    Users,
    Eye,
    Clock,
    CheckCheck,
    Loader2,
} from 'lucide-react'
import { Pressable, Skeleton, ErrorState } from '../components'
import { useUpdate } from '../api/hooks'
import './UpdateDetail.css'

const getAudienceLabel = (audience: string) => {
    switch (audience) {
        case 'all': return 'All Subscribers'
        case 'supporters': return 'Supporters+'
        case 'vip': return 'VIPs Only'
        default: return 'Selected Tier'
    }
}

const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    })
}

export default function UpdateDetail() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()

    const { data, isLoading, isError, refetch } = useUpdate(id || '')

    if (isLoading) {
        return (
            <div className="update-detail-page">
                <header className="update-detail-header">
                    <Pressable className="back-btn" onClick={() => navigate(-1)}>
                        <ArrowLeft size={20} />
                    </Pressable>
                    <img src="/logo.svg" alt="NatePay" className="header-logo" />
                    <div style={{ width: 36 }} />
                </header>
                <div className="update-detail-content">
                    <div className="update-message-container">
                        <Skeleton width="100%" height={200} borderRadius={16} />
                    </div>
                    <div className="update-stats-section">
                        <Skeleton width={120} height={20} style={{ marginBottom: 16 }} />
                        <div className="update-stats-grid">
                            <Skeleton width="100%" height={80} borderRadius={12} />
                            <Skeleton width="100%" height={80} borderRadius={12} />
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    if (isError) {
        return (
            <div className="update-detail-page">
                <header className="update-detail-header">
                    <Pressable className="back-btn" onClick={() => navigate(-1)}>
                        <ArrowLeft size={20} />
                    </Pressable>
                    <img src="/logo.svg" alt="NatePay" className="header-logo" />
                    <div style={{ width: 36 }} />
                </header>
                <ErrorState
                    title="Couldn't load update"
                    message="We had trouble loading this update."
                    onRetry={() => refetch()}
                />
            </div>
        )
    }

    const update = data?.update

    if (!update) {
        return (
            <div className="update-detail-page">
                <header className="update-detail-header">
                    <Pressable className="back-btn" onClick={() => navigate(-1)}>
                        <ArrowLeft size={20} />
                    </Pressable>
                    <img src="/logo.svg" alt="NatePay" className="header-logo" />
                    <div style={{ width: 36 }} />
                </header>
                <div className="update-detail-empty">
                    <p>Update not found</p>
                </div>
            </div>
        )
    }

    return (
        <div className="update-detail-page">
            {/* Header */}
            <header className="update-detail-header">
                <Pressable className="back-btn" onClick={() => navigate(-1)}>
                    <ArrowLeft size={20} />
                </Pressable>
                <img src="/logo.svg" alt="NatePay" className="header-logo" />
                <div style={{ width: 36 }} />
            </header>

            <div className="update-detail-content">
                {/* Message Bubble */}
                <div className="update-message-container">
                    <div className="update-message-bubble">
                        {update.photoUrl && (
                            <div className="update-message-image">
                                <img src={update.photoUrl} alt="" />
                            </div>
                        )}
                        {update.title && (
                            <h3 className="update-message-title">{update.title}</h3>
                        )}
                        <p className="update-message-text">{update.body}</p>
                    </div>

                    <div className="update-message-meta">
                        <span className="update-message-time">
                            <Clock size={12} />
                            {update.sentAt ? formatDate(update.sentAt) : formatDate(update.createdAt)}
                        </span>
                        <span className="update-message-status">
                            {update.status === 'sent' ? (
                                <>
                                    <CheckCheck size={14} />
                                    Delivered
                                </>
                            ) : (
                                <>
                                    <Clock size={14} />
                                    Draft
                                </>
                            )}
                        </span>
                    </div>
                </div>

                {/* Stats Section - only show for sent updates */}
                {update.status === 'sent' && (
                    <div className="update-stats-section">
                        <h3 className="update-stats-title">Engagement</h3>

                        <div className="update-stats-grid">
                            <div className="update-stat-card">
                                <div className="update-stat-icon">
                                    <Users size={18} />
                                </div>
                                <div className="update-stat-info">
                                    <span className="update-stat-value">{update.recipientCount || 0}</span>
                                    <span className="update-stat-label">Recipients</span>
                                </div>
                            </div>

                            <div className="update-stat-card">
                                <div className="update-stat-icon views">
                                    <Eye size={18} />
                                </div>
                                <div className="update-stat-info">
                                    <span className="update-stat-value">{update.viewCount || 0}</span>
                                    <span className="update-stat-label">Views</span>
                                </div>
                            </div>
                        </div>

                        {/* Audience Badge */}
                        <div className="update-audience-badge">
                            <Users size={14} />
                            <span>Sent to {getAudienceLabel(update.audience)}</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
