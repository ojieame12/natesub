import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

// Store scroll positions by full location key (pathname + search + hash)
const scrollPositions = new Map<string, number>()

/**
 * ScrollRestoration - Smart scroll behavior for navigation
 *
 * - Forward navigation (PUSH): Scrolls to top
 * - Back navigation (POP): Restores previous scroll position
 * - Replace navigation: Scrolls to top
 *
 * Works with view transitions by delaying scroll until after transition
 * Uses full location key (pathname + search + hash) to handle query-based pages
 */
export function ScrollRestoration() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const prevKeyRef = useRef<string>('')

  // Create unique key from pathname + search + hash
  const locationKey = `${location.pathname}${location.search}${location.hash}`

  useEffect(() => {
    // Save scroll position of previous page before navigating away
    if (prevKeyRef.current && prevKeyRef.current !== locationKey) {
      scrollPositions.set(prevKeyRef.current, window.scrollY)
    }

    // Determine scroll behavior based on navigation type
    const handleScroll = () => {
      if (navigationType === 'POP') {
        // Back/forward navigation - restore position
        const savedPosition = scrollPositions.get(locationKey)
        if (savedPosition !== undefined) {
          window.scrollTo(0, savedPosition)
        }
      } else {
        // PUSH or REPLACE - scroll to top
        window.scrollTo(0, 0)
      }
    }

    // Check if view transitions are active
    // @ts-expect-error - View Transitions API
    if (document.startViewTransition) {
      // Wait for view transition to complete before scrolling
      // This prevents janky scroll during transition
      requestAnimationFrame(() => {
        requestAnimationFrame(handleScroll)
      })
    } else {
      handleScroll()
    }

    prevKeyRef.current = locationKey
  }, [locationKey, navigationType])

  // Cleanup old entries to prevent memory leaks
  useEffect(() => {
    const cleanup = () => {
      if (scrollPositions.size > 50) {
        const entries = Array.from(scrollPositions.entries())
        entries.slice(0, 25).forEach(([key]) => scrollPositions.delete(key))
      }
    }
    cleanup()
  }, [locationKey])

  return null
}

export default ScrollRestoration
