/**
 * Admin Auth Tests
 *
 * Tests authentication enforcement for admin routes.
 * Admin routes accept either:
 * 1. x-admin-api-key header matching ADMIN_API_KEY env var
 * 2. Valid session cookie for a user with admin or super_admin role
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../../src/app.js'
import { db } from '../../../src/db/client.js'
import { resetDatabase, disconnectDatabase } from '../../helpers/db.js'
import { hashToken } from '../../../src/services/auth.js'

describe('admin auth', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterAll(async () => {
    await resetDatabase()
    await disconnectDatabase()
  })

  describe('rejects unauthorized access', () => {
    it('rejects request with no auth', async () => {
      const res = await app.fetch(
        new Request('http://localhost/admin/dashboard', {
          method: 'GET',
        })
      )

      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.message).toContain('Admin access required')
    })

    it('rejects request with invalid API key', async () => {
      const res = await app.fetch(
        new Request('http://localhost/admin/dashboard', {
          method: 'GET',
          headers: {
            'x-admin-api-key': 'wrong-key',
          },
        })
      )

      expect(res.status).toBe(401)
    })

    it('rejects request with non-admin user session', async () => {
      // Create a regular user (not in admin whitelist)
      const user = await db.user.create({
        data: { email: 'regular@example.com' },
      })

      const rawToken = 'regular-user-token'
      await db.session.create({
        data: {
          userId: user.id,
          token: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 86400000),
        },
      })

      const res = await app.fetch(
        new Request('http://localhost/admin/dashboard', {
          method: 'GET',
          headers: {
            Cookie: `session=${rawToken}`,
          },
        })
      )

      expect(res.status).toBe(401)
    })

    it('rejects request with expired session', async () => {
      // Create admin user with expired session
      const user = await db.user.create({
        data: { email: 'nathan@insitepro.co', role: 'super_admin' },
      })

      const rawToken = 'expired-admin-token'
      await db.session.create({
        data: {
          userId: user.id,
          token: hashToken(rawToken),
          expiresAt: new Date(Date.now() - 86400000), // Expired yesterday
        },
      })

      const res = await app.fetch(
        new Request('http://localhost/admin/dashboard', {
          method: 'GET',
          headers: {
            Cookie: `session=${rawToken}`,
          },
        })
      )

      expect(res.status).toBe(401)
    })
  })

  describe('allows authorized access', () => {
    it('allows request with valid API key', async () => {
      const res = await app.fetch(
        new Request('http://localhost/admin/dashboard', {
          method: 'GET',
          headers: {
            'x-admin-api-key': 'test-admin-key-12345',
          },
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('users')
      expect(body).toHaveProperty('subscriptions')
      expect(body).toHaveProperty('revenue')
    })

    it('allows request with valid admin session', async () => {
      // Create admin user with super_admin role
      const user = await db.user.create({
        data: { email: 'nathan@insitepro.co', role: 'super_admin' },
      })

      const rawToken = 'admin-session-token'
      await db.session.create({
        data: {
          userId: user.id,
          token: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 86400000),
        },
      })

      const res = await app.fetch(
        new Request('http://localhost/admin/dashboard', {
          method: 'GET',
          headers: {
            Cookie: `session=${rawToken}`,
          },
        })
      )

      expect(res.status).toBe(200)
    })

    it('allows request with Bearer token auth', async () => {
      // Create admin user with super_admin role
      const user = await db.user.create({
        data: { email: 'nathan@insitepro.co', role: 'super_admin' },
      })

      const rawToken = 'bearer-admin-token'
      await db.session.create({
        data: {
          userId: user.id,
          token: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 86400000),
        },
      })

      const res = await app.fetch(
        new Request('http://localhost/admin/dashboard', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${rawToken}`,
          },
        })
      )

      expect(res.status).toBe(200)
    })
  })

  describe('admin status endpoint', () => {
    it('returns isAdmin false without leaking identity', async () => {
      const res = await app.fetch(
        new Request('http://localhost/admin/me', {
          method: 'GET',
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toMatchObject({ isAdmin: false })
      expect(body).not.toHaveProperty('email')
      expect(body).not.toHaveProperty('role')
    })

    it('returns isAdmin false for non-admin session', async () => {
      const user = await db.user.create({
        data: { email: 'user@test.com', role: 'user' },
      })

      const rawToken = 'non-admin-session'
      await db.session.create({
        data: {
          userId: user.id,
          token: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 86400000),
        },
      })

      const res = await app.fetch(
        new Request('http://localhost/admin/me', {
          method: 'GET',
          headers: {
            Cookie: `session=${rawToken}`,
          },
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toMatchObject({ isAdmin: false })
      expect(body).not.toHaveProperty('email')
      expect(body).not.toHaveProperty('role')
    })

    it('returns admin role details for admin session', async () => {
      const user = await db.user.create({
        data: { email: 'admin@test.com', role: 'admin' },
      })

      const rawToken = 'admin-me-token'
      await db.session.create({
        data: {
          userId: user.id,
          token: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 86400000),
        },
      })

      const res = await app.fetch(
        new Request('http://localhost/admin/me', {
          method: 'GET',
          headers: {
            Cookie: `session=${rawToken}`,
          },
        })
      )

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toMatchObject({
        isAdmin: true,
        email: 'admin@test.com',
        role: 'admin',
      })
    })
  })

  describe('protects all admin routes', () => {
    const protectedRoutes = [
      { method: 'GET', path: '/admin/dashboard' },
      { method: 'GET', path: '/admin/users' },
      { method: 'GET', path: '/admin/payments' },
      { method: 'GET', path: '/admin/subscriptions' },
      { method: 'GET', path: '/admin/disputes' },
      { method: 'GET', path: '/admin/disputes/stats' },
      { method: 'GET', path: '/admin/blocked-subscribers' },
      { method: 'GET', path: '/admin/activity' },
      { method: 'GET', path: '/admin/webhooks/stats' },
      { method: 'GET', path: '/admin/health' },
    ]

    for (const route of protectedRoutes) {
      it(`protects ${route.method} ${route.path}`, async () => {
        const res = await app.fetch(
          new Request(`http://localhost${route.path}`, {
            method: route.method,
          })
        )

        expect(res.status).toBe(401)
      })
    }
  })

  describe('role-based access control', () => {
    it('allows admin role to access read endpoints', async () => {
      const user = await db.user.create({
        data: { email: 'admin-readonly@test.com', role: 'admin' },
      })

      const rawToken = 'admin-readonly-token'
      await db.session.create({
        data: {
          userId: user.id,
          token: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 86400000),
        },
      })

      const res = await app.fetch(
        new Request('http://localhost/admin/dashboard', {
          method: 'GET',
          headers: {
            Cookie: `session=${rawToken}`,
          },
        })
      )

      expect(res.status).toBe(200)
    })

    it('blocks admin role from super_admin endpoints (403)', async () => {
      const user = await db.user.create({
        data: { email: 'admin-limited@test.com', role: 'admin' },
      })

      const rawToken = 'admin-limited-token'
      await db.session.create({
        data: {
          userId: user.id,
          token: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 86400000),
        },
      })

      // Try to access a super_admin-only endpoint
      const res = await app.fetch(
        new Request('http://localhost/admin/reconciliation/run', {
          method: 'POST',
          headers: {
            Cookie: `session=${rawToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        })
      )

      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.message).toContain('super_admin')
    })

    it('allows super_admin to access super_admin endpoints', async () => {
      const user = await db.user.create({
        data: { email: 'superadmin@test.com', role: 'super_admin' },
      })

      const rawToken = 'superadmin-token'
      await db.session.create({
        data: {
          userId: user.id,
          token: hashToken(rawToken),
          expiresAt: new Date(Date.now() + 86400000),
        },
      })

      // Super admin should get past auth (may fail for other reasons like no data, but not 403)
      const res = await app.fetch(
        new Request('http://localhost/admin/reconciliation/run', {
          method: 'POST',
          headers: {
            Cookie: `session=${rawToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        })
      )

      // Should not be 403 (forbidden) - it will be 200 or some other status
      expect(res.status).not.toBe(403)
      expect(res.status).not.toBe(401)
    })
  })
})
