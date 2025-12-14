import { useNavigate } from 'react-router-dom'
import { Home, ArrowLeft } from 'lucide-react'
import { getAuthToken, hasAuthSession } from './api/client'
import './NotFound.css'

export default function NotFound() {
    const navigate = useNavigate()
    const isLoggedIn = !!getAuthToken() || hasAuthSession()

    const handleGoHome = () => {
        navigate(isLoggedIn ? '/dashboard' : '/onboarding', { replace: true })
    }

    const handleGoBack = () => {
        navigate(-1)
    }

    return (
        <div className="not-found-page">
            <div className="not-found-content">
                <div className="not-found-code">404</div>

                <h1 className="not-found-title">Page not found</h1>

                <p className="not-found-message">
                    The page you're looking for doesn't exist or has been moved.
                </p>

                <div className="not-found-actions">
                    <button
                        className="not-found-btn primary"
                        onClick={handleGoHome}
                    >
                        <Home size={18} />
                        <span>{isLoggedIn ? 'Go to Dashboard' : 'Go to Home'}</span>
                    </button>

                    <button
                        className="not-found-btn secondary"
                        onClick={handleGoBack}
                    >
                        <ArrowLeft size={18} />
                        <span>Go Back</span>
                    </button>
                </div>
            </div>
        </div>
    )
}
