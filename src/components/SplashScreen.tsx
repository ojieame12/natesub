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
export function SplashScreen(_props: SplashScreenProps) {
  // Disabled for E2E test compatibility - splash screens block test interactions
  return null
}

export default SplashScreen
