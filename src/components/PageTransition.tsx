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
 * - Direction-aware: forward slides right-to-left, back slides left-to-right
 * - Subtle 12px movement with fade
 * - Spring-like easing
 * - Fast but perceptible (180ms)
 */
export function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation()
  const prevPathRef = useRef(location.pathname)
  const containerRef = useRef<HTMLDivElement>(null)
  const historyStack = useRef<string[]>([location.pathname])

  useEffect(() => {
    const currentPath = location.pathname
    const prevPath = prevPathRef.current

    // Skip animation on initial mount or same path
    if (prevPath === currentPath) return

    // Determine navigation direction
    const lastIndex = historyStack.current.lastIndexOf(currentPath)
    const isBack = lastIndex !== -1 && lastIndex < historyStack.current.length - 1

    // Update history stack
    if (isBack) {
      historyStack.current = historyStack.current.slice(0, lastIndex + 1)
    } else {
      historyStack.current.push(currentPath)
    }

    // Set direction attribute for CSS targeting
    document.documentElement.dataset.navDirection = isBack ? 'back' : 'forward'

    // Check if View Transitions API is available
    if ('startViewTransition' in document && document.startViewTransition) {
      // Use native View Transitions API
      // The CSS handles the actual animation based on data-nav-direction
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
