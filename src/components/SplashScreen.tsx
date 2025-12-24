import './SplashScreen.css'

interface SplashScreenProps {
  /** When true, plays exit animation before unmount */
  exiting?: boolean
}

/**
 * SplashScreen - Branded loading screen shown during initial auth check
 *
 * Uses "Deterministic Solidity" principle:
 * - Shows immediately on app launch (no delay)
 * - Stays visible until auth state is confirmed
 * - Prevents flickering between states
 * - Smooth exit animation when leaving
 */
export function SplashScreen({ exiting = false }: SplashScreenProps) {
  // Show loader immediately - no delay prevents glitchy rapid sequence
  return (
    <div className={`splash-screen ${exiting ? 'exiting' : ''}`}>
      <div className="splash-loader visible">
        <div className="splash-loader-bar" />
      </div>
    </div>
  )
}

export default SplashScreen
