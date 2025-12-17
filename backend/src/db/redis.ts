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
  async del(key: string) { return this.store.delete(key) ? 1 : 0 }
  async ttl(key: string) { return -1 }
  async ping() { return 'PONG' }
  on(event: string, cb: any) { if(event==='connect') cb() }
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
