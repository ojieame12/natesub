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
import { vi, beforeEach } from 'vitest'

// Load test env before modules read config/env.ts
const cwd = process.cwd()
const envTestPath = path.join(cwd, '.env.test')
const envPath = fs.existsSync(envTestPath) ? envTestPath : path.join(cwd, '.env')
config({ path: envPath })

// Ensure NODE_ENV is test for Prisma/logging behaviors
process.env.NODE_ENV = 'test'

// Shared Redis mock store - must be declared before vi.mock
const redisMockStore = new Map<string, string | number>()

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
  ENCRYPTION_KEY: 'test_encryption_key_at_least_32_chars_long',
  ADMIN_API_KEY: 'test-admin-key-12345',
  ADMIN_API_KEY_READONLY: 'test-readonly-key-67890',
}

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) {
    process.env[key] = value
  }
}

// Always start tests with a clean Redis mock store to avoid cross-file bleed.
beforeEach(() => {
  redisMockStore.clear()
})

// Global mock for Redis - prevents connection attempts
// Uses redisMockStore declared above so tests can access it via redisMock export
vi.mock('../src/db/redis.js', () => {
  const reset = () => redisMockStore.clear()
  return {
    redis: {
      get: vi.fn(async (key: string) => redisMockStore.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => { redisMockStore.set(key, value); return 'OK' }),
      setex: vi.fn(async (key: string, _seconds: number, value: string) => { redisMockStore.set(key, value); return 'OK' }),
      del: vi.fn(async (...keys: string[]) => {
        let deleted = 0
        for (const key of keys) {
          if (redisMockStore.delete(key)) deleted++
        }
        return deleted
      }),
      incr: vi.fn(async (key: string) => {
        const current = (redisMockStore.get(key) as number) || 0
        redisMockStore.set(key, current + 1)
        return current + 1
      }),
      expire: vi.fn(async () => 1),
      pexpire: vi.fn(async () => 1),
      ttl: vi.fn(async () => -1),
      ping: vi.fn(async () => 'PONG'),
      eval: vi.fn(async () => null),
      exists: vi.fn(async (key: string) => (redisMockStore.has(key) ? 1 : 0)),
      on: vi.fn(),
      quit: vi.fn(),
      // Scan keys matching a pattern - used by cache invalidation
      scan: vi.fn(async (cursor: string, ...args: string[]): Promise<[string, string[]]> => {
        const matchIdx = args.indexOf('MATCH')
        const pattern = matchIdx >= 0 && matchIdx + 1 < args.length ? args[matchIdx + 1] : '*'
        // Convert glob pattern to regex
        const regexPattern = pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')
        const regex = new RegExp(`^${regexPattern}$`)
        const keys = Array.from(redisMockStore.keys()).filter(k => regex.test(k as string)) as string[]
        return ['0', keys]
      }),
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
  updateDeliveries: new Map<string, any>(),
  activities: new Map<string, any>(),
  payrollPeriods: new Map<string, any>(),
  pageViews: new Map<string, any>(),
  webhookEvents: new Map<string, any>(),
  reminders: new Map<string, any>(),
  systemLogs: new Map<string, any>(),
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

    // Handle _count includes (e.g., _count: { select: { subscriptions: true } })
    if (relation === '_count') {
      result._count = {
        subscriptions: 0,
        subscribedTo: 0,
        payments: 0,
      }
      // Count actual subscriptions for this user
      if (item.id) {
        let subCount = 0
        let subscribedToCount = 0
        for (const sub of dbStorage.subscriptions.values()) {
          if (sub.creatorId === item.id) subCount++
          if (sub.subscriberId === item.id) subscribedToCount++
        }
        result._count.subscriptions = subCount
        result._count.subscribedTo = subscribedToCount
      }
      continue
    }

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
        // Handle select on profile (via include)
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
        // Handle select on profile (via select)
        if (typeof config === 'object' && config.select?.profile) {
          const fullProfile = findProfileForUser(creator.id)
          if (fullProfile) {
            if (config.select.profile.select) {
              const selectFields = config.select.profile.select
              result.creator.profile = {}
              for (const field of Object.keys(selectFields)) {
                result.creator.profile[field] = fullProfile[field]
              }
            } else {
              result.creator.profile = fullProfile
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
          // Handle simple date operators
          if (v && typeof v === 'object') {
            if (v.gte !== undefined && new Date(item[k]) < new Date(v.gte)) return false
            if (v.gt !== undefined && new Date(item[k]) <= new Date(v.gt)) return false
            if (v.lte !== undefined && new Date(item[k]) > new Date(v.lte)) return false
            if (v.lt !== undefined && new Date(item[k]) >= new Date(v.lt)) return false
            // Handle 'in' operator
            if (v.in !== undefined && Array.isArray(v.in) && !v.in.includes(item[k])) return false
            return true
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
      // Basic implementation - just finds the first match
      for (const item of store.values()) {
        const match = !where || Object.entries(where).every(([k, v]) => {
          if (v && typeof v === 'object') {
             if (v.gte !== undefined && new Date(item[k]) < new Date(v.gte)) return false
             if (v.lte !== undefined && new Date(item[k]) > new Date(v.lte)) return false
             return true
          }
          return item[k] === v
        })
        if (match) return resolveIncludes(item, include)
      }
      return null
    }),
    findMany: vi.fn(async ({ where, include, select, orderBy, take, skip, cursor }: any = {}) => {
      let items = Array.from(store.values())
      if (where) {
        items = items.filter(item =>
          Object.entries(where).every(([k, v]) => {
            // Handle profile relation filter (for user queries)
            if (k === 'profile') {
              const hasProfile = findProfileForUser(item.id) !== null
              if (v === null) {
                // profile: null means user must NOT have a profile
                return !hasProfile
              }
              if (v && typeof v === 'object') {
                if ('isNot' in v && v.isNot === null) {
                  // profile: { isNot: null } means user MUST have a profile
                  return hasProfile
                }
                if ('is' in v && v.is === null) {
                  // profile: { is: null } means user must NOT have a profile
                  return !hasProfile
                }
              }
              return true // Unknown profile filter, allow through
            }
            // Handle simple date operators and 'in'
            if (v && typeof v === 'object') {
              if (v.gte !== undefined && new Date(item[k]) < new Date(v.gte)) return false
              if (v.gt !== undefined && new Date(item[k]) <= new Date(v.gt)) return false
              if (v.lte !== undefined) {
                 const itemDate = new Date(item[k])
                 const filterDate = new Date(v.lte)
                 if (itemDate > filterDate) return false
              }
              if (v.lt !== undefined && new Date(item[k]) >= new Date(v.lt)) return false
              if (v.in !== undefined && Array.isArray(v.in) && !v.in.includes(item[k])) return false
              if (v.equals !== undefined && item[k] !== v.equals) return false
              if (v.not !== undefined) {
                if (v.not === null) {
                  if (item[k] === null || item[k] === undefined) return false
                } else if (item[k] === v.not) {
                  return false
                }
              }
              return true
            }
            return item[k] === v
          })
        )
      }
      // Handle cursor-based pagination (Prisma includes cursor item, use skip: 1 to exclude it)
      if (cursor?.id) {
        const cursorIndex = items.findIndex(item => item.id === cursor.id)
        if (cursorIndex !== -1) {
          // Start from cursor item (Prisma behavior)
          items = items.slice(cursorIndex)
        }
      }
      if (skip) items = items.slice(skip)
      if (take) items = items.slice(0, take)
      // Handle select with nested relations
      if (select) {
        return items.map(item => {
          const result: any = {}
          for (const [field, config] of Object.entries(select)) {
            if (config === true) {
              result[field] = item[field]
            } else if (typeof config === 'object' && config !== null) {
              // Handle nested relation select (e.g., profile: { select: {...} })
              if (field === 'profile') {
                const profile = findProfileForUser(item.id)
                if (profile && (config as any).select) {
                  result.profile = {}
                  for (const [subField, subConfig] of Object.entries((config as any).select)) {
                    if (subConfig) result.profile[subField] = profile[subField]
                  }
                } else {
                  result.profile = profile
                }
              } else {
                result[field] = item[field]
              }
            }
          }
          return result
        })
      }
      return items.map(item => resolveIncludes(item, include))
    }),
    create: vi.fn(async ({ data, include }: any) => {
      const id = data.id || generateId()
      // Preserve createdAt/updatedAt if provided in data, otherwise use current time
      const item = {
        id,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data, // data.createdAt overwrites default if provided
      }
      // Payment.occurredAt exists in the real schema with a default of now().
      // Ensure the in-memory mock behaves the same so time-based analytics can
      // safely rely on occurredAt.
      if (store === dbStorage.payments && item.occurredAt === undefined) {
        item.occurredAt = item.createdAt
      }
      store.set(id, item)
      return resolveIncludes(item, include)
    }),
    update: vi.fn(async ({ where, data, include }: any) => {
      let item = store.get(where.id)
      if (!item) {
        // Fallback find
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
      if (where.id) existing = store.get(where.id)
      if (!existing) {
        for (const item of store.values()) {
          const match = Object.entries(where).every(([k, v]) => item[k] === v)
          if (match) { existing = item; break }
        }
      }
      
      if (existing) {
        const updated = { ...existing, ...update, updatedAt: new Date() }
        store.set(existing.id, updated)
        return resolveIncludes(updated, include)
      }
      const id = generateId()
      const item = { id, ...create, createdAt: new Date(), updatedAt: new Date() }
      if (store === dbStorage.payments && item.occurredAt === undefined) {
        item.occurredAt = item.createdAt
      }
      store.set(id, item)
      return resolveIncludes(item, include)
    }),
    delete: vi.fn(async ({ where }: any) => {
      const item = store.get(where.id)
      if (item) store.delete(where.id)
      return item
    }),
    deleteMany: vi.fn(async ({ where }: any = {}) => {
      let count = 0
      for (const [id, item] of store.entries()) {
        if (!where) {
          store.delete(id)
          count++
        } else {
          const match = Object.entries(where).every(([k, v]) => {
            if (v && typeof v === 'object') {
              if (v.in !== undefined && Array.isArray(v.in) && !v.in.includes(item[k])) return false
              if (v.not !== undefined && item[k] === v.not) return false
              return true
            }
            return item[k] === v
          })
          if (match) {
            store.delete(id)
            count++
          }
        }
      }
      return { count }
    }),
    count: vi.fn(async (args: any = {}) => {
      const { where } = args
        if (!where) return store.size
        return Array.from(store.values()).filter(item =>
          Object.entries(where).every(([k, v]) => {
            // Handle profile relation filter (for user queries)
            if (k === 'profile') {
              const hasProfile = findProfileForUser(item.id) !== null
              if (v === null) {
                return !hasProfile
              }
              if (v && typeof v === 'object') {
                if ('isNot' in v && v.isNot === null) {
                  return hasProfile
                }
                if ('is' in v && v.is === null) {
                  return !hasProfile
                }
              }
              return true
            }
            // Handle simple date operators, 'in', and 'not'
            if (v && typeof v === 'object') {
              if (v.gte !== undefined && new Date(item[k]) < new Date(v.gte)) return false
              if (v.gt !== undefined && new Date(item[k]) <= new Date(v.gt)) return false
              if (v.lte !== undefined && new Date(item[k]) > new Date(v.lte)) return false
              if (v.lt !== undefined && new Date(item[k]) >= new Date(v.lt)) return false
              if (v.in !== undefined && Array.isArray(v.in) && !v.in.includes(item[k])) return false
              if (v.not !== undefined) {
                if (v.not === null) {
                  if (item[k] === null || item[k] === undefined) return false
                } else if (item[k] === v.not) {
                  return false
                }
              }
              return true
            }
            return item[k] === v
          })
        ).length
    }),
    // ... aggregate, createMany, groupBy ...
    aggregate: vi.fn(async ({ where, _sum, _count }: any = {}) => {
      let items = Array.from(store.values())
      if (where) {
        items = items.filter(item =>
          Object.entries(where).every(([k, v]) => {
            // Handle simple date operators, 'in', and 'not'
            if (v && typeof v === 'object') {
              if (v.gte !== undefined && new Date(item[k]) < new Date(v.gte)) return false
              if (v.gt !== undefined && new Date(item[k]) <= new Date(v.gt)) return false
              if (v.lte !== undefined && new Date(item[k]) > new Date(v.lte)) return false
              if (v.lt !== undefined && new Date(item[k]) >= new Date(v.lt)) return false
              if (v.in !== undefined && Array.isArray(v.in) && !v.in.includes(item[k])) return false
              if (v.not !== undefined) {
                if (v.not === null) {
                  if (item[k] === null || item[k] === undefined) return false
                } else if (item[k] === v.not) {
                  return false
                }
              }
              return true
            }
            if (item[k] !== v) {
               return false
            }
            return true
          })
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
      // Handle _count (can be true or object)
      if (_count === true || _count) {
        result._count = items.length
      }
      return result
    }),
    createMany: vi.fn(async ({ data }: any) => {
      const items = Array.isArray(data) ? data : [data]
      let count = 0
      for (const item of items) {
        const id = item.id || generateId()
        const newItem = { id, ...item, createdAt: new Date(), updatedAt: new Date() }
        store.set(id, newItem)
        count++
      }
      return { count }
    }),
    groupBy: vi.fn(async ({ by, where, _count, _sum }: any) => {
      const items = Array.from(store.values()).filter(item => {
        if (!where) return true
        return Object.entries(where).every(([k, v]) => {
          if (v && typeof v === 'object') {
            if (v.gte !== undefined && new Date(item[k]) < new Date(v.gte)) return false
            if (v.gt !== undefined && new Date(item[k]) <= new Date(v.gt)) return false
            if (v.lte !== undefined && new Date(item[k]) > new Date(v.lte)) return false
            if (v.lt !== undefined && new Date(item[k]) >= new Date(v.lt)) return false
            if (v.in !== undefined && Array.isArray(v.in) && !v.in.includes(item[k])) return false
            if (v.not !== undefined) {
              if (v.not === null) {
                if (item[k] === null || item[k] === undefined) return false
              } else if (item[k] === v.not) {
                return false
              }
            }
            return true
          }
          return item[k] === v
        })
      })

      // Group items
      const groups = new Map<string, any[]>()
      for (const item of items) {
        const key = by.map((field: string) => item[field]).join(':::')
        if (!groups.has(key)) {
          groups.set(key, [])
        }
        groups.get(key)!.push(item)
      }

      // Calculate aggregates for each group
      return Array.from(groups.entries()).map(([key, groupItems]) => {
        const result: any = {
          _count: _count ? groupItems.length : undefined,
        }

        if (_sum) {
          result._sum = {}
          for (const field of Object.keys(_sum)) {
            result._sum[field] = groupItems.reduce((sum, item) => sum + (item[field] || 0), 0)
          }
        }

        // Add grouping fields
        by.forEach((field: string) => {
          result[field] = groupItems[0][field]
        })

        return result
      })
    }),
  }
}

// Global mock for Prisma client
vi.mock('../src/db/client.js', () => {
  const models = {
    user: createMockModel(dbStorage.users),
    profile: createMockModel(dbStorage.profiles),
    session: createMockModel(dbStorage.sessions),
    magicLinkToken: createMockModel(dbStorage.magicLinkTokens),
    subscription: createMockModel(dbStorage.subscriptions),
    payment: createMockModel(dbStorage.payments),
    request: createMockModel(dbStorage.requests),
    update: createMockModel(dbStorage.updates),
    updateDelivery: createMockModel(dbStorage.updateDeliveries),
    activity: createMockModel(dbStorage.activities),
    payrollPeriod: createMockModel(dbStorage.payrollPeriods),
    pageView: createMockModel(dbStorage.pageViews),
    webhookEvent: createMockModel(dbStorage.webhookEvents),
    reminder: createMockModel(dbStorage.reminders),
    systemLog: createMockModel(dbStorage.systemLogs),
  }

  const client = {
    ...models,
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $queryRaw: vi.fn(async () => []),
    $executeRawUnsafe: vi.fn(async () => {
      Object.values(dbStorage).forEach(store => store.clear())
      return 0
    }),
    $transaction: vi.fn(async (arg) => {
      if (Array.isArray(arg)) return Promise.all(arg)
      if (typeof arg === 'function') return arg(client)
      return arg
    }),
  }

  return { db: client }
})

// Redis mock wrapper for tests to interact with the shared mock store
export const redisMock = {
  get: (key: string) => redisMockStore.get(key) ?? null,
  set: (key: string, value: string) => { redisMockStore.set(key, value); return 'OK' },
  delete: (key: string) => redisMockStore.delete(key),
  clear: () => redisMockStore.clear(),
  has: (key: string) => redisMockStore.has(key),
  keys: () => Array.from(redisMockStore.keys()),
}

// Export for tests to access storage directly
export { dbStorage }
