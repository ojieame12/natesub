import { db } from '../../src/db/client.js'
import { resetMockDb, mockDb } from './mockDb.js'

// Check if we're using the mock database
const useMockDb = process.env.USE_MOCK_DB === 'true'

export async function resetDatabase() {
  if (useMockDb) {
    resetMockDb()
    return
  }

  try {
    await db.$executeRawUnsafe(
      'TRUNCATE TABLE "sessions","magic_link_tokens","payments","subscriptions","requests","updates","activities","profiles","users" RESTART IDENTITY CASCADE;'
    )
  } catch (error) {
    // If database is not available, use mock reset
    console.warn('Database not available, using mock reset')
    resetMockDb()
  }
}

export async function disconnectDatabase() {
  if (useMockDb) {
    mockDb.$disconnect()
    return
  }

  try {
    await db.$disconnect()
  } catch {
    // Ignore disconnect errors
  }
}

export { mockDb, resetMockDb }
