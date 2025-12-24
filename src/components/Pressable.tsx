import { useState, memo, useCallback, useMemo, type ReactNode, type CSSProperties } from 'react'

interface PressableProps {
    children: ReactNode
    className?: string
    onClick?: (e?: React.MouseEvent) => void
    onMouseEnter?: () => void
    onTouchStart?: () => void
    disabled?: boolean
    style?: CSSProperties
    /** Haptic feedback intensity: 'light' | 'medium' | 'heavy' | 'none' */
    haptic?: 'light' | 'medium' | 'heavy' | 'none'
}

// Check if running in native Capacitor environment
const isNative = typeof window !== 'undefined' &&
    window.Capacitor?.isNativePlatform?.() === true

// Lazy-loaded haptics module (only loads on native platforms)
let hapticsModule: typeof import('@capacitor/haptics') | null = null

// Debounce haptics - prevent multiple triggers within 50ms
let lastHapticTime = 0
const HAPTIC_DEBOUNCE_MS = 50

// Trigger haptic feedback (works on iOS/Android via Capacitor)
const triggerHaptic = async (style: 'light' | 'medium' | 'heavy') => {
    // Skip on web - don't even load the module
    if (!isNative) return

    // Debounce - prevent rapid haptic triggers
    const now = Date.now()
    if (now - lastHapticTime < HAPTIC_DEBOUNCE_MS) return
    lastHapticTime = now

    try {
        // Lazy load haptics module on first use
        if (!hapticsModule) {
            hapticsModule = await import('@capacitor/haptics')
        }

        const { Haptics, ImpactStyle } = hapticsModule
        const impactStyle = {
            light: ImpactStyle.Light,
            medium: ImpactStyle.Medium,
            heavy: ImpactStyle.Heavy,
        }[style]
        await Haptics.impact({ style: impactStyle })
    } catch {
        // Haptics not available - fail silently
    }
}

// Base styles - defined outside component to prevent recreation
// Note: transition is handled by CSS (.pressable class in index.css) using design system variables
const baseStyles: CSSProperties = {}

/**
 * Pressable - A touch-friendly button component with press animation
 *
 * Uses the Liquid Glass design system press states:
 * - Scale down on press (0.92-0.98 depending on context)
 * - Smooth 0.1s transition
 * - Works with both mouse and touch events
 * - Haptic feedback on touch (iOS/Android)
 *
 * Wrapped in React.memo to prevent unnecessary re-renders when parent updates
 */
const Pressable = memo(function Pressable({
    children,
    className = '',
    onClick,
    onMouseEnter,
    onTouchStart: onTouchStartProp,
    disabled = false,
    style,
    haptic = 'light',
}: PressableProps) {
    const [isPressed, setIsPressed] = useState(false)

    const handleMouseDown = useCallback(() => {
        if (!disabled) setIsPressed(true)
    }, [disabled])

    const handleMouseUp = useCallback(() => {
        setIsPressed(false)
    }, [])

    const handleMouseLeave = useCallback(() => {
        setIsPressed(false)
    }, [])

    const handleTouchStart = useCallback(() => {
        if (!disabled) {
            setIsPressed(true)
            // Trigger haptic feedback on touch (debounced)
            if (haptic !== 'none') {
                triggerHaptic(haptic)
            }
            // Call custom handler if provided
            onTouchStartProp?.()
        }
    }, [disabled, haptic, onTouchStartProp])

    const handleTouchEnd = useCallback(() => {
        setIsPressed(false)
    }, [])

    const handleClick = useCallback((e: React.MouseEvent) => {
        if (!disabled && onClick) {
            onClick(e)
        }
    }, [disabled, onClick])

    // Keyboard accessibility - activate on Enter or Space
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setIsPressed(true)
            if (haptic !== 'none') {
                triggerHaptic(haptic)
            }
            onClick?.()
        }
    }, [disabled, haptic, onClick])

    const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            setIsPressed(false)
        }
    }, [])

    // Memoize combined styles
    const combinedStyle = useMemo(() => ({
        ...baseStyles,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...style,
    }), [disabled, style])

    // Memoize className to avoid string recreation
    // Always include 'pressable' base class for CSS transitions (var(--ease-spring))
    const combinedClassName = useMemo(() => {
        const classes = ['pressable', className]
        if (isPressed) classes.push('pressed')
        if (disabled) classes.push('disabled')
        return classes.filter(Boolean).join(' ')
    }, [className, isPressed, disabled])

    return (
        <div
            className={combinedClassName}
            onClick={handleClick}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onMouseEnter={onMouseEnter}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            style={combinedStyle}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
        >
            {children}
        </div>
    )
})

export default Pressable
