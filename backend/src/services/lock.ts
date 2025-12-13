/**
 * Distributed Locking Service
 *
 * Uses Redis for distributed locks to prevent race conditions
 * in webhook processing and billing jobs.
 */

import { redis } from '../db/redis.js'

const LOCK_PREFIX = 'lock:'

/**
 * Acquire a distributed lock
 * @param key - Lock key (will be prefixed with 'lock:')
 * @param ttlMs - Time-to-live in milliseconds (auto-release after this time)
 * @returns true if lock acquired, false if already locked
 */
export async function acquireLock(key: string, ttlMs: number): Promise<boolean> {
  const lockKey = `${LOCK_PREFIX}${key}`
  const lockValue = Date.now().toString()

  // SET NX - only set if not exists
  // PX - set expiry in milliseconds
  const result = await redis.set(lockKey, lockValue, 'PX', ttlMs, 'NX')

  return result === 'OK'
}

/**
 * Release a distributed lock
 * @param key - Lock key (will be prefixed with 'lock:')
 */
export async function releaseLock(key: string): Promise<void> {
  const lockKey = `${LOCK_PREFIX}${key}`
  await redis.del(lockKey)
}

/**
 * Execute a function with a distributed lock
 *
 * @param key - Lock key
 * @param ttlMs - Lock TTL in milliseconds
 * @param fn - Function to execute while holding lock
 * @returns Result of fn, or null if lock couldn't be acquired
 *
 * @example
 * const result = await withLock('payment:evt_123', 30000, async () => {
 *   // Process payment...
 *   return payment
 * })
 * if (result === null) {
 *   console.log('Another process is handling this payment')
 * }
 */
export async function withLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T | null> {
  const acquired = await acquireLock(key, ttlMs)

  if (!acquired) {
    return null
  }

  try {
    return await fn()
  } finally {
    await releaseLock(key)
  }
}

/**
 * Try to acquire lock with retry
 *
 * @param key - Lock key
 * @param ttlMs - Lock TTL in milliseconds
 * @param maxRetries - Maximum number of retry attempts
 * @param retryDelayMs - Delay between retries in milliseconds
 * @returns true if lock acquired, false if failed after all retries
 */
export async function acquireLockWithRetry(
  key: string,
  ttlMs: number,
  maxRetries: number = 3,
  retryDelayMs: number = 100
): Promise<boolean> {
  for (let i = 0; i <= maxRetries; i++) {
    const acquired = await acquireLock(key, ttlMs)
    if (acquired) return true

    if (i < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, retryDelayMs))
    }
  }

  return false
}

/**
 * Check if a lock is currently held
 * @param key - Lock key
 * @returns true if lock exists
 */
export async function isLocked(key: string): Promise<boolean> {
  const lockKey = `${LOCK_PREFIX}${key}`
  const exists = await redis.exists(lockKey)
  return exists === 1
}
