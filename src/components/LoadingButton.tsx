import { useState, type ReactNode, type CSSProperties } from 'react'
import Spinner from './Spinner'
import { triggerImpact, type ImpactStyle } from '../utils/haptics'

interface LoadingButtonProps {
    children: ReactNode
    className?: string
    onClick?: () => void | Promise<void>
    disabled?: boolean
    loading?: boolean
    style?: CSSProperties
    /** Haptic feedback intensity */
    haptic?: ImpactStyle | 'none'
    /** Button variant for styling */
    variant?: 'primary' | 'secondary' | 'ghost'
    /** Full width */
    fullWidth?: boolean
}

/**
 * LoadingButton - A button that handles loading states without layout shift
 *
 * Key features:
 * - Fixed width during loading (no layout shift)
 * - Smooth transition between content and spinner
 * - Haptic feedback on press
 * - Supports async onClick handlers
 */
export function LoadingButton({
    children,
    className = '',
    onClick,
    disabled = false,
    loading = false,
    style,
    haptic = 'light',
    variant = 'primary',
    fullWidth = false,
}: LoadingButtonProps) {
    const [isPressed, setIsPressed] = useState(false)
    const [internalLoading, setInternalLoading] = useState(false)

    const isLoading = loading || internalLoading
    const isDisabled = disabled || isLoading

    const handleClick = async () => {
        if (isDisabled || !onClick) return

        // If onClick returns a promise, show loading state
        const result = onClick()
        if (result instanceof Promise) {
            setInternalLoading(true)
            try {
                await result
            } finally {
                setInternalLoading(false)
            }
        }
    }

    const handleTouchStart = () => {
        if (!isDisabled) {
            setIsPressed(true)
            if (haptic !== 'none') {
                triggerImpact(haptic)
            }
        }
    }

    const variantClasses = {
        primary: 'loading-btn-primary',
        secondary: 'loading-btn-secondary',
        ghost: 'loading-btn-ghost',
    }

    return (
        <button
            className={`loading-btn ${variantClasses[variant]} ${className} ${isPressed ? 'pressed' : ''} ${isLoading ? 'loading' : ''} ${fullWidth ? 'full-width' : ''}`}
            onClick={handleClick}
            onMouseDown={() => !isDisabled && setIsPressed(true)}
            onMouseUp={() => setIsPressed(false)}
            onMouseLeave={() => setIsPressed(false)}
            onTouchStart={handleTouchStart}
            onTouchEnd={() => setIsPressed(false)}
            disabled={isDisabled}
            style={style}
        >
            <span className="loading-btn-content" style={{ opacity: isLoading ? 0 : 1 }}>
                {children}
            </span>
            <span className="loading-btn-spinner" style={{ opacity: isLoading ? 1 : 0 }}>
                <Spinner size="sm" color={variant === 'primary' ? 'white' : 'primary'} />
            </span>
        </button>
    )
}
