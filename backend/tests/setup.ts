import { config } from 'dotenv'
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
}

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) {
    process.env[key] = value
  }
}

// Global mock for Redis - prevents connection attempts
vi.mock('../src/db/redis.js', () => {
  const store = new Map<string, string | number>()
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
}

let idCounter = 0
const generateId = () => `test-${Date.now()}-${++idCounter}`

function createMockModel(store: Map<string, any>) {
  return {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.id) return store.get(where.id) || null
      for (const item of store.values()) {
        const match = Object.entries(where).every(([k, v]) => item[k] === v)
        if (match) return item
      }
      return null
    }),
    findFirst: vi.fn(async ({ where }: any = {}) => {
      if (!where) return store.values().next().value || null
      for (const item of store.values()) {
        const match = Object.entries(where).every(([k, v]) => {
          if (typeof v === 'object' && v !== null) return true
          return item[k] === v
        })
        if (match) return item
      }
      return null
    }),
    findMany: vi.fn(async ({ where }: any = {}) => {
      let items = Array.from(store.values())
      if (where) {
        items = items.filter(item =>
          Object.entries(where).every(([k, v]) => {
            if (typeof v === 'object' && v !== null) return true
            return item[k] === v
          })
        )
      }
      return items
    }),
    create: vi.fn(async ({ data }: any) => {
      const id = data.id || generateId()
      const item = { id, ...data, createdAt: new Date(), updatedAt: new Date() }
      store.set(id, item)
      return item
    }),
    update: vi.fn(async ({ where, data }: any) => {
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
      return updated
    }),
    upsert: vi.fn(async ({ where, create, update }: any) => {
      let existing = null
      for (const item of store.values()) {
        const match = Object.entries(where).every(([k, v]) => item[k] === v)
        if (match) { existing = item; break }
      }
      if (existing) {
        const updated = { ...existing, ...update, updatedAt: new Date() }
        store.set(existing.id, updated)
        return updated
      }
      const id = generateId()
      const item = { id, ...create, createdAt: new Date(), updatedAt: new Date() }
      store.set(id, item)
      return item
    }),
    delete: vi.fn(async ({ where }: any) => {
      const item = store.get(where.id)
      if (item) store.delete(where.id)
      return item
    }),
    count: vi.fn(async () => store.size),
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
    $connect: vi.fn(),
    $disconnect: vi.fn(),
    $executeRawUnsafe: vi.fn(async () => {
      Object.values(dbStorage).forEach(store => store.clear())
      idCounter = 0
      return 0
    }),
  },
}))

// Export for tests to access storage directly
export { dbStorage }
