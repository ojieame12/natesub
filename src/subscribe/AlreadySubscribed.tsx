import { useNavigate } from 'react-router-dom'
import { Heart, Calendar, ChevronLeft } from 'lucide-react'
import { Pressable } from '../components'
import type { Profile, ViewerSubscription } from '../api/client'
import { formatAmountWithSeparators } from '../utils/currency'
import './template-one.css'

interface AlreadySubscribedProps {
    profile: Profile
    subscription: ViewerSubscription
}

export default function AlreadySubscribed({ profile, subscription }: AlreadySubscribedProps) {
    const navigate = useNavigate()
    const name = profile.displayName || profile.username || 'them'

    // Format the subscription date
    const subscribedSince = new Date(subscription.since).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    })

    // Format next billing date
    const nextBilling = subscription.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        })
        : null

    return (
        <div className="sub-page template-boundary">
            {/* Header with back button */}
            <div className="sub-header">
                <Pressable className="sub-back-btn" onClick={() => navigate('/')}>
                    <ChevronLeft size={20} />
                </Pressable>
                <img src="/logo.svg" alt="nate" className="sub-logo-img" />
                <div className="sub-header-spacer" />
            </div>

            <div className="sub-success-container">
                <div className="sub-success-icon sub-already-subscribed">
                    <Heart size={64} fill="currentColor" />
                </div>

                <h1 className="sub-success-title">You're subscribed!</h1>

                <p className="sub-success-message">
                    You're already supporting {name}. Thank you for being a subscriber!
                </p>

                {profile.avatarUrl && (
                    <div className="sub-success-avatar">
                        <img src={profile.avatarUrl} alt={name} />
                    </div>
                )}

                <div className="sub-success-details">
                    <div className="sub-success-detail-row">
                        <span className="sub-success-label">Subscribed to</span>
                        <span className="sub-success-value">@{profile.username}</span>
                    </div>
                    {subscription.tierName && (
                        <div className="sub-success-detail-row">
                            <span className="sub-success-label">Plan</span>
                            <span className="sub-success-value">{subscription.tierName}</span>
                        </div>
                    )}
                    <div className="sub-success-detail-row">
                        <span className="sub-success-label">Amount</span>
                        <span className="sub-success-value">
                            {formatAmountWithSeparators(subscription.amount, subscription.currency)}/mo
                        </span>
                    </div>
                    <div className="sub-success-detail-row">
                        <span className="sub-success-label">Member since</span>
                        <span className="sub-success-value">{subscribedSince}</span>
                    </div>
                    {nextBilling && (
                        <div className="sub-success-detail-row">
                            <span className="sub-success-label">Next billing</span>
                            <span className="sub-success-value">
                                <Calendar size={14} style={{ marginRight: 4, verticalAlign: 'text-bottom' }} />
                                {nextBilling}
                            </span>
                        </div>
                    )}
                </div>

                <div className="sub-success-actions">
                    <p className="sub-success-subtext">
                        Thank you for your continued support!
                    </p>
                </div>
            </div>
        </div>
    )
}
