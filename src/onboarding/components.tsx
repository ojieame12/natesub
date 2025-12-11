// Re-exports shared components from main components
// This ensures onboarding uses the same design system

import { useState } from 'react'

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
}

export function Button({
    children,
    variant = 'primary',
    size = 'md',
    icon,
    fullWidth,
    disabled,
    onClick
}: ButtonProps) {
    const [pressed, setPressed] = useState(false)

    return (
        <button
            className={`btn btn-${variant} btn-${size} ${fullWidth ? 'btn-full' : ''} ${pressed ? 'pressed' : ''}`}
            onClick={disabled ? undefined : onClick}
            onMouseDown={() => !disabled && setPressed(true)}
            onMouseUp={() => setPressed(false)}
            onMouseLeave={() => setPressed(false)}
            onTouchStart={() => !disabled && setPressed(true)}
            onTouchEnd={() => setPressed(false)}
            disabled={disabled}
            style={{ opacity: disabled ? 0.5 : 1 }}
        >
            {icon && <span className="btn-icon">{icon}</span>}
            {children}
        </button>
    )
}
