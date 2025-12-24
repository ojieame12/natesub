import { Component, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'
import './ErrorBoundary.css'

interface Props {
    children: ReactNode
}

interface State {
    hasError: boolean
    error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props)
        this.state = { hasError: false, error: null }
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error }
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        // Log to console in development
        console.error('ErrorBoundary caught an error:', error, errorInfo)

        // In production, you could send this to an error reporting service
        // e.g., Sentry, LogRocket, etc.
    }

    handleReload = () => {
        window.location.reload()
    }

    handleGoHome = () => {
        // Reset error state to re-enable rendering
        this.setState({ hasError: false, error: null })
        // Navigate using History API to avoid full reload (which shows splash)
        window.history.pushState({}, '', '/dashboard')
        // Dispatch popstate to trigger React Router navigation
        window.dispatchEvent(new PopStateEvent('popstate'))
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="error-boundary">
                    <div className="error-boundary-content">
                        <div className="error-boundary-icon">
                            <AlertTriangle size={32} />
                        </div>

                        <h1 className="error-boundary-title">Something went wrong</h1>

                        <p className="error-boundary-message">
                            We're sorry, but something unexpected happened.
                            Please try refreshing the page.
                        </p>

                        <div className="error-boundary-actions">
                            <button
                                className="error-boundary-btn primary"
                                onClick={this.handleReload}
                            >
                                <RefreshCw size={18} />
                                <span>Refresh Page</span>
                            </button>

                            <button
                                className="error-boundary-btn secondary"
                                onClick={this.handleGoHome}
                            >
                                <Home size={18} />
                                <span>Go to Dashboard</span>
                            </button>
                        </div>

                        {import.meta.env.DEV && this.state.error && (
                            <details className="error-boundary-details">
                                <summary>Error Details</summary>
                                <pre>{this.state.error.message}</pre>
                                <pre>{this.state.error.stack}</pre>
                            </details>
                        )}
                    </div>
                </div>
            )
        }

        return this.props.children
    }
}

export default ErrorBoundary
