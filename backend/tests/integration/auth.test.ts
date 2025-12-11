import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../../src/app.js'
import { db } from '../../src/db/client.js'
import { resetDatabase, disconnectDatabase } from '../helpers/db.js'

const mockSendMagicLinkEmail = vi.fn()

// Mock email to keep tests offline
vi.mock('../../src/services/email.js', () => ({
  sendMagicLinkEmail: (email: string, link: string) => {
    mockSendMagicLinkEmail(email, link)
    return Promise.resolve()
  },
  sendWelcomeEmail: vi.fn(),
  sendNewSubscriberEmail: vi.fn(),
  sendRequestEmail: vi.fn(),
  sendUpdateEmail: vi.fn(),
}))

describe('auth magic link flow', () => {
  beforeEach(async () => {
    await resetDatabase()
    mockSendMagicLinkEmail.mockReset()
  })

  afterAll(async () => {
    await resetDatabase()
    await disconnectDatabase()
  })

  it('sends a magic link and stores the token', async () => {
    const res = await app.fetch(
      new Request('http://localhost/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com' }),
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ success: true })
    expect(mockSendMagicLinkEmail).toHaveBeenCalledTimes(1)

    const storedToken = await db.magicLinkToken.findFirst({
      where: { email: 'test@example.com' },
    })
    expect(storedToken).not.toBeNull()
  })

  it('verifies a magic link and issues a session cookie', async () => {
    // Request magic link
    await app.fetch(
      new Request('http://localhost/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'flow@example.com' }),
      })
    )

    expect(mockSendMagicLinkEmail).toHaveBeenCalledTimes(1)
    const magicLink = mockSendMagicLinkEmail.mock.calls[0]?.[1] as string
    const token = magicLink ? new URL(magicLink).searchParams.get('token') : null
    expect(token).toBeTruthy()

    const verifyRes = await app.fetch(
      new Request(`http://localhost/auth/verify?token=${token}`)
    )

    expect(verifyRes.status).toBe(200)
    const verifyBody = await verifyRes.json()
    expect(verifyBody).toMatchObject({ success: true })

    const setCookie = verifyRes.headers.get('set-cookie') || ''
    expect(setCookie).toContain('session=')

    const user = await db.user.findUnique({
      where: { email: 'flow@example.com' },
    })
    expect(user).not.toBeNull()

    const session = await db.session.findFirst({
      where: { userId: user?.id },
    })
    expect(session).not.toBeNull()
  })
})
