import { vi } from 'vitest'

// In-memory storage for mock database
const storage = {
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
const generateId = () => `test-id-${++idCounter}`

// Helper to reset all storage
export function resetMockDb() {
  Object.values(storage).forEach(map => map.clear())
  idCounter = 0
}

// Create a mock Prisma model
function createMockModel<T extends keyof typeof storage>(modelName: T) {
  const store = storage[modelName]

  return {
    findUnique: vi.fn(async ({ where }: { where: any }) => {
      if (where.id) return store.get(where.id) || null
      for (const item of store.values()) {
        const match = Object.entries(where).every(([k, v]) => item[k] === v)
        if (match) return item
      }
      return null
    }),

    findFirst: vi.fn(async ({ where, orderBy }: { where?: any; orderBy?: any }) => {
      const items = Array.from(store.values())
      if (!where) return items[0] || null
      for (const item of items) {
        const match = Object.entries(where).every(([k, v]) => {
          if (typeof v === 'object' && v !== null) return true // Skip complex conditions
          return item[k] === v
        })
        if (match) return item
      }
      return null
    }),

    findMany: vi.fn(async ({ where, orderBy, take, skip }: any = {}) => {
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
      return items
    }),

    create: vi.fn(async ({ data }: { data: any }) => {
      const id = data.id || generateId()
      const item = {
        id,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      store.set(id, item)
      return item
    }),

    update: vi.fn(async ({ where, data }: { where: any; data: any }) => {
      const existing = store.get(where.id)
      if (!existing) throw new Error(`Record not found: ${where.id}`)
      const updated = { ...existing, ...data, updatedAt: new Date() }
      store.set(where.id, updated)
      return updated
    }),

    upsert: vi.fn(async ({ where, create, update }: any) => {
      let existing = null
      for (const item of store.values()) {
        const match = Object.entries(where).every(([k, v]) => item[k] === v)
        if (match) {
          existing = item
          break
        }
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

    delete: vi.fn(async ({ where }: { where: any }) => {
      const item = store.get(where.id)
      if (item) store.delete(where.id)
      return item
    }),

    count: vi.fn(async ({ where }: any = {}) => {
      if (!where) return store.size
      let count = 0
      for (const item of store.values()) {
        const match = Object.entries(where).every(([k, v]) => item[k] === v)
        if (match) count++
      }
      return count
    }),
  }
}

// Mock Prisma client
export const mockDb = {
  user: createMockModel('users'),
  profile: createMockModel('profiles'),
  session: createMockModel('sessions'),
  magicLinkToken: createMockModel('magicLinkTokens'),
  subscription: createMockModel('subscriptions'),
  payment: createMockModel('payments'),
  request: createMockModel('requests'),
  update: createMockModel('updates'),
  activity: createMockModel('activities'),
  $connect: vi.fn(),
  $disconnect: vi.fn(),
  $executeRawUnsafe: vi.fn(async () => { resetMockDb(); return 0 }),
}

// Export storage for direct manipulation in tests
export { storage }
