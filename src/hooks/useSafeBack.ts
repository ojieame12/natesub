import { useNavigate } from 'react-router-dom'
import { useCallback } from 'react'

/**
 * Safe back navigation that handles deep links.
 * If there's no history (user opened link directly), navigates to fallback instead.
 */
export function useSafeBack(fallback = '/dashboard') {
  const navigate = useNavigate()

  const goBack = useCallback(() => {
    // Check if there's history to go back to
    // window.history.length > 2 because:
    // - 1 = blank page (initial)
    // - 2 = current page (direct link)
    // - 3+ = has previous pages
    if (window.history.length > 2) {
      navigate(-1)
    } else {
      navigate(fallback, { replace: true })
    }
  }, [navigate, fallback])

  return goBack
}
