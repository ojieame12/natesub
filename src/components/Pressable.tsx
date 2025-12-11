import { useState, type ReactNode, type CSSProperties } from 'react'

interface PressableProps {
    children: ReactNode
    className?: string
    onClick?: (e?: React.MouseEvent) => void
    disabled?: boolean
    style?: CSSProperties
}

/**
 * Pressable - A touch-friendly button component with press animation
 *
 * Uses the Liquid Glass design system press states:
 * - Scale down on press (0.92-0.98 depending on context)
 * - Smooth 0.1s transition
 * - Works with both mouse and touch events
 */
export default function Pressable({
    children,
    className = '',
    onClick,
    disabled = false,
    style,
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
        if (!disabled) setIsPressed(true)
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
