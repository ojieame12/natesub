import { useNavigate } from 'react-router-dom'
import { Home, ArrowLeft, Compass } from 'lucide-react'
import { getAuthToken, hasAuthSession } from './api/client'
import { AmbientBackground } from './components/AmbientBackground'
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
            <AmbientBackground />

            <div className="not-found-content">
                {/* Floating illustration */}
                <div className="not-found-illustration">
                    <div className="not-found-compass">
                        <Compass size={48} strokeWidth={1.5} />
                    </div>
                    <div className="not-found-orbit">
                        <div className="orbit-dot" />
                        <div className="orbit-dot" />
                        <div className="orbit-dot" />
                    </div>
                </div>

                {/* Glassy 404 badge */}
                <div className="not-found-code">
                    <span className="code-digit">4</span>
                    <span className="code-digit zero">0</span>
                    <span className="code-digit">4</span>
                </div>

                <h1 className="not-found-title">Lost in space</h1>

                <p className="not-found-message">
                    The page you're looking for has drifted into the void.
                    <br />
                    Let's get you back on track.
                </p>

                <div className="not-found-actions">
                    <button
                        className="not-found-btn primary"
                        onClick={handleGoHome}
                    >
                        <Home size={18} />
                        <span>{isLoggedIn ? 'Go to Dashboard' : 'Go Home'}</span>
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
