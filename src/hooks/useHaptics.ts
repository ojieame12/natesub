import { useCallback } from 'react'
import {
    triggerImpact,
    triggerNotification,
    triggerSelection,
    type ImpactStyle,
    type NotificationStyle,
} from '../utils/haptics'

/**
 * React hook for haptic feedback in components
 * Uses the shared haptics utility for native platform detection and debouncing
 */
export function useHaptics() {
    const impact = useCallback((style: ImpactStyle = 'light') => {
        return triggerImpact(style)
    }, [])

    const notification = useCallback((type: NotificationStyle) => {
        return triggerNotification(type)
    }, [])

    const selection = useCallback(() => {
        return triggerSelection()
    }, [])

    // Semantic helpers
    const success = useCallback(() => triggerNotification('success'), [])
    const error = useCallback(() => triggerNotification('error'), [])
    const warning = useCallback(() => triggerNotification('warning'), [])

    return {
        impact,
        notification,
        selection,
        success,
        error,
        warning
    }
}
