import { useEffect, useState } from 'react'
import './SplashScreen.css'

/**
 * SplashScreen - Branded loading screen shown during initial auth check
 *
 * Uses "Deterministic Solidity" principle:
 * - Shows immediately on app launch
 * - Stays visible until auth state is confirmed
 * - Prevents flickering between states
 */
export function SplashScreen() {
  const [showLogo, setShowLogo] = useState(false)

  useEffect(() => {
    // Fade in the logo after a tiny delay for smooth entrance
    const timer = setTimeout(() => setShowLogo(true), 50)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="splash-screen">
      <div className="splash-content">
        {/* Logo/Brand Mark */}
        <div className={`splash-logo ${showLogo ? 'visible' : ''}`}>
          <div className="splash-logo-mark">
            <svg
              viewBox="0 0 40 40"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="splash-logo-svg"
            >
              {/* N letter mark */}
              <path
                d="M10 30V10L20 25L30 10V30"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </div>
        </div>

        {/* Loading indicator */}
        <div className={`splash-loader ${showLogo ? 'visible' : ''}`}>
          <div className="splash-loader-bar" />
        </div>
      </div>
    </div>
  )
}

export default SplashScreen
