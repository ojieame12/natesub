/**
 * Test helpers for authentication
 */

import { db } from '../../src/db/client.js'
import { randomUUID } from 'crypto'

/**
 * Create a test session for a user
 */
export async function createTestSession(userId: string) {
  const token = randomUUID()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

  const session = await db.session.create({
    data: {
      id: randomUUID(),
      userId,
      token,
      expiresAt,
    },
  })

  return session
}
