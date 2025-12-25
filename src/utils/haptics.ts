// Shared haptics utility - centralized haptic feedback for native apps
// Used by: useHaptics hook, Pressable, LoadingButton

// Check if running in native Capacitor environment (singleton)
export const isNative = typeof window !== 'undefined' &&
    window.Capacitor?.isNativePlatform?.() === true

// Lazy-loaded haptics module (singleton - shared across all consumers)
let hapticsModule: typeof import('@capacitor/haptics') | null = null

// Debounce state for impact haptics
let lastHapticTime = 0
const HAPTIC_DEBOUNCE_MS = 50

/**
 * Load haptics module lazily (only on native platforms)
 * Returns null on web to avoid loading Capacitor code
 */
async function getHapticsModule() {
    if (!isNative) return null
    if (!hapticsModule) {
        hapticsModule = await import('@capacitor/haptics')
    }
    return hapticsModule
}

export type ImpactStyle = 'light' | 'medium' | 'heavy'
export type NotificationStyle = 'success' | 'warning' | 'error'

/**
 * Trigger a haptic impact (debounced to prevent rapid triggers)
 * @param style 'light' | 'medium' | 'heavy'
 */
export async function triggerImpact(style: ImpactStyle = 'light'): Promise<void> {
    if (!isNative) return

    // Debounce - prevent rapid haptic triggers
    const now = Date.now()
    if (now - lastHapticTime < HAPTIC_DEBOUNCE_MS) return
    lastHapticTime = now

    try {
        const mod = await getHapticsModule()
        if (!mod) return

        const { Haptics, ImpactStyle } = mod
        const impactStyle = {
            light: ImpactStyle.Light,
            medium: ImpactStyle.Medium,
            heavy: ImpactStyle.Heavy,
        }[style]

        await Haptics.impact({ style: impactStyle })
    } catch {
        // Fail silently - haptics not available
    }
}

/**
 * Trigger a notification haptic
 * @param type 'success' | 'warning' | 'error'
 */
export async function triggerNotification(type: NotificationStyle): Promise<void> {
    if (!isNative) return

    try {
        const mod = await getHapticsModule()
        if (!mod) return

        const { Haptics, NotificationType } = mod
        const notificationType = {
            success: NotificationType.Success,
            warning: NotificationType.Warning,
            error: NotificationType.Error,
        }[type]

        await Haptics.notification({ type: notificationType })
    } catch {
        // Fail silently
    }
}

/**
 * Trigger a selection change haptic (very light feedback)
 */
export async function triggerSelection(): Promise<void> {
    if (!isNative) return

    try {
        const mod = await getHapticsModule()
        if (!mod) return

        const { Haptics } = mod
        await Haptics.selectionStart()
        await Haptics.selectionChanged()
        await Haptics.selectionEnd()
    } catch {
        // Fail silently
    }
}
