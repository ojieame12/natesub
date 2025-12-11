import { useParams, useNavigate } from 'react-router-dom'
import {
    ArrowLeft,
    Users,
    Eye,
    Clock,
    CheckCheck,
    RefreshCw,
} from 'lucide-react'
import { Pressable } from '../components'
import { getAudienceLabel, type UpdateAudience } from './store'
import './UpdateDetail.css'

// Mock update data - would come from store/API
interface UpdateDetail {
    id: string
    caption: string
    imageUrl?: string
    sentAt: string
    audience: UpdateAudience
    stats: {
        views: number
        recipients: number
        opened: number
    }
    viewers: Array<{
        id: string
        name: string
        avatar?: string
    }>
}

const mockUpdates: Record<string, UpdateDetail> = {
    '1': {
        id: '1',
        caption: 'Just finished editing the new video! Coming to you all tomorrow 🎬',
        imageUrl: '/dither-2.png',
        sentAt: 'Dec 10, 2024 at 3:45 PM',
        audience: 'all',
        stats: { views: 42, recipients: 56, opened: 48 },
        viewers: [
            { id: 'v1', name: 'Sarah M.' },
            { id: 'v2', name: 'James K.' },
            { id: 'v3', name: 'Emma L.' },
            { id: 'v4', name: 'Michael R.' },
            { id: 'v5', name: 'Olivia T.' },
        ],
    },
    '2': {
        id: '2',
        caption: 'Thank you all for the amazing support this month! You make this possible 💛',
        sentAt: 'Dec 5, 2024 at 11:20 AM',
        audience: 'all',
        stats: { views: 51, recipients: 56, opened: 54 },
        viewers: [
            { id: 'v1', name: 'Alex P.' },
            { id: 'v2', name: 'Jordan S.' },
            { id: 'v3', name: 'Taylor W.' },
        ],
    },
    '3': {
        id: '3',
        caption: 'Exclusive behind-the-scenes look at what I\'m working on...',
        imageUrl: '/dither.png',
        sentAt: 'Nov 28, 2024 at 6:00 PM',
        audience: 'vips',
        stats: { views: 8, recipients: 12, opened: 10 },
        viewers: [
            { id: 'v1', name: 'Chris D.' },
            { id: 'v2', name: 'Morgan F.' },
        ],
    },
}

export default function UpdateDetail() {
    const { id } = useParams<{ id: string }>()
    const navigate = useNavigate()

    const update = id ? mockUpdates[id] : null

    if (!update) {
        return (
            <div className="update-detail-page">
                <header className="update-detail-header">
                    <Pressable className="back-btn" onClick={() => navigate(-1)}>
                        <ArrowLeft size={20} />
                    </Pressable>
                    <span className="update-detail-title">Update</span>
                    <div style={{ width: 36 }} />
                </header>
                <div className="update-detail-empty">
                    <p>Update not found</p>
                </div>
            </div>
        )
    }

    const openRate = Math.round((update.stats.opened / update.stats.recipients) * 100)
    const unopened = update.stats.recipients - update.stats.opened

    return (
        <div className="update-detail-page">
            {/* Header */}
            <header className="update-detail-header">
                <Pressable className="back-btn" onClick={() => navigate(-1)}>
                    <ArrowLeft size={20} />
                </Pressable>
                <span className="update-detail-title">Update</span>
                <div style={{ width: 36 }} />
            </header>

            <div className="update-detail-content">
                {/* Message Bubble */}
                <div className="update-message-container">
                    <div className="update-message-bubble">
                        {update.imageUrl && (
                            <div className="update-message-image">
                                <img src={update.imageUrl} alt="" />
                            </div>
                        )}
                        <p className="update-message-text">{update.caption}</p>
                    </div>

                    <div className="update-message-meta">
                        <span className="update-message-time">
                            <Clock size={12} />
                            {update.sentAt}
                        </span>
                        <span className="update-message-status">
                            <CheckCheck size={14} />
                            Delivered
                        </span>
                    </div>
                </div>

                {/* Stats Section */}
                <div className="update-stats-section">
                    <h3 className="update-stats-title">Engagement</h3>

                    <div className="update-stats-grid">
                        <div className="update-stat-card">
                            <div className="update-stat-icon">
                                <Users size={18} />
                            </div>
                            <div className="update-stat-info">
                                <span className="update-stat-value">{update.stats.recipients}</span>
                                <span className="update-stat-label">Recipients</span>
                            </div>
                        </div>

                        <div className="update-stat-card">
                            <div className="update-stat-icon opened">
                                <CheckCheck size={18} />
                            </div>
                            <div className="update-stat-info">
                                <span className="update-stat-value">{openRate}%</span>
                                <span className="update-stat-label">Opened</span>
                            </div>
                        </div>

                        <div className="update-stat-card">
                            <div className="update-stat-icon views">
                                <Eye size={18} />
                            </div>
                            <div className="update-stat-info">
                                <span className="update-stat-value">{update.stats.views}</span>
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

                {/* Viewers Section */}
                <div className="update-viewers-section">
                    <h3 className="update-viewers-title">
                        Who viewed
                        <span className="update-viewers-count">{update.stats.views}</span>
                    </h3>

                    <div className="update-viewers-list">
                        {update.viewers.map((viewer) => (
                            <div key={viewer.id} className="update-viewer-item">
                                <div className="update-viewer-avatar">
                                    {viewer.name.charAt(0)}
                                </div>
                                <span className="update-viewer-name">{viewer.name}</span>
                            </div>
                        ))}
                        {update.stats.views > update.viewers.length && (
                            <div className="update-viewer-item more">
                                <div className="update-viewer-avatar more">
                                    +{update.stats.views - update.viewers.length}
                                </div>
                                <span className="update-viewer-name">more</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Resend Option */}
                {unopened > 0 && (
                    <div className="update-resend-section">
                        <Pressable className="update-resend-btn">
                            <RefreshCw size={18} />
                            <span>Resend to {unopened} who haven't opened</span>
                        </Pressable>
                    </div>
                )}
            </div>
        </div>
    )
}
