import { useNavigate, useLocation } from 'react-router-dom'
import { useCallback, useRef } from 'react'

type TransitionType = 'slide-left' | 'slide-right' | 'zoom-in' | 'zoom-out' | 'fade' | 'slide-up' | 'slide-down'

interface ViewTransitionOptions {
    type?: TransitionType
}

interface SharedElement {
    element: HTMLElement
    name: string
}

// Store active transition names for cleanup
const activeTransitionNames: Map<HTMLElement, string> = new Map()

/**
 * Hook that wraps React Router navigation with View Transitions API
 * Falls back to regular navigation if View Transitions not supported
 */
export function useViewTransition() {
    const routerNavigate = useNavigate()
    const location = useLocation()
    const lastPathRef = useRef(location.pathname)

    const transitionNavigate = useCallback((
        to: string | number,
        options?: ViewTransitionOptions
    ) => {
        const transitionType = options?.type || 'fade'

        // Set transition type as data attribute for CSS targeting
        document.documentElement.dataset.transition = transitionType

        // Check if View Transitions API is supported
        if ('startViewTransition' in document) {
            (document as any).startViewTransition(() => {
                if (typeof to === 'number') {
                    routerNavigate(to)
                } else {
                    routerNavigate(to)
                }
                lastPathRef.current = typeof to === 'string' ? to : location.pathname
            })
        } else {
            // Fallback for unsupported browsers
            if (typeof to === 'number') {
                routerNavigate(to)
            } else {
                routerNavigate(to)
            }
        }
    }, [routerNavigate, location.pathname])

    // goBack that can be used directly in onClick handlers
    const goBack = useCallback((optionsOrEvent?: ViewTransitionOptions | React.MouseEvent) => {
        // Check if it's an event (has preventDefault) or options
        const options = optionsOrEvent && 'type' in optionsOrEvent && typeof optionsOrEvent.type === 'string' && !('preventDefault' in optionsOrEvent)
            ? optionsOrEvent as ViewTransitionOptions
            : undefined
        transitionNavigate(-1, { type: options?.type || 'slide-right' })
    }, [transitionNavigate])

    const goTo = useCallback((path: string, options?: ViewTransitionOptions) => {
        // Auto-detect transition type based on navigation pattern
        const autoType = detectTransitionType(location.pathname, path)
        transitionNavigate(path, { type: options?.type || autoType })
    }, [transitionNavigate, location.pathname])

    /**
     * Navigate with shared element transitions (morphing)
     * Sets temporary view-transition-names on source elements,
     * which will morph into target elements with matching names
     */
    const navigateWithSharedElements = useCallback((
        to: string,
        sharedElements: SharedElement[],
        options?: ViewTransitionOptions
    ) => {
        // Set transition names on source elements
        sharedElements.forEach(({ element, name }) => {
            element.style.viewTransitionName = name
            activeTransitionNames.set(element, name)
        })

        const transitionType = options?.type || detectTransitionType(location.pathname, to)
        document.documentElement.dataset.transition = transitionType

        if ('startViewTransition' in document) {
            const transition = (document as any).startViewTransition(() => {
                routerNavigate(to)
                lastPathRef.current = to
            })

            // Clean up transition names after animation completes
            transition.finished.then(() => {
                cleanupTransitionNames()
            }).catch(() => {
                cleanupTransitionNames()
            })
        } else {
            routerNavigate(to)
            cleanupTransitionNames()
        }
    }, [routerNavigate, location.pathname])

    return {
        navigate: goTo,
        goBack,
        transitionNavigate,
        navigateWithSharedElements
    }
}

/**
 * Clean up all active transition names
 */
function cleanupTransitionNames() {
    activeTransitionNames.forEach((_name, element) => {
        if (element && element.style) {
            element.style.viewTransitionName = ''
        }
    })
    activeTransitionNames.clear()
}

/**
 * Detect appropriate transition type based on route patterns
 */
function detectTransitionType(from: string, to: string): TransitionType {
    // Tab navigation (dashboard, activity, subscribers, profile)
    const tabs = ['/dashboard', '/activity', '/subscribers', '/profile']
    const fromIsTab = tabs.some(t => from.startsWith(t) && from.split('/').length <= 2)
    const toIsTab = tabs.some(t => to.startsWith(t) && to.split('/').length <= 2)

    if (fromIsTab && toIsTab) {
        return 'fade' // Quick fade between tabs
    }

    // Going to detail page (list → detail)
    if (to.includes('/subscribers/') || to.includes('/activity/')) {
        return 'zoom-in'
    }

    // Coming back from detail
    if (from.includes('/subscribers/') || from.includes('/activity/')) {
        return 'zoom-out'
    }

    // Modal-like pages (settings, edit)
    if (to.includes('/settings') || to.includes('/edit')) {
        return 'slide-up'
    }

    // Default slide for forward navigation
    return 'slide-left'
}

export default useViewTransition
