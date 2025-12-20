/**
 * Admin Auth Tests
 *
 * Tests authentication enforcement for admin routes.
 * Admin routes accept either:
 * 1. x-admin-api-key header matching ADMIN_API_KEY env var
 * 2. Valid session cookie for a user in ADMIN_EMAILS whitelist
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
        data: { email: 'nathan@insitepro.co' }, // Admin email
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
      // Create admin user
      const user = await db.user.create({
        data: { email: 'nathan@insitepro.co' }, // In ADMIN_EMAILS whitelist
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
      // Create admin user
      const user = await db.user.create({
        data: { email: 'nathan@insitepro.co' },
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
})
