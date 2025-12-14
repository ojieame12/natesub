/**
 * Distributed Locking Service
 *
 * Uses Redis for distributed locks to prevent race conditions
 * in webhook processing and billing jobs.
 *
 * SECURITY: Uses ownership tokens to prevent one worker from
 * accidentally releasing another worker's lock.
 */

import { redis } from '../db/redis.js'
import crypto from 'crypto'

const LOCK_PREFIX = 'lock:'

// Lua script for atomic release - only deletes if token matches
// This prevents Worker A from accidentally releasing Worker B's lock
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`

/**
 * Acquire a distributed lock with ownership token
 * @param key - Lock key (will be prefixed with 'lock:')
 * @param ttlMs - Time-to-live in milliseconds (auto-release after this time)
 * @returns Lock token if acquired, null if already locked
 */
export async function acquireLock(key: string, ttlMs: number): Promise<string | null> {
  const lockKey = `${LOCK_PREFIX}${key}`
  // Generate unique token for ownership verification
  const lockToken = crypto.randomUUID()

  // SET NX - only set if not exists
  // PX - set expiry in milliseconds
  const result = await redis.set(lockKey, lockToken, 'PX', ttlMs, 'NX')

  return result === 'OK' ? lockToken : null
}

/**
 * Release a distributed lock (only if we own it)
 * @param key - Lock key (will be prefixed with 'lock:')
 * @param token - The token returned from acquireLock
 * @returns true if lock was released, false if we didn't own it
 */
export async function releaseLock(key: string, token: string): Promise<boolean> {
  const lockKey = `${LOCK_PREFIX}${key}`

  // Use Lua script for atomic check-and-delete
  // This ensures we only release if we still own the lock
  const result = await redis.eval(RELEASE_SCRIPT, 1, lockKey, token)

  return result === 1
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
  const token = await acquireLock(key, ttlMs)

  if (!token) {
    return null
  }

  try {
    return await fn()
  } finally {
    const released = await releaseLock(key, token)
    if (!released) {
      // Lock expired or was stolen - log for monitoring
      console.warn(`[lock] Failed to release lock ${key} - may have expired or been stolen`)
    }
  }
}

/**
 * Try to acquire lock with retry
 *
 * @param key - Lock key
 * @param ttlMs - Lock TTL in milliseconds
 * @param maxRetries - Maximum number of retry attempts
 * @param retryDelayMs - Delay between retries in milliseconds
 * @returns Lock token if acquired, null if failed after all retries
 */
export async function acquireLockWithRetry(
  key: string,
  ttlMs: number,
  maxRetries: number = 3,
  retryDelayMs: number = 100
): Promise<string | null> {
  for (let i = 0; i <= maxRetries; i++) {
    const token = await acquireLock(key, ttlMs)
    if (token) return token

    if (i < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, retryDelayMs))
    }
  }

  return null
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

/**
 * Extend a lock's TTL (only if we own it)
 * @param key - Lock key
 * @param token - The token returned from acquireLock
 * @param ttlMs - New TTL in milliseconds
 * @returns true if extended, false if we don't own it
 */
export async function extendLock(key: string, token: string, ttlMs: number): Promise<boolean> {
  const lockKey = `${LOCK_PREFIX}${key}`

  // Lua script to extend only if we own the lock
  const extendScript = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("pexpire", KEYS[1], ARGV[2])
    else
      return 0
    end
  `

  const result = await redis.eval(extendScript, 1, lockKey, token, ttlMs.toString())
  return result === 1
}
