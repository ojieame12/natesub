import { useState } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import './ErrorState.css'

interface ErrorStateProps {
    title?: string
    message?: string
    onRetry?: () => void
    compact?: boolean
}

export default function ErrorState({
    title = 'Something went wrong',
    message = 'We couldn\'t load this content. Please try again.',
    onRetry,
    compact = false,
}: ErrorStateProps) {
    const [isRetrying, setIsRetrying] = useState(false)

    const handleRetry = async () => {
        if (!onRetry) return
        setIsRetrying(true)
        try {
            await onRetry()
        } finally {
            setIsRetrying(false)
        }
    }

    if (compact) {
        return (
            <div className="error-state-compact">
                <AlertCircle size={18} />
                <span>{message}</span>
                {onRetry && (
                    <button
                        className="error-retry-inline"
                        onClick={handleRetry}
                        disabled={isRetrying}
                    >
                        {isRetrying ? 'Retrying...' : 'Retry'}
                    </button>
                )}
            </div>
        )
    }

    return (
        <div className="error-state">
            <div className="error-icon">
                <AlertCircle size={32} />
            </div>
            <h3 className="error-title">{title}</h3>
            <p className="error-message">{message}</p>
            {onRetry && (
                <button
                    className="error-retry-btn"
                    onClick={handleRetry}
                    disabled={isRetrying}
                >
                    <RefreshCw size={18} className={isRetrying ? 'spinning' : ''} />
                    <span>{isRetrying ? 'Retrying...' : 'Try Again'}</span>
                </button>
            )}
        </div>
    )
}
