/**
 * Test Setup - In-Memory Mocks for Prisma and Redis
 *
 * SCHEMA SYNC REQUIREMENTS:
 * When the Prisma schema (prisma/schema.prisma) changes, update the mocks below:
 *
 * 1. NEW MODEL ADDED:
 *    - Add a new Map to dbStorage (e.g., newModels: new Map<string, any>())
 *    - Add db.newModel: createMockModel(dbStorage.newModels) to the mock
 *
 * 2. NEW RELATION ADDED:
 *    - Update resolveIncludes() to handle the new relation type
 *    - Follow existing patterns for user, profile, creator, subscriber relations
 *
 * 3. NEW AGGREGATE/QUERY METHOD:
 *    - Currently supported: findUnique, findFirst, findMany, create, update,
 *      upsert, delete, count, aggregate
 *    - Add new methods to createMockModel() as needed
 *
 * 4. NEW FIELD ADDED:
 *    - No changes needed - fields are stored dynamically via data spread
 *
 * Models currently mocked (must match schema.prisma):
 *   - user, profile, session, magicLinkToken, subscription, payment,
 *     request, update, activity
 */

import { config } from 'dotenv'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { vi } from 'vitest'

// Load test env before modules read config/env.ts
const cwd = process.cwd()
const envTestPath = path.join(cwd, '.env.test')
const envPath = fs.existsSync(envTestPath) ? envTestPath : path.join(cwd, '.env')
config({ path: envPath })

// Ensure NODE_ENV is test for Prisma/logging behaviors
process.env.NODE_ENV = 'test'

// Provide safe defaults so env validation passes in tests
const defaults: Record<string, string> = {
  PORT: '4001',
  APP_URL: 'http://localhost:5173',
  API_URL: 'http://localhost:4001',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/nate_test',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'test_jwt_secret_test_jwt_secret_test_jwt_secret',
  MAGIC_LINK_SECRET: 'test_magic_secret_test_magic_secret_1234',
  SESSION_SECRET: 'test_session_secret_test_session_secret_12',
  MAGIC_LINK_EXPIRES_MINUTES: '15',
  STRIPE_SECRET_KEY: 'sk_test_dummy_key_for_testing',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_dummy_webhook_secret',
  STRIPE_ONBOARDING_RETURN_URL: 'http://localhost:5173/settings/payments/complete',
  STRIPE_ONBOARDING_REFRESH_URL: 'http://localhost:5173/settings/payments/refresh',
  RESEND_API_KEY: 're_test_dummy_key',
  EMAIL_FROM: 'Nate <test@natepay.co>',
  R2_ACCOUNT_ID: 'test-account-id',
  R2_ACCESS_KEY_ID: 'test-access-key',
  R2_SECRET_ACCESS_KEY: 'test-secret-key',
  R2_BUCKET: 'test-bucket',
  R2_PUBLIC_URL: 'https://test.uploads.local',
  ENABLE_FLUTTERWAVE: 'false',
  ENABLE_SMS: 'false',
  ENABLE_PAYSTACK: 'true',
  PAYSTACK_SECRET_KEY: 'sk_test_dummy_paystack_key',
  PAYSTACK_WEBHOOK_SECRET: 'test_paystack_webhook_secret',
  JOBS_API_KEY: 'test_jobs_api_key_12345678',
}

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) {
    process.env[key] = value
  }
}

// Global mock for Redis - prevents connection attempts
vi.mock('../src/db/redis.js', () => {
  const store = new Map<string, string | number>()
  const reset = () => store.clear()
  return {
    redis: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => { store.set(key, value); return 'OK' }),
      setex: vi.fn(async (key: string, _seconds: number, value: string) => { store.set(key, value); return 'OK' }),
      del: vi.fn(async (key: string) => { store.delete(key); return 1 }),
      incr: vi.fn(async (key: string) => {
        const current = (store.get(key) as number) || 0
        store.set(key, current + 1)
        return current + 1
      }),
      expire: vi.fn(async () => 1),
      ttl: vi.fn(async () => -1),
      on: vi.fn(),
      quit: vi.fn(),
    },
    __reset: reset,
  }
})

