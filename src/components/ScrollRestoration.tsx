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
 * Targets the .app-content container (which has overflow-y: auto)
 * rather than window, since that's where actual scrolling happens.
 * Uses full location key (pathname + search + hash) to handle query-based pages
 */
export function ScrollRestoration() {
  const location = useLocation()
  const navigationType = useNavigationType()
  const prevKeyRef = useRef<string>('')

  // Create unique key from pathname + search + hash
  const locationKey = `${location.pathname}${location.search}${location.hash}`

  useEffect(() => {
    // Target .app-content container (has overflow-y: auto), fallback to window
    const scrollContainer = document.querySelector('.app-content') as HTMLElement | null

    // Save scroll position of previous page before navigating away
    if (prevKeyRef.current && prevKeyRef.current !== locationKey) {
      const currentScroll = scrollContainer?.scrollTop ?? window.scrollY
      scrollPositions.set(prevKeyRef.current, currentScroll)
    }

    // Determine scroll behavior based on navigation type
    const handleScroll = () => {
      if (navigationType === 'POP') {
        // Back/forward navigation - restore position
        const savedPosition = scrollPositions.get(locationKey)
        if (savedPosition !== undefined) {
          if (scrollContainer) {
            scrollContainer.scrollTop = savedPosition
          } else {
            window.scrollTo(0, savedPosition)
          }
        }
      } else {
        // PUSH or REPLACE - scroll to top
        if (scrollContainer) {
          scrollContainer.scrollTop = 0
        } else {
          window.scrollTo(0, 0)
        }
      }
    }

    // Execute scroll immediately (view transitions disabled due to iOS flickering)
    handleScroll()

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
