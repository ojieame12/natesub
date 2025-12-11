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
import { Pressable } from '../components'
import './UpdatesHistory.css'

// Mock updates data
interface Update {
    id: string
    caption: string
    imageUrl?: string
    sentAt: string
    audience: 'all' | 'supporters' | 'vips'
    stats: {
        views: number
        recipients: number
    }
}

const mockUpdates: Update[] = [
    {
        id: '1',
        caption: 'Just finished editing the new video! Coming to you all tomorrow 🎬',
        imageUrl: '/dither-2.png',
        sentAt: 'Dec 10, 2024 at 3:45 PM',
        audience: 'all',
        stats: { views: 42, recipients: 56 },
    },
    {
        id: '2',
        caption: 'Thank you all for the amazing support this month! You make this possible 💛',
        sentAt: 'Dec 5, 2024 at 11:20 AM',
        audience: 'all',
        stats: { views: 51, recipients: 56 },
    },
    {
        id: '3',
        caption: 'Exclusive behind-the-scenes look at what I\'m working on...',
        imageUrl: '/dither.png',
        sentAt: 'Nov 28, 2024 at 6:00 PM',
        audience: 'vips',
        stats: { views: 8, recipients: 12 },
    },
]

const getAudienceLabel = (audience: Update['audience']) => {
    switch (audience) {
        case 'all': return 'All Subscribers'
        case 'supporters': return 'Supporters+'
        case 'vips': return 'VIPs Only'
    }
}

export default function UpdatesHistory() {
    const navigate = useNavigate()

    return (
        <div className="updates-history-page">
            {/* Header */}
            <header className="updates-history-header">
                <Pressable className="back-btn" onClick={() => navigate(-1)}>
                    <ArrowLeft size={20} />
                </Pressable>
                <span className="updates-history-title">Updates</span>
                <Pressable className="new-btn" onClick={() => navigate('/updates/new')}>
                    <Send size={20} />
                </Pressable>
            </header>

            {/* Content */}
            <div className="updates-history-content">
                {mockUpdates.length === 0 ? (
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
                        {mockUpdates.map((update) => (
                            <Pressable key={update.id} className="update-card" onClick={() => navigate(`/updates/${update.id}`)}>
                                <div className="update-card-main">
                                    {update.imageUrl ? (
                                        <div className="update-thumbnail">
                                            <Image size={20} />
                                        </div>
                                    ) : (
                                        <div className="update-thumbnail text-only">
                                            <Send size={20} />
                                        </div>
                                    )}
                                    <div className="update-content">
                                        <p className="update-caption">{update.caption}</p>
                                        <div className="update-meta">
                                            <Clock size={12} />
                                            <span>{update.sentAt}</span>
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
                                        {update.stats.views}/{update.stats.recipients}
                                    </span>
                                </div>
                            </Pressable>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}
