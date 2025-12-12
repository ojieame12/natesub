import { useState, useEffect, useRef, type RefObject } from 'react'

/**
 * Hook to track scroll position and return whether page is scrolled
 * Used for glass header shadow effects
 *
 * Listens to both container scroll and window scroll for pages that
 * scroll the window instead of an overflow container.
 */
export function useScrolled(threshold: number = 10): [RefObject<HTMLDivElement | null>, boolean] {
    const [isScrolled, setIsScrolled] = useState(false)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const container = containerRef.current

        const handleScroll = () => {
            // Check container scroll first, then window scroll
            const containerScrollTop = container?.scrollTop ?? 0
            const windowScrollTop = window.scrollY ?? window.pageYOffset ?? 0
            setIsScrolled(containerScrollTop > threshold || windowScrollTop > threshold)
        }

        // Listen to container scroll if available
        if (container) {
            container.addEventListener('scroll', handleScroll, { passive: true })
        }

        // Also listen to window scroll for pages that scroll the document
        window.addEventListener('scroll', handleScroll, { passive: true })

        // Check initial state
        handleScroll()

        return () => {
            if (container) {
                container.removeEventListener('scroll', handleScroll)
            }
            window.removeEventListener('scroll', handleScroll)
        }
    }, [threshold])

    return [containerRef, isScrolled]
}
