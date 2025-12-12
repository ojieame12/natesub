import { useState, type ReactNode, type CSSProperties } from 'react'

interface PressableProps {
    children: ReactNode
    className?: string
    onClick?: (e?: React.MouseEvent) => void
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

// Trigger haptic feedback (works on iOS/Android via Capacitor)
const triggerHaptic = async (style: 'light' | 'medium' | 'heavy') => {
    // Skip on web - don't even load the module
    if (!isNative) return

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

/**
 * Pressable - A touch-friendly button component with press animation
 *
 * Uses the Liquid Glass design system press states:
 * - Scale down on press (0.92-0.98 depending on context)
 * - Smooth 0.1s transition
 * - Works with both mouse and touch events
 * - Haptic feedback on touch (iOS/Android)
 */
export default function Pressable({
    children,
    className = '',
    onClick,
    disabled = false,
    style,
    haptic = 'light',
}: PressableProps) {
    const [isPressed, setIsPressed] = useState(false)

    const handleMouseDown = () => {
        if (!disabled) setIsPressed(true)
    }

    const handleMouseUp = () => {
        setIsPressed(false)
    }

    const handleMouseLeave = () => {
        setIsPressed(false)
    }

    const handleTouchStart = () => {
        if (!disabled) {
            setIsPressed(true)
            // Trigger haptic feedback on touch
            if (haptic !== 'none') {
                triggerHaptic(haptic)
            }
        }
    }

    const handleTouchEnd = () => {
        setIsPressed(false)
    }

    const handleClick = (e: React.MouseEvent) => {
        if (!disabled && onClick) {
            onClick(e)
        }
    }

    return (
        <div
            className={`${className} ${isPressed ? 'pressed' : ''} ${disabled ? 'disabled' : ''}`}
            onClick={handleClick}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            style={{
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
                transition: 'transform 0.1s ease, opacity 0.15s ease',
                ...style,
            }}
            role="button"
            tabIndex={disabled ? -1 : 0}
            aria-disabled={disabled}
        >
            {children}
        </div>
    )
}
