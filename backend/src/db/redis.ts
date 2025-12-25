import Redis from 'ioredis'
import { env } from '../config/env.js'

// Mock Redis for when REDIS_URL is not set (prevents crash)
class MockRedis {
  private store = new Map<string, string>()

  async get(key: string) { return this.store.get(key) || null }
  async set(key: string, val: string) { this.store.set(key, val); return 'OK' }
  async setex(key: string, ttl: number, val: string) { this.store.set(key, val); return 'OK' }
  async incr(key: string) {
    const val = parseInt(this.store.get(key) || '0') + 1
    this.store.set(key, val.toString())
    return val
  }
  async expire(key: string, ttl: number) { return 1 }
  async ttl(key: string) { return -1 }
  async ping() { return 'PONG' }
  on(event: string, cb: any) { if(event==='connect') cb() }

  /**
   * Delete one or more keys
   * Supports batch deletion for cache invalidation
   */
  async del(...keys: string[]): Promise<number> {
    let deleted = 0
    for (const key of keys) {
      if (this.store.delete(key)) deleted++
    }
    return deleted
  }

  /**
   * Scan keys matching a pattern
   * Used by cache invalidation to find keys to delete
   * Returns [cursor, keys] - cursor '0' means scan complete
   */
  async scan(cursor: string, ...args: string[]): Promise<[string, string[]]> {
    // Extract pattern from args: MATCH pattern COUNT limit
    const matchIdx = args.indexOf('MATCH')
    const pattern = matchIdx >= 0 && matchIdx + 1 < args.length ? args[matchIdx + 1] : '*'

    // Convert glob pattern to regex (simple conversion)
    // Handles * (any chars) and ? (single char)
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape regex special chars except * and ?
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')
    const regex = new RegExp(`^${regexPattern}$`)

    // Return all matching keys (mock doesn't need pagination)
    const keys = Array.from(this.store.keys()).filter(k => regex.test(k))
    return ['0', keys] // cursor '0' signals end of scan
  }

  /**
   * Reset the store - used for testing between tests
   */
  __reset() {
    this.store.clear()
  }
}

let redisClient: Redis | any

// Enterprise Requirement: Redis is critical for rate limits, locks, and idempotency.
// In production, we must fail fast if Redis is missing to prevent unsafe operation.
if (env.NODE_ENV === 'production' && !env.REDIS_URL) {
  console.error('❌ FATAL: REDIS_URL is required in production (rate limits, locks, idempotency).')
  process.exit(1)
}

if (env.REDIS_URL) {
  redisClient = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000)
      return delay
    },
  })

  redisClient.on('error', (err: any) => {
    console.error('Redis connection error:', err)
  })

  redisClient.on('connect', () => {
    console.log('✅ Redis connected')
  })
} else {
  console.warn('⚠️ REDIS_URL not set. Using in-memory mock (rate limits will not persist).')
  redisClient = new MockRedis()
}

export const redis = redisClient

// Export reset function for testing
export const __reset = () => {
  if (redisClient instanceof MockRedis) {
    redisClient.__reset()
  }
}
