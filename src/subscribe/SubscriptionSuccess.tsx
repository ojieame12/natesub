import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle, Heart, Loader2, AlertCircle } from 'lucide-react'
import { Pressable } from '../components'
import { api } from '../api'
import type { Profile } from '../api/client'
import './template-one.css'

interface SubscriptionSuccessProps {
    profile: Profile
    provider: string | null
}

type VerificationStatus = 'loading' | 'verified' | 'failed'

export default function SubscriptionSuccess({ profile, provider }: SubscriptionSuccessProps) {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const name = profile.displayName || profile.username || 'them'

    // Verification state
    const [status, setStatus] = useState<VerificationStatus>(
        provider === 'paystack' ? 'loading' : 'verified' // Stripe verified via webhook
    )
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    // For Paystack: verify the transaction on mount
    useEffect(() => {
        if (provider !== 'paystack') return

        const verifyPayment = async () => {
            // Get reference from URL (Paystack adds ?reference=xxx or ?trxref=xxx)
            const reference = searchParams.get('reference') || searchParams.get('trxref')

            if (!reference) {
                // No reference - can't verify, but payment might have succeeded via webhook
                // Give benefit of doubt but log warning
                console.warn('[subscription] Paystack success without reference - cannot verify')
                setStatus('verified')
                return
            }

            try {
                const result = await api.paystack.verifyTransaction(reference)

                if (result.verified) {
                    setStatus('verified')
                } else {
                    setStatus('failed')
                    setErrorMessage(result.error || 'Payment could not be verified')
                }
            } catch (err: any) {
                console.error('[subscription] Paystack verification error:', err)
                // On network error, give benefit of doubt (webhook handles actual payment)
                // But show a soft warning
                setStatus('verified')
            }
        }

        verifyPayment()
    }, [provider, searchParams])

    // Loading state
    if (status === 'loading') {
        return (
            <div className="sub-page template-boundary">
                <div className="sub-success-container">
                    <div className="sub-success-icon" style={{ color: 'var(--text-secondary)' }}>
                        <Loader2 size={64} className="spin" />
                    </div>
                    <h1 className="sub-success-title">Verifying payment...</h1>
                    <p className="sub-success-message">
                        Please wait while we confirm your subscription.
                    </p>
                </div>
            </div>
        )
    }

    // Error state
    if (status === 'failed') {
        return (
            <div className="sub-page template-boundary">
                <div className="sub-success-container">
                    <div className="sub-success-icon" style={{ color: 'var(--error)' }}>
                        <AlertCircle size={64} />
                    </div>
                    <h1 className="sub-success-title">Payment Issue</h1>
                    <p className="sub-success-message">
                        {errorMessage || 'We could not verify your payment. Please try again or contact support.'}
                    </p>
                    <div className="sub-success-actions">
                        <Pressable
                            className="sub-success-btn primary"
                            onClick={() => navigate(`/${profile.username}`, { replace: true })}
                        >
                            Try Again
                        </Pressable>
                    </div>
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
