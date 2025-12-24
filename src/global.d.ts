// Global type declarations

interface Window {
  Capacitor?: {
    isNativePlatform?: () => boolean
    getPlatform?: () => string
  }
}

// View Transitions API (Chrome 111+, Safari 18+)
// https://developer.mozilla.org/en-US/docs/Web/API/View_Transitions_API
interface ViewTransition {
  finished: Promise<void>
  ready: Promise<void>
  updateCallbackDone: Promise<void>
  skipTransition(): void
}

interface Document {
  startViewTransition?(callback: () => void | Promise<void>): ViewTransition
}
