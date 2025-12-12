import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Play, Banknote, Briefcase, X, ChevronLeft } from 'lucide-react'
import Lottie from 'lottie-react'
import swipeAnimation from './animations/swipe-left.json'
import moneyAnimation from './animations/money-send.json'
import { Pressable } from '../components'
import { useCreateCheckout } from '../api/hooks'
import type { Profile } from '../api/client'
import { getCurrencySymbol } from '../utils/currency'
import './template-one.css'

type ViewType = 'welcome' | 'impact' | 'perks' | 'payment'

interface SubscribeBoundaryProps {
    profile: Profile
}

export default function SubscribeBoundary({ profile }: SubscribeBoundaryProps) {
    const navigate = useNavigate()
    const { mutateAsync: createCheckout, isPending: isCheckoutLoading } = useCreateCheckout()

    // Extract profile data
    const {
        username,
        displayName,
        bio,
        avatarUrl,
        voiceIntroUrl,
        purpose,
        pricingModel,
        singleAmount,
        tiers,
        perks: profilePerks,
        impactItems: profileImpactItems,
        currency,
        paymentProvider,
    } = profile

    // Determine if this is a service page vs personal
    const isService = purpose === 'service'
    const currencySymbol = getCurrencySymbol(currency)
    const isPaystack = paymentProvider === 'paystack'

    // State
    const [currentView, setCurrentView] = useState<ViewType>('welcome')
    const [isSubscribed] = useState(false) // Success handled by Stripe redirect
    const [isPlaying, setIsPlaying] = useState(false)
    const [showTerms, setShowTerms] = useState(false)

    // Swipe handling
    const touchStartX = useRef<number>(0)
    const touchEndX = useRef<number>(0)

    const name = displayName || username || 'Someone'
    const currentAmount = pricingModel === 'single' ? (singleAmount || 10) : (tiers?.[0]?.amount || 10)
    const validImpactItems = (profileImpactItems || []).filter(item => item.title.trim() !== '')
    const enabledPerks = (profilePerks || []).filter(perk => perk.enabled)

    // Fallback avatar
    const fallbackAvatar = 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=80'

    // View sequence
    const viewSequence: ViewType[] = ['welcome', 'impact', 'perks', 'payment']
    const currentIndex = viewSequence.indexOf(currentView)

    const [checkoutError, setCheckoutError] = useState<string | null>(null)

    const handleSubscribe = async () => {
        setCheckoutError(null)
        try {
            const result = await createCheckout({
                creatorUsername: username,
                amount: currentAmount,
                interval: 'month',
            })
            // Redirect to checkout (Stripe or Paystack based on creator's provider)
            if (result.url) {
                window.location.href = result.url
            } else {
                setCheckoutError('Unable to create checkout session. Please try again.')
            }
        } catch (error: any) {
            console.error('Checkout failed:', error)
            setCheckoutError(error?.error || 'Payment failed. Please try again.')
            // DO NOT grant access on failure
        }
    }

    const handleDotClick = (index: number) => {
        setCurrentView(viewSequence[index])
    }

    const handleNext = () => {
        if (currentIndex < viewSequence.length - 1) {
            setCurrentView(viewSequence[currentIndex + 1])
        }
    }

    const handlePrev = () => {
        if (currentIndex > 0) {
            setCurrentView(viewSequence[currentIndex - 1])
        }
    }

    // Swipe handlers
    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartX.current = e.touches[0].clientX
    }

    const handleTouchMove = (e: React.TouchEvent) => {
        touchEndX.current = e.touches[0].clientX
    }

    const handleTouchEnd = () => {
        const swipeThreshold = 50
        const diff = touchStartX.current - touchEndX.current

        if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0) {
                // Swiped left - go next
                handleNext()
            } else {
                // Swiped right - go prev
                handlePrev()
            }
        }
    }

    // Success state
    if (isSubscribed) {
        return (
            <div className="sub-page template-boundary">
                <div className="sub-success">
                    <div className="sub-success-icon">
                        <Check size={32} />
                    </div>
                    <h1 className="sub-success-title">You're in!</h1>
                    <p className="sub-success-text">
                        {isService
                            ? `You're now subscribed to ${name}'s services at ${currencySymbol}${currentAmount}/month`
                            : `You're now supporting ${name} at ${currencySymbol}${currentAmount}/month`
                        }
                    </p>
                    <Pressable className="sub-btn sub-btn-secondary" onClick={() => navigate('/dashboard')}>
                        Done
                    </Pressable>
                </div>
            </div>
        )
    }

    return (
        <div className="sub-page template-boundary">
            {/* Header with back button */}
            <div className="sub-header">
                <Pressable className="sub-back-btn" onClick={() => navigate(-1)}>
                    <ChevronLeft size={20} />
                </Pressable>
                <img src="/logo.svg" alt="nate" className="sub-logo-img" />
                <div className="sub-header-spacer" />
            </div>

            {/* Main Card */}
            <div className="sub-card">
                {/* Hero Section - Black card with avatar */}
                <div className="sub-hero">
                    <div className="sub-hero-pattern" />

                    <div className="sub-hero-content">
                        <div className="sub-hero-left">
                            <div className="sub-hero-badge">
                                {isService ? <Briefcase size={14} /> : <Banknote size={14} />}
                                <span>{isService ? 'Service' : 'Tips'}</span>
                            </div>
                            <div className="sub-hero-price">
                                <span className="sub-hero-currency">{currencySymbol}</span>
                                <span className="sub-hero-amount">{currentAmount}</span>
                            </div>
                            <div className="sub-hero-name">{name}</div>
                        </div>

                        <div className="sub-hero-avatar">
                            <img
                                src={avatarUrl || fallbackAvatar}
                                alt={name}
                                onError={(e) => {
                                    e.currentTarget.src = fallbackAvatar
                                }}
                            />
                        </div>
                    </div>
                </div>

                {/* Content Area - Swipeable */}
                <div
                    className="sub-content"
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                >
                    {/* Welcome View */}
                    {currentView === 'welcome' && (
                        <div className="sub-view sub-view-welcome">
                            <div className="sub-welcome-content">
                                <h1 className="sub-welcome-title">
                                    {isService ? (
                                        <>Work with <span className="sub-welcome-highlight">{name.split(' ')[0]}</span></>
                                    ) : (
                                        <>Hello, <span className="sub-welcome-highlight">Loved one</span></>
                                    )}
                                </h1>
                                <p className="sub-welcome-text">
                                    {bio || (isService
                                        ? `Subscribe to get ongoing access to ${name}'s services and expertise.`
                                        : `Would love and appreciate your support with a simple subscription. That would mean the world to me!`
                                    )}
                                </p>

                                {/* Voice Message - only show if voiceIntroUrl exists */}
                                {voiceIntroUrl && (
                                    <div className="sub-voice-card-mini">
                                        <Pressable
                                            className="sub-voice-play"
                                            onClick={() => setIsPlaying(!isPlaying)}
                                        >
                                            <Play size={16} fill={isPlaying ? 'transparent' : 'white'} />
                                        </Pressable>
                                        <div className="sub-voice-info">
                                            <span className="sub-voice-label-mini">Hear From {name.split(' ')[0]}</span>
                                            <span className="sub-voice-time">0:12 / 0:50</span>
                                        </div>
                                    </div>
                                )}
                            </div>

                        </div>
                    )}

                    {/* Impact View */}
                    {currentView === 'impact' && (
                        <div className="sub-view sub-view-impact">
                            <h2 className="sub-section-title">
                                {isService ? 'Why Work With Me' : 'How it would Help Me'}
                            </h2>

                            <div className="sub-items-free">
                                {validImpactItems.map((item, index) => (
                                    <div key={item.id || index} className="sub-item sub-item-numbered">
                                        <span className="sub-item-number">{index + 1}</span>
                                        <div className="sub-item-content">
                                            <span className="sub-item-title">{item.title}</span>
                                            <span className="sub-item-subtitle">{item.subtitle}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Perks View */}
                    {currentView === 'perks' && (
                        <div className="sub-view sub-view-perks">
                            <h2 className="sub-section-title">
                                {isService ? "What's Included" : 'What You would Get'}
                            </h2>

                            <div className="sub-items-free">
                                {enabledPerks.length > 0 ? (
                                    enabledPerks.map((perk) => (
                                        <div key={perk.id} className="sub-item sub-item-checked">
                                            <img src="/check-badge.svg" alt="" className="sub-item-badge" />
                                            <div className="sub-item-content">
                                                <span className="sub-item-title">{perk.title}</span>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="sub-item sub-item-checked">
                                        <img src="/check-badge.svg" alt="" className="sub-item-badge" />
                                        <div className="sub-item-content">
                                            <span className="sub-item-title">Support {name}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Payment View */}
                    {currentView === 'payment' && (
                        <div className="sub-view sub-view-payment">
                            <h2 className="sub-section-title">Complete Subscription</h2>

                            <div className="sub-payment-summary">
                                <div className="sub-payment-row">
                                    <span>Monthly subscription</span>
                                    <span className="sub-payment-amount">{currencySymbol}{currentAmount}/mo</span>
                                </div>
                                <div className="sub-payment-row">
                                    <span>To</span>
                                    <span className="sub-payment-to">{name}</span>
                                </div>
                            </div>

                            {checkoutError && (
                                <div className="sub-payment-error">
                                    {checkoutError}
                                </div>
                            )}

                            <div className="sub-payment-methods">
                                {isPaystack ? (
                                    <Pressable
                                        className="sub-payment-btn sub-payment-paystack"
                                        onClick={handleSubscribe}
                                        disabled={isCheckoutLoading}
                                    >
                                        <span>{isCheckoutLoading ? 'Loading...' : 'Pay with Card or Bank'}</span>
                                    </Pressable>
                                ) : (
                                    <>
                                        <Pressable
                                            className="sub-payment-btn sub-payment-stripe"
                                            onClick={handleSubscribe}
                                            disabled={isCheckoutLoading}
                                        >
                                            <img src="/stripe-logo.svg" alt="Stripe" className="sub-payment-logo" />
                                            <span>{isCheckoutLoading ? 'Loading...' : 'Pay with Stripe'}</span>
                                        </Pressable>

                                        <Pressable
                                            className="sub-payment-btn sub-payment-apple"
                                            onClick={handleSubscribe}
                                            disabled={isCheckoutLoading}
                                        >
                                            <img src="/apple-logo.svg" alt="Apple" className="sub-payment-logo-apple" />
                                            <span>Pay</span>
                                        </Pressable>
                                    </>
                                )}
                            </div>

                            <p className="sub-payment-note">
                                You can cancel anytime. By subscribing you agree to our{' '}
                                <button className="sub-terms-link" onClick={() => setShowTerms(true)}>
                                    Terms & Conditions
                                </button>
                            </p>
                        </div>
                    )}
                </div>

                {/* Swipe Indicator + Pagination Dots */}
                {currentView !== 'payment' && (
                    <div className="sub-pagination">
                        <div className="sub-swipe-indicator">
                            <Lottie
                                animationData={swipeAnimation}
                                loop={true}
                                className="sub-swipe-lottie"
                            />
                            <span className="sub-swipe-text">
                                {currentView === 'welcome' && (isService ? 'Why Work With Me' : 'How it would help Me')}
                                {currentView === 'impact' && (isService ? "What's Included" : 'What You would Get')}
                                {currentView === 'perks' && 'Make Payment'}
                            </span>
                        </div>
                        <div className="sub-dots">
                            {['welcome', 'impact', 'perks'].map((view, index) => (
                                <button
                                    key={index}
                                    className={`sub-dot ${viewSequence[currentIndex] === view ? 'active' : ''}`}
                                    onClick={() => handleDotClick(index)}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Subscribe Button */}
                <div className="sub-button-wrapper">
                    {currentView !== 'payment' && (
                        <Pressable
                            className="sub-subscribe-btn"
                            onClick={currentView === 'perks' ? () => setCurrentView('payment') : handleNext}
                        >
                            <span className="sub-btn-text">Subscribe Now</span>
                            <Lottie
                                animationData={moneyAnimation}
                                loop={true}
                                className="sub-btn-lottie"
                            />
                        </Pressable>
                    )}
                </div>
            </div>

            {/* Terms & Conditions Drawer */}
            <div className={`sub-terms-overlay ${showTerms ? 'open' : ''}`} onClick={() => setShowTerms(false)} />
            <div className={`sub-terms-drawer ${showTerms ? 'open' : ''}`}>
                <div className="sub-terms-header">
                    <h3 className="sub-terms-title">Terms & Conditions</h3>
                    <Pressable className="sub-terms-close" onClick={() => setShowTerms(false)}>
                        <X size={20} />
                    </Pressable>
                </div>
                <div className="sub-terms-content">
                    <h4>Subscription Agreement</h4>
                    <p>By subscribing, you agree to the following terms:</p>

                    <h4>1. Recurring Payments</h4>
                    <p>Your subscription will automatically renew each month. You will be charged the subscription amount on the same day each month until you cancel.</p>

                    <h4>2. Cancellation Policy</h4>
                    <p>You may cancel your subscription at any time. Cancellation will take effect at the end of your current billing period. No refunds will be provided for partial months.</p>

                    <h4>3. Payment Processing</h4>
                    <p>Payments are securely processed through Stripe. Your payment information is encrypted and never stored on our servers.</p>

                    <h4>4. Content & Benefits</h4>
                    <p>Subscription benefits are provided at the discretion of the person you are subscribing to. Benefits may change over time.</p>

                    <h4>5. Privacy</h4>
                    <p>Your personal information will be handled in accordance with our Privacy Policy. We do not sell your data to third parties.</p>

                    <h4>6. Contact</h4>
                    <p>For questions about your subscription, please contact support@natepay.com</p>
                </div>
            </div>
        </div>
    )
}
