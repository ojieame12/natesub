import { useNavigate } from 'react-router-dom'
import { useCallback } from 'react'

/**
 * Simplified navigation hook - NO View Transitions API
 *
 * The View Transitions API was causing flickering and glitchy behavior,
 * especially on iOS. This provides instant, clean navigation.
 */
export function useViewTransition(fallback = '/dashboard') {
    const routerNavigate = useNavigate()

    // Simple navigate - instant, no delays, no fancy transitions
    const navigate = useCallback((to: string | number) => {
        if (typeof to === 'number') {
            routerNavigate(to)
        } else {
            routerNavigate(to)
        }
    }, [routerNavigate])

    // Safe goBack - handles deep links by checking history
    // If there's no history (user opened link directly), navigates to fallback
    const goBack = useCallback(() => {
        // window.history.length > 2 because:
        // - 1 = blank page (initial)
        // - 2 = current page (direct link)
        // - 3+ = has previous pages
        if (window.history.length > 2) {
            routerNavigate(-1)
        } else {
            routerNavigate(fallback, { replace: true })
        }
    }, [routerNavigate, fallback])

    // Alias for compatibility
    const navigateWithSharedElements = useCallback((to: string) => {
        routerNavigate(to)
    }, [routerNavigate])

    return {
        navigate,
        goBack,
        transitionNavigate: navigate,
        navigateWithSharedElements
    }
}

export default useViewTransition
