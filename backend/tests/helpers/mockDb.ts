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

// Helper to check if a value matches a Prisma where condition
function matchesCondition(itemValue: any, condition: any, key: string, item: any): boolean {
  // Handle relation filters FIRST (profile: { isNot: null } or profile: null)
  // These need special handling before null checks
  if (key === 'profile') {
    // For 'users' model, check if a profile exists for this user
    const userId = item.id
    const profileExists = Array.from(storage.profiles.values()).some(
      (p: any) => p.userId === userId
    )

    if (condition === null) {
      // profile: null means profile must not exist
      return !profileExists
    }
    if (typeof condition === 'object' && condition !== null) {
      if ('isNot' in condition && condition.isNot === null) {
        // profile: { isNot: null } means profile must exist
        return profileExists
      }
      if ('is' in condition && condition.is === null) {
        // profile: { is: null } means profile must not exist
        return !profileExists
      }
    }
  }

  // Handle null/undefined direct comparison
  if (condition === null || condition === undefined) {
    return itemValue === condition
  }

  // Handle non-object conditions (direct equality)
  if (typeof condition !== 'object') {
    return itemValue === condition
  }

  // Handle Prisma operators
  if ('not' in condition) {
    return itemValue !== condition.not
  }
  if ('in' in condition) {
    return condition.in.includes(itemValue)
  }
  if ('contains' in condition) {
    const mode = condition.mode === 'insensitive' ? 'i' : ''
    const regex = new RegExp(condition.contains, mode)
    return typeof itemValue === 'string' && regex.test(itemValue)
  }

  // Handle OR conditions
  if ('OR' in condition) {
    return condition.OR.some((orCond: any) =>
      Object.entries(orCond).every(([k, v]) => matchesCondition(item[k], v, k, item))
    )
  }

  // Default: skip complex conditions we don't understand
  return true
}

// Create a mock Prisma model
function createMockModel<T extends keyof typeof storage>(modelName: T) {
  const store = storage[modelName]

  return {
    findUnique: vi.fn(async ({ where }: { where: any }) => {
      if (where.id) return store.get(where.id) || null
      for (const item of store.values()) {
        const match = Object.entries(where).every(([k, v]) => matchesCondition(item[k], v, k, item))
        if (match) return item
      }
      return null
    }),

    findFirst: vi.fn(async ({ where, orderBy }: { where?: any; orderBy?: any }) => {
      const items = Array.from(store.values())
      if (!where) return items[0] || null
      for (const item of items) {
        const match = Object.entries(where).every(([k, v]) => matchesCondition(item[k], v, k, item))
        if (match) return item
      }
      return null
    }),

    findMany: vi.fn(async ({ where, orderBy, take, skip }: any = {}) => {
      let items = Array.from(store.values())
      if (where) {
        items = items.filter(item =>
          Object.entries(where).every(([k, v]) => matchesCondition(item[k], v, k, item))
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

    deleteMany: vi.fn(async ({ where }: any = {}) => {
      let count = 0
      for (const [id, item] of store.entries()) {
        if (!where) {
          store.delete(id)
          count++
        } else {
          const match = Object.entries(where).every(([k, v]) => matchesCondition(item[k], v, k, item))
          if (match) {
            store.delete(id)
            count++
          }
        }
      }
      return { count }
    }),

    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0
      for (const [id, item] of store.entries()) {
        const match = !where || Object.entries(where).every(([k, v]) => matchesCondition(item[k], v, k, item))
        if (match) {
          store.set(id, { ...item, ...data, updatedAt: new Date() })
          count++
        }
      }
      return { count }
    }),

    count: vi.fn(async ({ where }: any = {}) => {
      if (!where) return store.size
      let count = 0
      for (const item of store.values()) {
        const match = Object.entries(where).every(([k, v]) => matchesCondition(item[k], v, k, item))
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
  $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
    // For mock, just run the function with the mockDb itself
    return fn(mockDb)
  }),
}

// Export storage for direct manipulation in tests
export { storage }
