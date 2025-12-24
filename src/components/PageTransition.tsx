import { useRef, useEffect, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import './PageTransition.css'

interface PageTransitionProps {
  children: ReactNode
}

/**
 * PageTransition - Smooth page transitions using View Transitions API
 *
 * Uses the native View Transitions API for smooth cross-fade animations
 * between route changes. Falls back gracefully on unsupported browsers.
 *
 * The animation style matches the Liquid Glass design system:
 * - Subtle fade with slight scale
 * - Spring-like easing
 * - Fast but perceptible (200ms)
 */
export function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation()
  const prevPathRef = useRef(location.pathname)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const currentPath = location.pathname
    const prevPath = prevPathRef.current

    // Skip animation on initial mount or same path
    if (prevPath === currentPath) return

    // Check if View Transitions API is available
    if ('startViewTransition' in document && document.startViewTransition) {
      // Use native View Transitions API
      // The CSS handles the actual animation
      document.startViewTransition(() => {
        prevPathRef.current = currentPath
      })
    } else {
      // Fallback: trigger CSS animation class
      const container = containerRef.current
      if (container) {
        container.classList.remove('page-enter')
        // Force reflow to restart animation
        void container.offsetWidth
        container.classList.add('page-enter')
      }
      prevPathRef.current = currentPath
    }
  }, [location.pathname])

  return (
    <div ref={containerRef} className="page-transition-container page-enter">
      {children}
    </div>
  )
}

export default PageTransition
