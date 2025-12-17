import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useOnboardingStore } from '../onboarding/store'
import { ChevronLeft, Check, Heart } from 'lucide-react'
import { Pressable } from '../components'
import { getCurrencySymbol, formatCompactNumber, formatAmountWithSeparators } from '../utils/currency'
import './subscribe.css'

type ViewType = 'main' | 'impact' | 'tiers' | 'payment'

export default function SubscribePage() {
    const navigate = useNavigate()
    const { username: urlUsername } = useParams<{ username: string }>()

    const {
        name,
        avatarUrl,
        pricingModel,
        singleAmount,
        tiers,
        currency,
    } = useOnboardingStore()

    const currencySymbol = getCurrencySymbol(currency)

    // State
    const [currentView, setCurrentView] = useState<ViewType>('main')
    const [selectedTierId, setSelectedTierId] = useState<string | null>(
        tiers.find(t => t.isPopular)?.id || tiers[0]?.id || null
    )
    const [isSubscribed, setIsSubscribed] = useState(false)

    const displayName = name || urlUsername || 'Someone'
    const selectedTier = tiers.find(t => t.id === selectedTierId)
    const currentAmount = pricingModel === 'single' ? singleAmount : selectedTier?.amount
    const currentAmount = pricingModel === 'single' ? singleAmount : selectedTier?.amount

    // Fallback images from Unsplash
    const fallbackCover = 'https://images.unsplash.com/photo-1534088568595-a066f410bcda?w=800&q=80'
    const fallbackAvatar = 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=80'

    // Build view sequence based on available content
    const viewSequence: ViewType[] = ['main']
    // Impact step removed
    if (pricingModel === 'tiers') viewSequence.push('tiers')
    viewSequence.push('payment')

    const currentIndex = viewSequence.indexOf(currentView)
    const isLastView = currentIndex === viewSequence.length - 1

    const handleSubscribe = () => {
        if (currentView === 'payment') {
            console.log('Subscribing at ' + currencySymbol + currentAmount + '/month')
            setIsSubscribed(true)
        } else {
            const nextView = viewSequence[currentIndex + 1]
            if (nextView) setCurrentView(nextView)
        }
    }

    const handleBack = () => {
        if (currentView === 'main') {
            navigate(-1)
        } else {
            const prevView = viewSequence[currentIndex - 1]
            if (prevView) setCurrentView(prevView)
        }
    }

    // Success state
    if (isSubscribed) {
        return (
            <div className="sub-page">
                <div className="sub-success">
                    <div className="sub-success-icon">
                        <Check size={32} />
                    </div>
                    <h1 className="sub-success-title">You're in!</h1>
                    <p className="sub-success-text">
                        You're now supporting {displayName} at {formatAmountWithSeparators(currentAmount || 0, currency)}/month
                    </p>
                    <Pressable className="sub-btn sub-btn-secondary" onClick={() => navigate('/dashboard')}>
                        Done
                    </Pressable>
                </div>
            </div>
        )
    }

    return (
        <div className="sub-page">
            {/* Header */}
            <header className="sub-header">
                <Pressable className="sub-back" onClick={handleBack}>
                    <ChevronLeft size={24} />
                </Pressable>
                <div className="sub-header-badge">
                    <Heart size={14} />
                    <span>Subscribe</span>
                </div>
                <div style={{ width: 44 }} />
            </header>

            {/* Single Unified Card */}
            <div className="sub-card">
                {/* Cover Image */}
                <div className="sub-cover">
                    <img src={avatarUrl || fallbackCover} alt="" className="sub-cover-img" />
                </div>

                {/* Avatar - positioned at boundary */}
                <div className="sub-avatar-wrapper">
                    <div className="sub-avatar">
                        <img src={avatarUrl || fallbackAvatar} alt={displayName} />
                    </div>
                </div>

                {/* Content Area - Swipeable */}
                <div className="sub-content">
                    {/* Main View */}
                    {currentView === 'main' && (
                        <div className="sub-view">
                            <h1 className="sub-name">{displayName}</h1>
                            <p className="sub-subtext">Subscribe to support {displayName} with a monthly subscription</p>

                            {/* Stats Row */}
                            <div className="sub-stats-container">
                                <div className="sub-stat">
                                    <span className="sub-stat-value">{currencySymbol}{formatCompactNumber(currentAmount || 0)}</span>
                                    <span className="sub-stat-label">Monthly</span>
                                </div>

                                <div className="sub-stat-divider" />
                                <div className="sub-stat">
                                    <span className="sub-stat-value">{pricingModel === 'tiers' ? tiers.length : 1}</span>
                                    <span className="sub-stat-label">{pricingModel === 'tiers' ? 'Tiers' : 'Tier'}</span>
                                </div>
                            </div>
                        </div>
                    )}



                    {/* Tiers View */}
                    {currentView === 'tiers' && (
                        <div className="sub-view">
                            <h2 className="sub-view-title">Choose tier</h2>
                            <div className="sub-tier-list">
                                {tiers.map((tier) => {
                                    const isSelected = tier.id === selectedTierId
                                    return (
                                        <Pressable
                                            key={tier.id}
                                            className={`sub-tier-item ${isSelected ? 'selected' : ''}`}
                                            onClick={() => setSelectedTierId(tier.id)}
                                        >
                                            <div className="sub-tier-left">
                                                <span className="sub-tier-name">{tier.name}</span>
                                                {tier.isPopular && <span className="sub-tier-badge">Popular</span>}
                                            </div>
                                            <span className="sub-tier-price">{currencySymbol}{formatCompactNumber(tier.amount)}</span>
                                            {isSelected && (
                                                <div className="sub-tier-check">
                                                    <Check size={14} />
                                                </div>
                                            )}
                                        </Pressable>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    {/* Payment View */}
                    {currentView === 'payment' && (
                        <div className="sub-view">
                            <h2 className="sub-view-title">Confirm</h2>
                            <div className="sub-payment-summary">
                                <div className="sub-payment-row">
                                    <span>Monthly</span>
                                    <span className="sub-payment-amount">{formatAmountWithSeparators(currentAmount || 0, currency)}</span>
                                </div>
                                {selectedTier && pricingModel === 'tiers' && (
                                    <div className="sub-payment-row">
                                        <span className="sub-payment-tier">{selectedTier.name} tier</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Pagination Dots */}
                <div className="sub-dots">
                    {viewSequence.map((view) => (
                        <button
                            key={view}
                            className={`sub-dot ${currentView === view ? 'active' : ''}`}
                            onClick={() => setCurrentView(view)}
                        />
                    ))}
                </div>

                {/* Subscribe Button - Inside Card */}
                <div className="sub-button-wrapper">
                    <Pressable
                        className={`sub-subscribe-btn ${isLastView ? 'ready' : ''}`}
                        onClick={handleSubscribe}
                    >
                        {isLastView ? `Subscribe · ${currencySymbol}${formatCompactNumber(currentAmount || 0)}/mo` : `Continue`}
                    </Pressable>
                </div>
            </div>
        </div>
    )
}
