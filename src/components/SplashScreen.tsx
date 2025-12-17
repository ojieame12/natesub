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
  const [showLoader, setShowLoader] = useState(false)

  useEffect(() => {
    // Fade in the loader after a tiny delay for smooth entrance
    const timer = setTimeout(() => setShowLoader(true), 150)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="splash-screen">
      <div className={`splash-loader ${showLoader ? 'visible' : ''}`}>
        <div className="splash-loader-bar" />
      </div>
    </div>
  )
}

export default SplashScreen
