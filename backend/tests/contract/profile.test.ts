import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import app from '../../src/app.js'
import { db } from '../../src/db/client.js'
import { resetDatabase, disconnectDatabase } from '../helpers/db.js'
import { profileSchema, profilePatchSchema } from '../../src/schemas/profile.js'

describe('Profile Contract', () => {
  let user: any
  let sessionCookie: string

  beforeEach(async () => {
    await resetDatabase()
    
    // Create user with fixed ID matching the mock
    user = await db.user.create({
      data: {
        id: 'contract-test-user',
        email: 'contract@example.com',
      }
    })
    
    // Create session
    const session = await db.session.create({
      data: {
        userId: user.id,
        expiresAt: new Date(Date.now() + 3600000)
      }
    })
    sessionCookie = `session=${session.id}`
  })

  // Mock auth middleware globally (hoisted)
  vi.mock('../../src/services/auth.js', async () => {
    const actual = await vi.importActual('../../src/services/auth.js')
    return {
      ...actual,
      validateSession: async () => ({ userId: 'contract-test-user' })
    }
  })

  afterAll(async () => {
    await resetDatabase()
    await disconnectDatabase()
  })

  it('PUT /profile validates against profileSchema', async () => {
    const validPayload = {
      username: 'validuser',
      displayName: 'Valid User',
      country: 'United States',
      countryCode: 'US',
      currency: 'USD',
      purpose: 'tips',
      pricingModel: 'single',
      singleAmount: 500,
    }

    // Verify payload matches schema locally first (sanity check)
    const parseResult = profileSchema.safeParse(validPayload)
    expect(parseResult.success).toBe(true)

    // Send to backend
    const res = await app.fetch(new Request('http://localhost/profile', {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        Cookie: sessionCookie
      },
      body: JSON.stringify(validPayload)
    }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.profile).toBeDefined()
    expect(body.profile.username).toBe('validuser')
  })

  it('PUT /profile rejects invalid schema (missing fields)', async () => {
    const invalidPayload = {
      username: 'validuser',
      // Missing displayName, country, etc.
    }

    const res = await app.fetch(new Request('http://localhost/profile', {
      method: 'PUT',
      headers: { 
        'Content-Type': 'application/json',
        Cookie: sessionCookie
      },
      body: JSON.stringify(invalidPayload)
    }))

    expect(res.status).toBe(400)
  })

  it('PATCH /profile validates against profilePatchSchema', async () => {
    // First create a profile
    await db.profile.create({
      data: {
        userId: user.id,
        username: 'oldname',
        displayName: 'Old Name',
        country: 'US',
        countryCode: 'US',
        currency: 'USD',
      }
    })

    const patchPayload = {
      displayName: 'New Name'
    }

    // Verify locally
    expect(profilePatchSchema.safeParse(patchPayload).success).toBe(true)

    const res = await app.fetch(new Request('http://localhost/profile', {
      method: 'PATCH',
      headers: { 
        'Content-Type': 'application/json',
        Cookie: sessionCookie
      },
      body: JSON.stringify(patchPayload)
    }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.profile.displayName).toBe('New Name')
    expect(body.profile.username).toBe('oldname') // Unchanged
  })
})
