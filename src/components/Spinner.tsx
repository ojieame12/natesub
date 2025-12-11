import './Spinner.css'

interface SpinnerProps {
    size?: 'sm' | 'md' | 'lg'
    color?: 'primary' | 'white' | 'secondary'
    className?: string
}

/**
 * Spinner - A loading indicator using the Liquid Glass design system
 */
export default function Spinner({
    size = 'md',
    color = 'primary',
    className = '',
}: SpinnerProps) {
    return (
        <div className={`spinner spinner-${size} spinner-${color} ${className}`}>
            <div className="spinner-circle" />
        </div>
    )
}

interface LoadingScreenProps {
    message?: string
}

/**
 * LoadingScreen - Full page loading indicator
 */
export function LoadingScreen({ message }: LoadingScreenProps) {
    return (
        <div className="loading-screen">
            <Spinner size="lg" />
            {message && <p className="loading-message">{message}</p>}
        </div>
    )
}

interface LoadingOverlayProps {
    visible: boolean
    message?: string
}

/**
 * LoadingOverlay - Overlay loading indicator for async operations
 */
export function LoadingOverlay({ visible, message }: LoadingOverlayProps) {
    if (!visible) return null

    return (
        <div className="loading-overlay">
            <div className="loading-overlay-content">
                <Spinner size="lg" color="white" />
                {message && <p className="loading-overlay-message">{message}</p>}
            </div>
        </div>
    )
}
