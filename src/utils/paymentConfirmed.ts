const PAYMENT_CONFIRMED_KEY = 'natepay_payment_confirmed'

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000

export function setPaymentConfirmed(timestampMs: number = Date.now()) {
  try {
    localStorage.setItem(PAYMENT_CONFIRMED_KEY, timestampMs.toString())
  } catch {
    // ignore
  }
}

export function hasRecentPaymentConfirmation(maxAgeMs: number = DEFAULT_MAX_AGE_MS): boolean {
  try {
    const timestamp = localStorage.getItem(PAYMENT_CONFIRMED_KEY)
    if (!timestamp) return false

    const ageMs = Date.now() - parseInt(timestamp, 10)
    if (!Number.isFinite(ageMs) || ageMs < 0) return false

    if (ageMs > maxAgeMs) {
      localStorage.removeItem(PAYMENT_CONFIRMED_KEY)
      return false
    }

    return true
  } catch {
    return false
  }
}

export function clearPaymentConfirmed() {
  try {
    localStorage.removeItem(PAYMENT_CONFIRMED_KEY)
  } catch {
    // ignore
  }
}

