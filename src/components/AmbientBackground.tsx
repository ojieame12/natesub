import { memo } from 'react'
import './AmbientBackground.css'

interface AmbientBackgroundProps {
    /** Optional specific color to tints the aura (e.g., from user profile) */
    accentColor?: string
}

/**
 * AmbientBackground
 * 
 * Renders a subtle, moving gradient mesh behind the application content.
 * This creates the "Liquid Glass" atmosphere.
 * 
 * - Uses hardware-accelerated CSS animations
 * - Low opacity for subtlety
 * - Persists across route transitions when placed in AppLayout
 */
export const AmbientBackground = memo(function AmbientBackground({ accentColor }: AmbientBackgroundProps) {
    const style = accentColor ? { '--accent-color': accentColor } as React.CSSProperties : undefined

    return (
        <div className="ambient-background" style={style}>
            <div className="ambient-orb orb-1" />
            <div className="ambient-orb orb-2" />
            <div className="ambient-orb orb-3" />
            <div className="ambient-overlay" />
        </div>
    )
})
