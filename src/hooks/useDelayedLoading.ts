import { useState, useEffect } from 'react'
import { useIsRestoring } from '../api/provider'

/**
 * useDelayedLoading - Prevent skeleton flash on fast requests and cache restoration
 *
 * Returns true only after `delay` ms of loading, preventing the jarring
 * "flash of skeleton" on fast network requests. Also suppresses skeletons
 * while the persisted cache is being restored (hydration).
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
  const isRestoring = useIsRestoring()

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // Never show skeleton while cache is restoring (hydration in progress)
    if (isRestoring) {
      setShowSkeleton(false)
      return
    }

    if (!isLoading) {
      setShowSkeleton(false)
      return
    }

    // Start timer when loading begins
    const timer = setTimeout(() => {
      setShowSkeleton(true)
    }, delay)

    return () => clearTimeout(timer)
  }, [isLoading, isRestoring, delay])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Never show skeleton during restoration
  return showSkeleton && !isRestoring
}

export default useDelayedLoading
