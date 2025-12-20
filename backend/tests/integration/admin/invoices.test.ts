/**
 * Admin Invoices Tests
 *
 * Tests for invoice/request tracking:
 * - GET /admin/invoices
 *
 * Notes:
 * - Invoices are requests with dueDate set.
 * - Requests use status=accepted when paid; admin API exposes this as "paid".
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import app from '../../../src/app.js'
import { db } from '../../../src/db/client.js'
import { resetDatabase, disconnectDatabase } from '../../helpers/db.js'

const adminHeaders = {
  'x-admin-api-key': 'test-admin-key-12345',
}

describe('admin invoices', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterAll(async () => {
    await resetDatabase()
    await disconnectDatabase()
  })

  async function seedInvoices() {
    const creator = await db.user.create({
      data: { email: 'creator@test.com' },
    })

    await db.profile.create({
      data: {
        userId: creator.id,
        username: 'creator',
        displayName: 'Creator',
        country: 'US',
        countryCode: 'US',
        currency: 'USD',
        purpose: 'tips',
        pricingModel: 'single',
      },
    })

    const dueDate = new Date('2024-06-20T00:00:00Z')

    const invoicePaid = await db.request.create({
      data: {
        creatorId: creator.id,
        recipientName: 'Alice',
        recipientEmail: 'alice@example.com',
        amountCents: 2500,
        currency: 'USD',
        status: 'accepted',
        dueDate,
      },
    })

    const invoiceSent = await db.request.create({
      data: {
        creatorId: creator.id,
        recipientName: 'Bob',
        recipientEmail: 'bob@example.com',
        amountCents: 1500,
        currency: 'USD',
        status: 'sent',
        dueDate,
      },
    })

    const invoiceDraft = await db.request.create({
      data: {
        creatorId: creator.id,
        recipientName: 'Carol',
        recipientEmail: 'carol@example.com',
        amountCents: 500,
        currency: 'USD',
        status: 'draft',
        dueDate,
      },
    })

    return { invoicePaid, invoiceSent, invoiceDraft }
  }

  it('lists invoices and maps accepted -> paid', async () => {
    const { invoicePaid } = await seedInvoices()

    const res = await app.fetch(
      new Request('http://localhost/admin/invoices', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    const paid = body.invoices.find((i: any) => i.id === invoicePaid.id)
    expect(paid).toBeDefined()
    expect(paid.status).toBe('paid')
  })

  it('filters invoices by paid alias', async () => {
    const { invoicePaid, invoiceSent } = await seedInvoices()

    const res = await app.fetch(
      new Request('http://localhost/admin/invoices?status=paid', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    const ids = new Set(body.invoices.map((i: any) => i.id))
    expect(ids.has(invoicePaid.id)).toBe(true)
    expect(ids.has(invoiceSent.id)).toBe(false)
    expect(body.invoices[0].status).toBe('paid')
  })

  it('returns 400 for invalid status', async () => {
    await seedInvoices()

    const res = await app.fetch(
      new Request('http://localhost/admin/invoices?status=not-a-real-status', {
        method: 'GET',
        headers: adminHeaders,
      })
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid request')
    expect(Array.isArray(body.issues)).toBe(true)
  })
})

