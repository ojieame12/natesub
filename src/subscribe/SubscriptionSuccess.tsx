import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Heart, Loader2 } from 'lucide-react'
import { Pressable } from '../components'
import { api } from '../api'
import type { Profile } from '../api/client'
import './template-one.css'

interface SubscriptionSuccessProps {
    profile: Profile
    provider: string | null
}

type VerificationStatus = 'loading' | 'verified'

export default function SubscriptionSuccess({ profile, provider }: SubscriptionSuccessProps) {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const name = profile.displayName || profile.username || 'them'

    // Verification state - start loading for everyone to check webhook status
    const [status, setStatus] = useState<VerificationStatus>('loading')
    const pollCount = useRef(0)

    // Verify Subscription (Stripe & Paystack)
    useEffect(() => {
        let isMounted = true
        let timer: number | null = null
        pollCount.current = 0

        const checkSubscription = async () => {
            try {
                const data = await api.users.getByUsername(profile.username)
                
                if (data.viewerSubscription?.isActive) {
                    if (isMounted) {
                        setStatus('verified')
                        // Update global cache
                        queryClient.invalidateQueries({ queryKey: ['publicProfile', profile.username] })
                    }
                    return true
                }
            } catch (err) {
                console.error('Poll error', err)
            }
            return false
        }

        const poll = async () => {
            if (pollCount.current > 5) { // 10 seconds (5 * 2s)
                // Timeout - Optimistically show success but warn
                if (isMounted) setStatus('verified')
                return
            }

            const success = await checkSubscription()
            if (!success && isMounted) {
                pollCount.current++
                timer = window.setTimeout(poll, 2000)
            }
        }

        // Start polling
        poll()

        return () => {
            isMounted = false
            if (timer !== null) window.clearTimeout(timer)
        }
    }, [profile.username, queryClient])

    // Loading state
    if (status === 'loading') {
        return (
            <div className="sub-page template-boundary">
                <div className="sub-success-container">
                    <div className="sub-success-icon" style={{ color: 'var(--text-secondary)' }}>
                        <Loader2 size={64} className="spin" />
                    </div>
                    <h1 className="sub-success-title">Confirming Payment...</h1>
                    <p className="sub-success-message">
                        Please wait a moment while we secure your subscription.
                    </p>
                </div>
            </div>
        )
    }

    // Success state (verified)
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
                    {name} has been notified of your subscription.
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