// In-memory database storage for mocking
const dbStorage = {
  users: new Map<string, any>(),
  profiles: new Map<string, any>(),
  sessions: new Map<string, any>(),
  magicLinkTokens: new Map<string, any>(),
  subscriptions: new Map<string, any>(),
  payments: new Map<string, any>(),
  requests: new Map<string, any>(),
  updates: new Map<string, any>(),
  activities: new Map<string, any>(),
  payrollPeriods: new Map<string, any>(),
  pageViews: new Map<string, any>(),
}

const generateId = () => randomUUID()

// Helper to find profile for a user
function findProfileForUser(userId: string) {
  for (const profile of dbStorage.profiles.values()) {
    if (profile.userId === userId) {
      return profile
    }
  }
  return null
}

// Helper to resolve includes from storage
function resolveIncludes(item: any, include: any) {
  if (!include || !item) return item
  const result = { ...item }

  for (const [relation, config] of Object.entries(include)) {
    if (!config) continue

    // Handle user relation on session
    if (relation === 'user' && item.userId) {
      const user = dbStorage.users.get(item.userId)
      if (user) {
        result.user = { ...user }
        // Resolve nested includes on user
        if (typeof config === 'object' && config.include?.profile) {
          result.user.profile = findProfileForUser(user.id)
        }
      }
    }

    // Handle creator relation on request/subscription (links to user via creatorId)
    if (relation === 'creator' && item.creatorId) {
      const creator = dbStorage.users.get(item.creatorId)
      if (creator) {
        result.creator = { ...creator }
        // Resolve nested includes on creator
        if (typeof config === 'object' && config.include?.profile) {
          result.creator.profile = findProfileForUser(creator.id)
        }
        // Handle select on profile
        if (typeof config === 'object' && config.include?.profile?.select) {
          const fullProfile = findProfileForUser(creator.id)
          if (fullProfile) {
            const selectFields = config.include.profile.select
            result.creator.profile = {}
            for (const field of Object.keys(selectFields)) {
              result.creator.profile[field] = fullProfile[field]
            }
          }
        }
      }
    }

    // Handle profile relation on user
    if (relation === 'profile' && item.id) {
      result.profile = findProfileForUser(item.id)
    }

    // Handle subscriber relation
    if (relation === 'subscriber' && item.subscriberId) {
      const subscriber = dbStorage.users.get(item.subscriberId)
      if (subscriber) {
        result.subscriber = { ...subscriber }
        // Resolve nested profile if needed
        if (typeof config === 'object' && config.select?.profile) {
          result.subscriber.profile = findProfileForUser(subscriber.id)
        }
        if (typeof config === 'object' && config.include?.profile) {
          result.subscriber.profile = findProfileForUser(subscriber.id)
        }
      }
    }

    // Handle payments relation on subscription
    if (relation === 'payments' && item.id) {
      const payments: any[] = []
      for (const payment of dbStorage.payments.values()) {
        if (payment.subscriptionId === item.id) {
          payments.push(payment)
        }
      }
      result.payments = payments
    }
  }
  return result
}

