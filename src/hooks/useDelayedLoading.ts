import { useState, useEffect } from 'react'

/**
 * useDelayedLoading - Prevent skeleton flash on fast requests
 *
 * Returns true only after `delay` ms of loading, preventing the jarring
 * "flash of skeleton" on fast network requests. Pairs well with React Query's
 * staleTime and keepPreviousData for a smoother UX.
 *
 * Usage:
 * ```tsx
 * const { data, isLoading } = useQuery(...)
 * const showSkeleton = useDelayedLoading(isLoading, 200)
 *
 * if (showSkeleton) return <Skeleton />
 * if (!data) return <Empty />
 * return <Content data={data} />
 * ```
 *
 * @param isLoading - The actual loading state from React Query
 * @param delay - Milliseconds to wait before showing skeleton (default: 200ms)
 * @returns boolean - Whether to show the skeleton
 */
export function useDelayedLoading(isLoading: boolean, delay = 200): boolean {
  const [showSkeleton, setShowSkeleton] = useState(false)

  useEffect(() => {
    if (!isLoading) {
      setShowSkeleton(false)
      return
    }

    // Start timer when loading begins
    const timer = setTimeout(() => {
      setShowSkeleton(true)
    }, delay)

    return () => clearTimeout(timer)
  }, [isLoading, delay])

  return showSkeleton
}

export default useDelayedLoading
