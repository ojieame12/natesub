import { useCallback } from 'react'

// Check if running in native Capacitor environment
const isNative = typeof window !== 'undefined' &&
    window.Capacitor?.isNativePlatform?.() === true

// Lazy-loaded haptics module
let hapticsModule: typeof import('@capacitor/haptics') | null = null

export function useHaptics() {
    /**
     * Trigger a haptic impact
     * @param style 'light' | 'medium' | 'heavy'
     */
    const impact = useCallback(async (style: 'light' | 'medium' | 'heavy' = 'light') => {
        if (!isNative) return

        try {
            if (!hapticsModule) {
                hapticsModule = await import('@capacitor/haptics')
            }
            const { Haptics, ImpactStyle } = hapticsModule

            const impactStyle = {
                light: ImpactStyle.Light,
                medium: ImpactStyle.Medium,
                heavy: ImpactStyle.Heavy,
            }[style]

            await Haptics.impact({ style: impactStyle })
        } catch {
            // Fail silently
        }
    }, [])

    /**
     * Trigger a notification haptic (success, warning, error)
     * @param type 'success' | 'warning' | 'error'
     */
    const notification = useCallback(async (type: 'success' | 'warning' | 'error') => {
        if (!isNative) return

        try {
            if (!hapticsModule) {
                hapticsModule = await import('@capacitor/haptics')
            }
            const { Haptics, NotificationType } = hapticsModule

            const notificationType = {
                success: NotificationType.Success,
                warning: NotificationType.Warning,
                error: NotificationType.Error,
            }[type]

            await Haptics.notification({ type: notificationType })
        } catch {
            // Fail silently
        }
    }, [])

    /**
     * Trigger a selection change haptic (very light)
     */
    const selection = useCallback(async () => {
        if (!isNative) return

        try {
            if (!hapticsModule) {
                hapticsModule = await import('@capacitor/haptics')
            }
            const { Haptics } = hapticsModule
            await Haptics.selectionStart()
            await Haptics.selectionChanged()
            await Haptics.selectionEnd()
        } catch {
            // Fail silently
        }
    }, [])

    // Semantic helpers
    const success = useCallback(() => notification('success'), [notification])
    const error = useCallback(() => notification('error'), [notification])
    const warning = useCallback(() => notification('warning'), [notification])

    return {
        impact,
        notification,
        selection,
        success,
        error,
        warning
    }
}