function createMockModel(store: Map<string, any>) {
  return {
    findUnique: vi.fn(async ({ where, include }: any) => {
      // Try by id first
      if (where.id) {
        const item = store.get(where.id)
        return item ? resolveIncludes(item, include) : null
      }
      // Search by other unique fields
      for (const item of store.values()) {
        const match = Object.entries(where).every(([k, v]) => item[k] === v)
        if (match) return resolveIncludes(item, include)
      }
      return null
    }),
    updateMany: vi.fn(async ({ where, data }: any = {}) => {
      let count = 0
      for (const [id, item] of store.entries()) {
        const match = !where || Object.entries(where).every(([k, v]) => {
          if (v && typeof v === 'object' && v.gte !== undefined) {
            return item[k] >= v.gte
          }
          if (v && typeof v === 'object' && v.lte !== undefined) {
            return item[k] <= v.lte
          }
          return item[k] === v
        })
        if (match) {
          const updated = { ...item, ...data, updatedAt: new Date() }
          store.set(id, updated)
          count++
        }
      }
      return { count }
    }),
    findFirst: vi.fn(async ({ where, include, orderBy }: any = {}) => {
      if (!where) {
        const first = store.values().next().value
        return first ? resolveIncludes(first, include) : null
      }
      for (const item of store.values()) {
        const match = Object.entries(where).every(([k, v]) => {
          if (typeof v === 'object' && v !== null) return true
          return item[k] === v
        })
        if (match) return resolveIncludes(item, include)
      }
      return null
    }),
    findMany: vi.fn(async ({ where, include, orderBy, take, skip }: any = {}) => {
      let items = Array.from(store.values())
      if (where) {
        items = items.filter(item =>
          Object.entries(where).every(([k, v]) => {
            if (typeof v === 'object' && v !== null) return true
            return item[k] === v
          })
        )
      }
      if (skip) items = items.slice(skip)
      if (take) items = items.slice(0, take)
      return items.map(item => resolveIncludes(item, include))
    }),
    create: vi.fn(async ({ data, include }: any) => {
      const id = data.id || generateId()
      const item = { id, ...data, createdAt: new Date(), updatedAt: new Date() }
      store.set(id, item)
      return resolveIncludes(item, include)
    }),
    update: vi.fn(async ({ where, data, include }: any) => {
      let item = store.get(where.id)
      if (!item) {
        for (const [key, val] of store.entries()) {
          const match = Object.entries(where).every(([k, v]) => val[k] === v)
          if (match) { item = val; break }
        }
      }
      if (!item) return null
      const updated = { ...item, ...data, updatedAt: new Date() }
      store.set(item.id, updated)
      return resolveIncludes(updated, include)
    }),
    upsert: vi.fn(async ({ where, create, update, include }: any) => {
      let existing = null
      for (const item of store.values()) {
        const match = Object.entries(where).every(([k, v]) => item[k] === v)
        if (match) { existing = item; break }
      }
      if (existing) {
        const updated = { ...existing, ...update, updatedAt: new Date() }
        store.set(existing.id, updated)
        return resolveIncludes(updated, include)
      }
      const id = generateId()
      const item = { id, ...create, createdAt: new Date(), updatedAt: new Date() }
      store.set(id, item)
      return resolveIncludes(item, include)
    }),
    delete: vi.fn(async ({ where }: any) => {
      const item = store.get(where.id)
      if (item) store.delete(where.id)
      return item
    }),
    count: vi.fn(async () => store.size),
    aggregate: vi.fn(async ({ where, _sum }: any = {}) => {
      let items = Array.from(store.values())
      if (where) {
        items = items.filter(item =>
          Object.entries(where).every(([k, v]) => item[k] === v)
        )
      }

      // Build aggregate result
      const result: any = {}
      if (_sum) {
        result._sum = {}
        for (const field of Object.keys(_sum)) {
          result._sum[field] = items.reduce((sum, item) => sum + (item[field] || 0), 0)
        }
      }
      return result
    }),
  }
}

// Global mock for Prisma client
vi.mock('../src/db/client.js', () => ({
  db: {
    user: createMockModel(dbStorage.users),
    profile: createMockModel(dbStorage.profiles),
    session: createMockModel(dbStorage.sessions),
    magicLinkToken: createMockModel(dbStorage.magicLinkTokens),
    subscription: createMockModel(dbStorage.subscriptions),
    payment: createMockModel(dbStorage.payments),
    request: createMockModel(dbStorage.requests),
    update: createMockModel(dbStorage.updates),
    activity: createMockModel(dbStorage.activities),
    payrollPeriod: createMockModel(dbStorage.payrollPeriods),
    pageView: createMockModel(dbStorage.pageViews),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $executeRawUnsafe: vi.fn(async () => {
      Object.values(dbStorage).forEach(store => store.clear())
      return 0
    }),
  },
}))

// Export for tests to access storage directly
// Export for tests to access storage directly
export { dbStorage }
