import { useState, useEffect, useRef, useCallback } from 'react'
import { Mail, RefreshCw } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button } from './components'
import '../Dashboard.css'
import './onboarding.css'

// Value propositions for the carousel - each with unique image from /public/images/
const VALUE_PROPS = [
    {
        headline: "Never chase\nanother invoice.",
        subtext: "Set it up once. Get paid every month. On autopilot.",
        image: "/images/New3.png"
    },
    {
        headline: "Get paid from\nanywhere in the world.",
        subtext: "Accept global subscriptions. We convert and deposit directly to your local bank.",
        image: "/images/Pizza.png"
    },
    {
        headline: "Everyone deserves\na payroll.",
        subtext: "Freelancers, creators, coaches — get the consistent income you've earned.",
        image: "/images/Sleeping.png"
    },
    {
        headline: "Turn any bank account\ninto a salary account.",
        subtext: "Get paid on schedule, every month, without the paperwork.",
        image: "/images/comixss.png"
    },
]

const ROTATION_INTERVAL = 4000 // 4 seconds per slide

export default function StartStep() {
    const nextStep = useOnboardingStore((s) => s.nextStep)
    const reset = useOnboardingStore((s) => s.reset)
    const email = useOnboardingStore((s) => s.email)
    const name = useOnboardingStore((s) => s.name)
    const [imageLoaded, setImageLoaded] = useState(false)
    const [activeIndex, setActiveIndex] = useState(0)
    const [isAnimating, setIsAnimating] = useState(false)
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const touchStartRef = useRef<number | null>(null)

    const hasExistingProgress = Boolean(email || name)

    // Start/restart auto-rotate timer
    const startAutoRotate = useCallback(() => {
        if (intervalRef.current) clearInterval(intervalRef.current)
        intervalRef.current = setInterval(() => {
            setIsAnimating(true)
            setTimeout(() => {
                setActiveIndex((prev) => (prev + 1) % VALUE_PROPS.length)
                setIsAnimating(false)
            }, 800)
        }, ROTATION_INTERVAL)
    }, [])

    // Auto-rotate carousel on mount
    useEffect(() => {
        startAutoRotate()
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current)
        }
    }, [startAutoRotate])

    // Navigate to specific slide
    const goToSlide = useCallback((index: number) => {
        if (isAnimating) return
        setIsAnimating(true)
        setTimeout(() => {
            setActiveIndex(index)
            setIsAnimating(false)
        }, 800)
        startAutoRotate() // Reset timer on manual navigation
    }, [isAnimating, startAutoRotate])

    // Swipe handlers
    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartRef.current = e.touches[0].clientX
    }

    const handleTouchEnd = (e: React.TouchEvent) => {
        if (touchStartRef.current === null) return
        const touchEnd = e.changedTouches[0].clientX
        const diff = touchStartRef.current - touchEnd
        const threshold = 50 // minimum swipe distance

        if (Math.abs(diff) > threshold) {
            if (diff > 0) {
                // Swipe left - next slide
                goToSlide((activeIndex + 1) % VALUE_PROPS.length)
            } else {
                // Swipe right - previous slide
                goToSlide((activeIndex - 1 + VALUE_PROPS.length) % VALUE_PROPS.length)
            }
        }
        touchStartRef.current = null
    }

    const handleStartOver = () => {
        reset()
        setTimeout(nextStep, 50)
    }

    const currentProp = VALUE_PROPS[activeIndex]

    return (
        <div className="onboarding">
            <div className="onboarding-logo-header">
                <img src="/logo.svg" alt="NatePay" />
            </div>
            <div className="onboarding-content">
                <div className="start-step">

                    {/* Hero Image - swipeable carousel */}
                    <div
                        className="start-hero"
                        onTouchStart={handleTouchStart}
                        onTouchEnd={handleTouchEnd}
                    >
                        {!imageLoaded && (
                            <div className="start-hero-placeholder" aria-hidden="true" />
                        )}
                        <img
                            src={currentProp.image}
                            alt="Hero"
                            className={`carousel-image ${isAnimating ? 'fade-out' : 'fade-in'}`}
                            onLoad={() => setImageLoaded(true)}
                        />
                    </div>

                    {/* Bottom section */}
                    <div className="start-bottom">
                        {/* Carousel Text */}
                        <div className="start-text">
                            <h1
                                className={`carousel-headline ${isAnimating ? 'fade-out' : 'fade-in'}`}
                                style={{ whiteSpace: 'pre-line' }}
                            >
                                {currentProp.headline}
                            </h1>
                            <p className={`carousel-subtext ${isAnimating ? 'fade-out' : 'fade-in'}`}>
                                {currentProp.subtext}
                            </p>
                        </div>

                        {/* Carousel Dots */}
                        <div className="carousel-dots">
                            {VALUE_PROPS.map((_, index) => (
                                <div
                                    key={index}
                                    className={`carousel-dot ${index === activeIndex ? 'active' : ''}`}
                                />
                            ))}
                        </div>

                        <div className="start-buttons">
                            <Button
                                variant="primary"
                                size="lg"
                                icon={<Mail size={20} />}
                                fullWidth
                                onClick={nextStep}
                            >
                                Continue with email
                            </Button>

                            {hasExistingProgress && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    icon={<RefreshCw size={16} />}
                                    onClick={handleStartOver}
                                >
                                    Start over
                                </Button>
                            )}
                        </div>

                        <p className="start-legal">
                            By continuing, you agree to our{' '}
                            <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>
                            {' '}and{' '}
                            <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    )
}
