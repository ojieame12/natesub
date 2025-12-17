import { useState, useEffect, useRef, useCallback } from 'react'
import { Mail, RefreshCw } from 'lucide-react'
import { useOnboardingStore } from './store'
import { Button } from './components'
import { useReducedMotion } from '../hooks'
import '../Dashboard.css'
import './onboarding.css'

// Value propositions for the carousel - each with unique image from /public/images/
const VALUE_PROPS = [
    {
        headline: "Never chase\nanother invoice.",
        subtext: "Set it up once. Get paid every month. On autopilot.",
        image: "/images/New3-512.png"
    },
    {
        headline: "Get paid from\nanywhere in the world.",
        subtext: "Accept global subscriptions. We convert and deposit directly to your local bank.",
        image: "/images/Pizza-512.png"
    },
    {
        headline: "Everyone deserves\na payroll.",
        subtext: "Freelancers, creators, coaches — get the consistent income you've earned.",
        image: "/images/Sleeping-512.png"
    },
    {
        headline: "Turn any bank account\ninto a salary account.",
        subtext: "Get paid on schedule, every month, without the paperwork.",
        image: "/images/comixss-512.png"
    },
]

const ROTATION_INTERVAL = 4000 // 4 seconds per slide
const TRANSITION_MS = 350

export default function StartStep() {
    const nextStep = useOnboardingStore((s) => s.nextStep)
    const reset = useOnboardingStore((s) => s.reset)
    const email = useOnboardingStore((s) => s.email)
    const name = useOnboardingStore((s) => s.name)
    const prefersReducedMotion = useReducedMotion()
    const [activeIndex, setActiveIndex] = useState(0)
    const [isAnimating, setIsAnimating] = useState(false)
    const [loadedTick, setLoadedTick] = useState(0)
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
    const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const touchStartRef = useRef<number | null>(null)
    const activeIndexRef = useRef(0)
    const isAnimatingRef = useRef(false)
    const loadedImagesRef = useRef<Set<string>>(new Set())
    const preloadingRef = useRef<Set<string>>(new Set())

    const hasExistingProgress = Boolean(email || name)

    const markImageLoaded = useCallback((src: string) => {
        if (loadedImagesRef.current.has(src)) return
        loadedImagesRef.current.add(src)
        setLoadedTick((t) => t + 1)
    }, [])

    const preloadImage = useCallback((src: string) => {
        if (typeof window === 'undefined') return
        if (loadedImagesRef.current.has(src) || preloadingRef.current.has(src)) return

        preloadingRef.current.add(src)
        const img = new Image()
        img.decoding = 'async'
        img.onload = () => {
            preloadingRef.current.delete(src)
            markImageLoaded(src)
        }
        img.onerror = () => {
            preloadingRef.current.delete(src)
        }
        img.src = src
    }, [markImageLoaded])

    const endTransition = useCallback(() => {
        if (transitionTimeoutRef.current) {
            clearTimeout(transitionTimeoutRef.current)
            transitionTimeoutRef.current = null
        }
        isAnimatingRef.current = false
        setIsAnimating(false)
    }, [])

    // Start/restart auto-rotate timer
    const startAutoRotate = useCallback(() => {
        if (prefersReducedMotion) return
        if (intervalRef.current) clearInterval(intervalRef.current)
        intervalRef.current = setInterval(() => {
            // Don't advance while transitioning or while the current image hasn't loaded yet.
            const currentSrc = VALUE_PROPS[activeIndexRef.current]?.image
            if (!currentSrc || !loadedImagesRef.current.has(currentSrc)) return
            if (isAnimatingRef.current) return

            const nextIndex = (activeIndexRef.current + 1) % VALUE_PROPS.length
            const nextSrc = VALUE_PROPS[nextIndex]?.image
            if (!nextSrc) return

            // Preload ahead; only animate once the next image is ready.
            if (!loadedImagesRef.current.has(nextSrc)) {
                preloadImage(nextSrc)
                return
            }

            isAnimatingRef.current = true
            setIsAnimating(true)
            if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current)
            transitionTimeoutRef.current = setTimeout(() => {
                activeIndexRef.current = nextIndex
                setActiveIndex(nextIndex)
                endTransition()
            }, TRANSITION_MS)
        }, ROTATION_INTERVAL)
    }, [endTransition, prefersReducedMotion, preloadImage])

    // Auto-rotate carousel on mount
    useEffect(() => {
        startAutoRotate()
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current)
            if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current)
        }
    }, [startAutoRotate])

    // Keep refs in sync to avoid stale values inside timers.
    useEffect(() => {
        activeIndexRef.current = activeIndex
    }, [activeIndex])

    useEffect(() => {
        isAnimatingRef.current = isAnimating
    }, [isAnimating])

    // Navigate to specific slide
    const goToSlide = useCallback((index: number) => {
        if (index < 0 || index >= VALUE_PROPS.length) return
        if (isAnimating) return

        // If the target image hasn't loaded yet, preload it and switch immediately (no fade)
        // to avoid "fade to blank" jank on slow devices.
        const targetSrc = VALUE_PROPS[index]?.image
        if (targetSrc && !loadedImagesRef.current.has(targetSrc)) {
            preloadImage(targetSrc)
            activeIndexRef.current = index
            setActiveIndex(index)
            endTransition()
            startAutoRotate()
            return
        }

        if (prefersReducedMotion) {
            activeIndexRef.current = index
            setActiveIndex(index)
            endTransition()
            startAutoRotate()
            return
        }

        isAnimatingRef.current = true
        setIsAnimating(true)
        if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current)
        transitionTimeoutRef.current = setTimeout(() => {
            activeIndexRef.current = index
            setActiveIndex(index)
            endTransition()
        }, TRANSITION_MS)
        startAutoRotate() // Reset timer on manual navigation
    }, [endTransition, isAnimating, prefersReducedMotion, preloadImage, startAutoRotate])

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
    const currentImageLoaded = Boolean(currentProp?.image && loadedImagesRef.current.has(currentProp.image))

    // Preload the next slide once the current image is ready (reduces hitching on rotate).
    useEffect(() => {
        if (prefersReducedMotion) return
        if (!currentProp?.image) return
        if (!currentImageLoaded) return

        const nextIndex = (activeIndex + 1) % VALUE_PROPS.length
        const nextSrc = VALUE_PROPS[nextIndex]?.image
        if (nextSrc) preloadImage(nextSrc)
    }, [activeIndex, currentImageLoaded, currentProp?.image, loadedTick, prefersReducedMotion, preloadImage])

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
                        {!currentImageLoaded && (
                            <div className="start-hero-placeholder" aria-hidden="true" />
                        )}
                        <img
                            src={currentProp.image}
                            alt="Hero"
                            className={`carousel-image ${isAnimating ? 'fade-out' : 'fade-in'}`}
                            decoding="async"
                            fetchPriority="high"
                            onLoad={() => markImageLoaded(currentProp.image)}
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
