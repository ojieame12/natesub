import { createHash, randomBytes } from 'crypto'
import { nanoid } from 'nanoid'
import { db } from '../db/client.js'
import { redis } from '../db/redis.js'
import { env } from '../config/env.js'
import { sendOtpEmail } from './email.js'

const OTP_EXPIRES_MS = parseInt(env.MAGIC_LINK_EXPIRES_MINUTES) * 60 * 1000
const SESSION_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// Hash token for storage (never store raw tokens)
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// Generate a secure session token
function generateToken(): string {
  return randomBytes(32).toString('hex')
}

// Generate a 6-digit OTP code
function generateOtp(): string {
  // Generate cryptographically secure random 6-digit number
  const bytes = randomBytes(3)
  const num = (bytes[0] << 16 | bytes[1] << 8 | bytes[2]) % 1000000
  return num.toString().padStart(6, '0')
}

// Request an OTP code
export async function requestMagicLink(email: string): Promise<{ success: boolean }> {
  const normalizedEmail = email.toLowerCase().trim()

  // Rate limit: max 3 requests per email per 10 minutes
  const rateLimitKey = `otp_rate:${normalizedEmail}`
  const attempts = await redis.incr(rateLimitKey)
  if (attempts === 1) {
    await redis.expire(rateLimitKey, 600) // 10 minutes
  }
  if (attempts > 3) {
    throw new Error('Too many requests. Please try again later.')
  }

  // Invalidate any existing OTPs for this email
  await db.magicLinkToken.updateMany({
    where: {
      email: normalizedEmail,
      usedAt: null,
    },
    data: {
      usedAt: new Date(), // Mark as used to invalidate
    },
  })

  // Generate 6-digit OTP
  const otp = generateOtp()
  const otpHash = hashToken(otp)
  const expiresAt = new Date(Date.now() + OTP_EXPIRES_MS)

  // Store in database (reusing magicLinkToken table)
  await db.magicLinkToken.create({
    data: {
      email: normalizedEmail,
      tokenHash: otpHash,
      expiresAt,
    },
  })

  // Send OTP email
  await sendOtpEmail(normalizedEmail, otp)

  return { success: true }
}

// Verify OTP code
export async function verifyMagicLink(token: string): Promise<{ sessionToken: string; userId: string }> {
  const tokenHash = hashToken(token)

  // Find token
  const magicLinkToken = await db.magicLinkToken.findUnique({
    where: { tokenHash },
  })

  if (!magicLinkToken) {
    throw new Error('Invalid code')
  }

  if (magicLinkToken.usedAt) {
    throw new Error('This code has already been used')
  }

  if (magicLinkToken.expiresAt < new Date()) {
    throw new Error('This code has expired')
  }

  // Mark token as used
  await db.magicLinkToken.update({
    where: { id: magicLinkToken.id },
    data: { usedAt: new Date() },
  })

  // Find or create user
  let user = await db.user.findUnique({
    where: { email: magicLinkToken.email },
  })

  if (!user) {
    user = await db.user.create({
      data: {
        email: magicLinkToken.email,
      },
    })
  }

  // Update last login
  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  })

  // Create session
  const sessionToken = generateToken()
  const sessionTokenHash = hashToken(sessionToken)
  const sessionExpiresAt = new Date(Date.now() + SESSION_EXPIRES_MS)

  await db.session.create({
    data: {
      userId: user.id,
      token: sessionTokenHash,
      expiresAt: sessionExpiresAt,
    },
  })

  return {
    sessionToken,
    userId: user.id,
  }
}

// Validate session token
export async function validateSession(sessionToken: string): Promise<{ userId: string } | null> {
  const tokenHash = hashToken(sessionToken)

  const session = await db.session.findUnique({
    where: { token: tokenHash },
    include: { user: true },
  })

  if (!session) {
    return null
  }

  if (session.expiresAt < new Date()) {
    // Clean up expired session
    await db.session.delete({ where: { id: session.id } })
    return null
  }

  return { userId: session.userId }
}

// Logout (delete session)
export async function logout(sessionToken: string): Promise<void> {
  const tokenHash = hashToken(sessionToken)

  await db.session.deleteMany({
    where: { token: tokenHash },
  })
}

// Get current user
export async function getCurrentUser(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  })

  return user
}
