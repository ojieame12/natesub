// Global type declarations

interface Window {
  Capacitor?: {
    isNativePlatform?: () => boolean
    getPlatform?: () => string
  }
}
