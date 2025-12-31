import { api } from '../api'

export type SavePayload = {
  step: number
  stepKey: string
  branch?: 'personal' | 'service'
  data?: Record<string, unknown>
}

type QueueItem = {
  payload: SavePayload
  attempts: number
  lastAttempt: number
}

const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 10000

/**
 * SaveRetryQueue handles progress saves with exponential backoff retry.
 *
 * Features:
 * - Deduplication by stepKey (latest payload wins)
 * - Exponential backoff (1s, 2s, 4s, up to 10s max)
 * - Subscriber notification on persistent failures
 * - Drain method for flushing before navigation
 */
class SaveRetryQueue {
  private queue = new Map<string, QueueItem>()
  private processing = false
  private timeoutId: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<(hasFailures: boolean) => void>()

  /**
   * Enqueue a save payload. If a payload with the same stepKey exists,
   * it will be replaced (latest data wins, attempt count preserved).
   */
  enqueue(payload: SavePayload): void {
    const key = payload.stepKey
    const existing = this.queue.get(key)

    this.queue.set(key, {
      payload,
      attempts: existing?.attempts ?? 0,
      lastAttempt: existing?.lastAttempt ?? 0,
    })

    this.scheduleProcessing()
  }

  private scheduleProcessing(): void {
    if (this.timeoutId !== null) return
    this.timeoutId = setTimeout(() => {
      this.timeoutId = null
      this.processQueue()
    }, 0)
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.size === 0) return
    this.processing = true

    const now = Date.now()
    let earliestRetry = Infinity

    for (const [key, item] of this.queue) {
      // Skip items that have exhausted retries
      if (item.attempts >= MAX_RETRIES) {
        this.notifyListeners(true)
        continue
      }

      // Calculate delay for this attempt
      const delay = Math.min(
        BASE_DELAY_MS * Math.pow(2, item.attempts),
        MAX_DELAY_MS
      )
      const readyAt = item.lastAttempt + delay

      // Not ready yet - track for scheduling
      if (now < readyAt) {
        earliestRetry = Math.min(earliestRetry, readyAt - now)
        continue
      }

      try {
        await api.auth.saveOnboardingProgress(item.payload)
        this.queue.delete(key)
      } catch (err) {
        console.warn(`[SaveRetryQueue] Attempt ${item.attempts + 1} failed for ${key}:`, err)
        item.attempts++
        item.lastAttempt = Date.now()

        // Check if this was the last retry
        if (item.attempts >= MAX_RETRIES) {
          this.notifyListeners(true)
        } else {
          // Schedule next retry
          const nextDelay = Math.min(
            BASE_DELAY_MS * Math.pow(2, item.attempts),
            MAX_DELAY_MS
          )
          earliestRetry = Math.min(earliestRetry, nextDelay)
        }
      }
    }

    this.processing = false

    // Schedule next processing if there are pending items
    if (earliestRetry < Infinity && this.queue.size > 0) {
      this.timeoutId = setTimeout(() => {
        this.timeoutId = null
        this.processQueue()
      }, earliestRetry)
    }
  }

  /**
   * Attempt to flush all pending saves immediately.
   * Returns true if all saves succeeded.
   */
  async drain(): Promise<boolean> {
    // Cancel any pending scheduled processing
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId)
      this.timeoutId = null
    }

    const entries = Array.from(this.queue.entries())
    if (entries.length === 0) return true

    const results = await Promise.all(
      entries.map(async ([key, item]) => {
        try {
          await api.auth.saveOnboardingProgress(item.payload)
          this.queue.delete(key)
          return true
        } catch (err) {
          console.warn(`[SaveRetryQueue] Drain failed for ${key}:`, err)
          return false
        }
      })
    )

    return results.every(Boolean)
  }

  /**
   * Subscribe to failure notifications.
   * Listener is called with true when an item exhausts all retries.
   */
  subscribe(listener: (hasFailures: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(hasFailures: boolean): void {
    this.listeners.forEach(fn => fn(hasFailures))
  }

  /**
   * Check if any items have exhausted all retry attempts.
   */
  hasFailedItems(): boolean {
    return Array.from(this.queue.values()).some(
      item => item.attempts >= MAX_RETRIES
    )
  }

  /**
   * Check if there are any pending saves (successful or not).
   */
  hasPendingItems(): boolean {
    return this.queue.size > 0
  }

  /**
   * Get count of pending items for debugging.
   */
  getPendingCount(): number {
    return this.queue.size
  }
}

// Singleton instance for the app
export const saveRetryQueue = new SaveRetryQueue()
