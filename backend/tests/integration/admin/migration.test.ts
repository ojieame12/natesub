/**
 * Admin Migration Endpoint Tests
 *
 * Tests for cross-border profile migration endpoints:
 * - GET /admin/migration/cross-border-profiles (list profiles needing migration)
 * - POST /admin/migration/cross-border-profiles/:id (single migration)
 * - POST /admin/migration/cross-border-profiles/batch (batch migration)
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../../src/app.js'
import { db } from '../../../src/db/client.js'
import { resetDatabase, disconnectDatabase } from '../../helpers/db.js'
// @ts-expect-error - test mock export
import { __reset as resetRedis } from '../../../src/db/redis.js'

// Mock email service
vi.mock('../../../src/services/email.js', async () => {
  const actual = await vi.importActual('../../../src/services/email.js')
  return {
    ...actual,
    _sendEmail: vi.fn().mockResolvedValue({ success: true }),
  }
})

// Admin session headers (super_admin with fresh session)
const adminHeaders = {
  'x-admin-api-key': 'test-admin-key-12345',
}

describe('admin migration', () => {
  beforeEach(async () => {
    await resetDatabase()
    vi.clearAllMocks()
    resetRedis()
  })

  afterAll(async () => {
    await resetDatabase()
    await disconnectDatabase()
  })

  // Helper to create cross-border profiles with wrong currency
  async function createCrossBorderProfiles() {
    // Nigerian creator with NGN (wrong - should be USD)
    const ngUser = await db.user.create({
      data: { email: 'ng-creator@test.com' },
    })
    const ngProfile = await db.profile.create({
      data: {
        userId: ngUser.id,
        username: 'ngcreator',
        displayName: 'Nigerian Creator',
        country: 'Nigeria',
        countryCode: 'NG',
        currency: 'NGN', // Wrong! Should be USD
        pricingModel: 'single',
        singleAmount: 500000, // 5000 NGN in kobo
      },
    })

    // Ghanaian creator with GHS (wrong - should be USD)
    const ghUser = await db.user.create({
      data: { email: 'gh-creator@test.com' },
    })
    const ghProfile = await db.profile.create({
      data: {
        userId: ghUser.id,
        username: 'ghcreator',
        displayName: 'Ghanaian Creator',
        country: 'Ghana',
        countryCode: 'GH',
        currency: 'GHS', // Wrong! Should be USD
        pricingModel: 'tiers',
        singleAmount: null,
        tiers: [{ name: 'Basic', amount: 5000, perks: ['Perk 1'] }],
      },
    })

    // South African creator with ZAR (needs migration - ZA is cross-border)
    const zaUser = await db.user.create({
      data: { email: 'za-creator@test.com' },
    })
    const zaProfile = await db.profile.create({
      data: {
        userId: zaUser.id,
        username: 'zacreator',
        displayName: 'South African Creator',
        country: 'South Africa',
        countryCode: 'ZA',
        currency: 'ZAR', // Wrong! ZA is cross-border, should be USD
        pricingModel: 'single',
        singleAmount: 10000,
      },
    })

    // US creator with USD (native Stripe, no migration needed)
    const usUser = await db.user.create({
      data: { email: 'us-creator@test.com' },
    })
    const usProfile = await db.profile.create({
      data: {
        userId: usUser.id,
        username: 'uscreator',
        displayName: 'US Creator',
        country: 'United States',
        countryCode: 'US',
        currency: 'USD', // Correct! US is native Stripe
        pricingModel: 'single',
        singleAmount: 500,
      },
    })

    // Nigerian creator already on USD (correct)
    const ngUsdUser = await db.user.create({
      data: { email: 'ng-usd-creator@test.com' },
    })
    const ngUsdProfile = await db.profile.create({
      data: {
        userId: ngUsdUser.id,
        username: 'ngusdcreator',
        displayName: 'Nigerian USD Creator',
        country: 'Nigeria',
        countryCode: 'NG',
        currency: 'USD', // Correct!
        pricingModel: 'single',
        singleAmount: 500,
      },
    })

    return { ngProfile, ghProfile, zaProfile, usProfile, ngUsdProfile }
  }

  describe('GET /admin/migration/cross-border-profiles', () => {
    it('lists only profiles needing migration (cross-border with non-USD currency)', async () => {
      const { ngProfile, ghProfile, zaProfile } = await createCrossBorderProfiles()

      const res = await app.request('/admin/migration/cross-border-profiles', {
        method: 'GET',
        headers: adminHeaders,
      })

      expect(res.status).toBe(200)
      const data = await res.json()

      // Should find NG, GH, and ZA profiles (all have wrong currency)
      expect(data.count).toBe(3)
      expect(data.migrationRequired).toBe(true)
      expect(data.profiles.map((p: any) => p.id).sort()).toEqual(
        [ngProfile.id, ghProfile.id, zaProfile.id].sort()
      )

      // Should NOT include US (native) or NG with USD (already correct)
      const ids = data.profiles.map((p: any) => p.id)
      expect(ids).not.toContain('uscreator')
      expect(ids).not.toContain('ngusdcreator')
    })

    it('returns empty list when no profiles need migration', async () => {
      // Create only a correctly configured profile
      const user = await db.user.create({
        data: { email: 'correct@test.com' },
      })
      await db.profile.create({
        data: {
          userId: user.id,
          username: 'correct',
          displayName: 'Correct Creator',
          country: 'Nigeria',
          countryCode: 'NG',
          currency: 'USD', // Correct!
          pricingModel: 'single',
          singleAmount: 500,
        },
      })

      const res = await app.request('/admin/migration/cross-border-profiles', {
        method: 'GET',
        headers: adminHeaders,
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.count).toBe(0)
      expect(data.migrationRequired).toBe(false)
    })
  })

  describe('POST /admin/migration/cross-border-profiles/:id', () => {
    it('migrates a profile to USD with correct pricingModel', async () => {
      const { ngProfile } = await createCrossBorderProfiles()

      const res = await app.request(
        `/admin/migration/cross-border-profiles/${ngProfile.id}`,
        {
          method: 'POST',
          headers: { ...adminHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newAmountUsd: 5,
            notifyCreator: false,
          }),
        }
      )

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data.profile.currency).toBe('USD')
      expect(data.profile.singleAmount).toBe(500) // $5 = 500 cents
      expect(data.profile.previousCurrency).toBe('NGN')

      // Verify database was updated
      const updated = await db.profile.findUnique({ where: { id: ngProfile.id } })
      expect(updated?.currency).toBe('USD')
      expect(updated?.pricingModel).toBe('single')
      // Prisma.JsonNull is stored as an object, not JavaScript null
      expect(Array.isArray(updated?.tiers)).toBe(false)
    })

    it('clears tiers and sets pricingModel to single', async () => {
      const { ghProfile } = await createCrossBorderProfiles()

      // GH profile has tiers
      const before = await db.profile.findUnique({ where: { id: ghProfile.id } })
      expect(before?.pricingModel).toBe('tiers')
      expect(before?.tiers).not.toBeNull()

      const res = await app.request(
        `/admin/migration/cross-border-profiles/${ghProfile.id}`,
        {
          method: 'POST',
          headers: { ...adminHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newAmountUsd: 10,
            notifyCreator: false,
          }),
        }
      )

      expect(res.status).toBe(200)

      // Verify tiers cleared and model changed
      const after = await db.profile.findUnique({ where: { id: ghProfile.id } })
      expect(after?.pricingModel).toBe('single')
      // Prisma.JsonNull is stored as an object, not JavaScript null
      expect(Array.isArray(after?.tiers)).toBe(false)
      expect(after?.singleAmount).toBe(1000) // $10 = 1000 cents
    })

    it('rejects non-cross-border profiles', async () => {
      const { usProfile } = await createCrossBorderProfiles()

      const res = await app.request(
        `/admin/migration/cross-border-profiles/${usProfile.id}`,
        {
          method: 'POST',
          headers: { ...adminHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newAmountUsd: 5,
            notifyCreator: false,
          }),
        }
      )

      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toContain('not in a cross-border country')
    })

    it('rejects profiles already using USD', async () => {
      const { ngUsdProfile } = await createCrossBorderProfiles()

      const res = await app.request(
        `/admin/migration/cross-border-profiles/${ngUsdProfile.id}`,
        {
          method: 'POST',
          headers: { ...adminHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newAmountUsd: 5,
            notifyCreator: false,
          }),
        }
      )

      expect(res.status).toBe(400)
      const data = await res.json()
      expect(data.error).toContain('already uses USD')
    })

    it('rejects decimal amounts', async () => {
      const { ngProfile } = await createCrossBorderProfiles()

      const res = await app.request(
        `/admin/migration/cross-border-profiles/${ngProfile.id}`,
        {
          method: 'POST',
          headers: { ...adminHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newAmountUsd: 5.5, // Decimal not allowed
            notifyCreator: false,
          }),
        }
      )

      expect(res.status).toBe(400)
    })

    it('rejects amounts below minimum', async () => {
      const { ngProfile } = await createCrossBorderProfiles()

      const res = await app.request(
        `/admin/migration/cross-border-profiles/${ngProfile.id}`,
        {
          method: 'POST',
          headers: { ...adminHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newAmountUsd: 0, // Below minimum
            notifyCreator: false,
          }),
        }
      )

      expect(res.status).toBe(400)
    })

    it('returns 404 for non-existent profile', async () => {
      const res = await app.request(
        '/admin/migration/cross-border-profiles/nonexistent-id',
        {
          method: 'POST',
          headers: { ...adminHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newAmountUsd: 5,
            notifyCreator: false,
          }),
        }
      )

      expect(res.status).toBe(404)
    })
  })

  describe('POST /admin/migration/cross-border-profiles/batch', () => {
    it('returns dry run preview without modifying data', async () => {
      const { ngProfile, ghProfile } = await createCrossBorderProfiles()

      const res = await app.request(
        '/admin/migration/cross-border-profiles/batch',
        {
          method: 'POST',
          headers: { ...adminHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            defaultAmountUsd: 5,
            maxProfiles: 10,
            dryRun: true, // Default
          }),
        }
      )

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.dryRun).toBe(true)
      expect(data.wouldMigrate).toBe(3) // NG, GH, ZA all need migration

      // Verify data was NOT modified
      const ng = await db.profile.findUnique({ where: { id: ngProfile.id } })
      const gh = await db.profile.findUnique({ where: { id: ghProfile.id } })
      expect(ng?.currency).toBe('NGN') // Still wrong
      expect(gh?.currency).toBe('GHS') // Still wrong
    })

    it('migrates profiles when dryRun is false', async () => {
      const { ngProfile, ghProfile } = await createCrossBorderProfiles()

      const res = await app.request(
        '/admin/migration/cross-border-profiles/batch',
        {
          method: 'POST',
          headers: { ...adminHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            defaultAmountUsd: 5,
            maxProfiles: 10,
            dryRun: false,
            notifyCreators: false,
          }),
        }
      )

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
      expect(data.migrated).toBe(3) // NG, GH, ZA all migrated

      // Verify data WAS modified
      const ng = await db.profile.findUnique({ where: { id: ngProfile.id } })
      const gh = await db.profile.findUnique({ where: { id: ghProfile.id } })
      expect(ng?.currency).toBe('USD')
      expect(ng?.pricingModel).toBe('single')
      expect(ng?.singleAmount).toBe(500)
      expect(gh?.currency).toBe('USD')
      expect(gh?.pricingModel).toBe('single')
      expect(gh?.singleAmount).toBe(500)
    })

    it('respects maxProfiles limit', async () => {
      await createCrossBorderProfiles() // Creates 2 profiles needing migration

      const res = await app.request(
        '/admin/migration/cross-border-profiles/batch',
        {
          method: 'POST',
          headers: { ...adminHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            defaultAmountUsd: 5,
            maxProfiles: 1, // Only migrate 1
            dryRun: false,
            notifyCreators: false,
          }),
        }
      )

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.migrated).toBe(1) // Only 1 migrated due to limit
    })

    it('returns success with 0 migrated when no profiles need migration', async () => {
      // Create only correctly configured profile
      const user = await db.user.create({
        data: { email: 'correct@test.com' },
      })
      await db.profile.create({
        data: {
          userId: user.id,
          username: 'correct',
          displayName: 'Correct',
          country: 'Nigeria',
          countryCode: 'NG',
          currency: 'USD',
          pricingModel: 'single',
          singleAmount: 500,
        },
      })

      const res = await app.request(
        '/admin/migration/cross-border-profiles/batch',
        {
          method: 'POST',
          headers: { ...adminHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            defaultAmountUsd: 5,
            dryRun: false,
          }),
        }
      )

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.migrated).toBe(0)
    })

    it('rejects decimal amounts', async () => {
      await createCrossBorderProfiles()

      const res = await app.request(
        '/admin/migration/cross-border-profiles/batch',
        {
          method: 'POST',
          headers: { ...adminHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            defaultAmountUsd: 5.5, // Decimal not allowed
            dryRun: false,
          }),
        }
      )

      expect(res.status).toBe(400)
    })
  })
})
