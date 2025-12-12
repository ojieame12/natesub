import { useNavigate } from 'react-router-dom'
import { CheckCircle, Heart } from 'lucide-react'
import { Pressable } from '../components'
import type { Profile } from '../api/client'
import './template-one.css'

interface SubscriptionSuccessProps {
    profile: Profile
    provider: string | null
}

export default function SubscriptionSuccess({ profile, provider }: SubscriptionSuccessProps) {
    const navigate = useNavigate()
    const name = profile.displayName || profile.username || 'them'

    return (
        <div className="sub-page template-boundary">
            <div className="sub-success-container">
                <div className="sub-success-icon">
                    <CheckCircle size={64} />
                </div>

                <h1 className="sub-success-title">You're subscribed!</h1>

                <p className="sub-success-message">
                    Thank you for supporting {name}. Your subscription is now active.
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
                    {provider && (
                        <div className="sub-success-detail-row">
                            <span className="sub-success-label">Payment via</span>
                            <span className="sub-success-value">{provider === 'paystack' ? 'Paystack' : 'Stripe'}</span>
                        </div>
                    )}
                </div>

                <p className="sub-success-note">
                    You'll receive a confirmation email with your subscription details.
                </p>

                <div className="sub-success-actions">
                    <Pressable
                        className="sub-success-btn primary"
                        onClick={() => {
                            // Clear query params and go back to profile
                            navigate(`/${profile.username}`, { replace: true })
                        }}
                    >
                        <Heart size={18} />
                        <span>Back to {name}'s page</span>
                    </Pressable>
                </div>
            </div>
        </div>
    )
}
