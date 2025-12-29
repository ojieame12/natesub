// Re-exports shared components from main components
// This ensures onboarding uses the same design system

import { useState, useCallback, useMemo, memo } from 'react'

// Re-export Pressable from shared components
export { default as Pressable } from '../components/Pressable'

// Button component - same as Dashboard
interface ButtonProps {
    children: React.ReactNode
    variant?: 'primary' | 'secondary' | 'ghost'
    size?: 'sm' | 'md' | 'lg'
    icon?: React.ReactNode
    fullWidth?: boolean
    disabled?: boolean
    onClick?: () => void
    className?: string
    style?: React.CSSProperties
}

export const Button = memo(function Button({
    children,
    variant = 'primary',
    size = 'md',
    icon,
    fullWidth,
    disabled,
    onClick,
    className: extraClassName,
    style: extraStyle
}: ButtonProps) {
    const [pressed, setPressed] = useState(false)

    const handleMouseDown = useCallback(() => {
        if (!disabled) setPressed(true)
    }, [disabled])

    const handleMouseUp = useCallback(() => setPressed(false), [])
    const handleMouseLeave = useCallback(() => setPressed(false), [])

    const handleTouchStart = useCallback(() => {
        if (!disabled) setPressed(true)
    }, [disabled])

    const handleTouchEnd = useCallback(() => setPressed(false), [])

    const handleClick = useCallback(() => {
        if (!disabled && onClick) onClick()
    }, [disabled, onClick])

    const className = useMemo(() => {
        const classes = ['btn', `btn-${variant}`, `btn-${size}`]
        if (fullWidth) classes.push('btn-full')
        if (pressed) classes.push('pressed')
        if (extraClassName) classes.push(extraClassName)
        return classes.join(' ')
    }, [variant, size, fullWidth, pressed, extraClassName])

    const style = useMemo(() => ({
        opacity: disabled ? 0.5 : 1,
        ...extraStyle
    }), [disabled, extraStyle])

    return (
        <button
            className={className}
            onClick={handleClick}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            disabled={disabled}
            style={style}
        >
            {icon && <span className="btn-icon">{icon}</span>}
            {children}
        </button>
    )
})
