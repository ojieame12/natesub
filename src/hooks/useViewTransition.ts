import { useNavigate } from 'react-router-dom'
import { useCallback } from 'react'

/**
 * Simplified navigation hook - NO View Transitions API
 *
 * The View Transitions API was causing flickering and glitchy behavior,
 * especially on iOS. This provides instant, clean navigation.
 */
export function useViewTransition() {
    const routerNavigate = useNavigate()

    // Simple navigate - instant, no delays, no fancy transitions
    const navigate = useCallback((to: string | number) => {
        if (typeof to === 'number') {
            routerNavigate(to)
        } else {
            routerNavigate(to)
        }
    }, [routerNavigate])

    // goBack that can be used directly in onClick handlers
    const goBack = useCallback(() => {
        routerNavigate(-1)
    }, [routerNavigate])

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
