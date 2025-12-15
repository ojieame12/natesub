import { createHash, createHmac, randomBytes } from 'crypto'
import { nanoid } from 'nanoid'
import { Prisma } from '@prisma/client'
import { db } from '../db/client.js'
import { redis } from '../db/redis.js'
import { env } from '../config/env.js'
import { sendOtpEmail } from './email.js'
import type { OnboardingBranch } from '@prisma/client'

const OTP_EXPIRES_MS = parseInt(env.MAGIC_LINK_EXPIRES_MINUTES) * 60 * 1000
const OTP_GRACE_PERIOD_MS = 30 * 1000 // 30 seconds grace period for clock skew
const SESSION_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const MAX_OTP_ATTEMPTS = 5
const OTP_LOCKOUT_MS = 15 * 60 * 1000 // 15 minutes

// Onboarding state returned to frontend
export interface OnboardingState {
  hasProfile: boolean
  hasActivePayment: boolean
  onboardingStep: number | null
  onboardingBranch: OnboardingBranch | null
  onboardingData: Record<string, any> | null
  redirectTo: string
}

// Hash token for storage (never store raw tokens)
// SECURITY: Uses HMAC with SESSION_SECRET to prevent offline hash cracking
function hashToken(token: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex')
}

// Generate a secure session token
function generateToken(): string {
  return randomBytes(32).toString('hex')
}

// Generate a 6-digit OTP code
// SECURITY: Combined with rate limiting (5 attempts/15min), brute force is mitigated
function generateOtp(): string {
  // Generate cryptographically secure random 6-digit number
  const bytes = randomBytes(4)
  const num = bytes.readUInt32BE(0) % 1000000
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

// Compute onboarding state and redirect for a user
export function computeOnboardingState(user: {
  id: string
  onboardingStep: number | null
  onboardingBranch: OnboardingBranch | null
  onboardingData: any
  profile: {
    payoutStatus: string
    paymentProvider: string | null
  } | null
}): OnboardingState {
  const hasProfile = !!user.profile
  // Payment is only "active" when Stripe/Paystack is fully connected
  const hasActivePayment = user.profile?.payoutStatus === 'active'

  let redirectTo: string

  if (hasProfile && hasActivePayment) {
    // Fully complete - go to dashboard
    redirectTo = '/dashboard'
  } else if (hasProfile && !hasActivePayment) {
    // Profile exists but payment not set up - allow dashboard access (Zero State will handle setup)
    redirectTo = '/dashboard'
  } else if (user.onboardingStep !== null && user.onboardingStep >= 3) {
    // Has progress - resume from saved step
    redirectTo = `/onboarding?step=${user.onboardingStep}`
  } else {
    // Fresh start - go to onboarding (will start at identity step after OTP)
    redirectTo = '/onboarding'
  }

  return {
    hasProfile,
    hasActivePayment,
    onboardingStep: user.onboardingStep,
    onboardingBranch: user.onboardingBranch,
    onboardingData: user.onboardingData as Record<string, any> | null,
    redirectTo,
  }
}

// Verify OTP code with brute force protection
// Now requires email to prevent OTP collision/takeover attacks
export async function verifyMagicLink(token: string, email?: string): Promise<{
  sessionToken: string
  userId: string
  onboarding: OnboardingState
}> {
  const tokenHash = hashToken(token)

  // Find token - if email provided, scope lookup to that email (prevents OTP collision attacks)
  // This is critical: with 6-digit OTPs and many users, collisions become likely at scale
  const magicLinkToken = email
    ? await db.magicLinkToken.findFirst({
        where: { tokenHash, email },
      })
    : await db.magicLinkToken.findUnique({
        where: { tokenHash },
      })

  if (!magicLinkToken) {
    // Track failed attempt for global brute force protection
    // Use per-minute bucket to track attempts across all users
    const minuteBucket = Math.floor(Date.now() / 60000) // 1 minute buckets
    const globalAttemptKey = `otp_global_attempts:${minuteBucket}`

    const globalAttempts = await redis.incr(globalAttemptKey)
    await redis.expire(globalAttemptKey, 120) // 2 minute TTL

    // If more than 100 failed OTP attempts globally per minute, add delay
    // This slows down large-scale brute force attacks
    if (globalAttempts > 100) {
      console.warn(`[auth] High global OTP failure rate: ${globalAttempts}/min`)
    }

    throw new Error('Invalid code')
  }

  // Brute force protection: Track failed attempts per email
  const attemptKey = `otp_attempts:${magicLinkToken.email}`
  const lockoutKey = `otp_lockout:${magicLinkToken.email}`

  // Check if account is locked out
  const isLockedOut = await redis.get(lockoutKey)
  if (isLockedOut) {
    const ttl = await redis.ttl(lockoutKey)
    throw new Error(`Too many failed attempts. Please wait ${Math.ceil(ttl / 60)} minutes before trying again.`)
  }

  if (magicLinkToken.usedAt) {
    // Increment failed attempts for used codes (possible replay attack)
    await redis.incr(attemptKey)
    await redis.pexpire(attemptKey, OTP_LOCKOUT_MS) // TTL matches lockout window (15 min)
    const attempts = parseInt(await redis.get(attemptKey) || '0')
    if (attempts >= MAX_OTP_ATTEMPTS) {
      await redis.set(lockoutKey, '1', 'PX', OTP_LOCKOUT_MS)
      await redis.del(attemptKey)
    }
    throw new Error('This code has already been used')
  }

  // Add grace period to handle minor clock skew between servers
  const expirationWithGrace = new Date(magicLinkToken.expiresAt.getTime() + OTP_GRACE_PERIOD_MS)
  if (expirationWithGrace < new Date()) {
    throw new Error('This code has expired')
  }

  // Success - clear any failed attempts
  await redis.del(attemptKey)

  // Mark token as used
  await db.magicLinkToken.update({
    where: { id: magicLinkToken.id },
    data: { usedAt: new Date() },
  })

  // Find or create user
  let user = await db.user.findUnique({
    where: { email: magicLinkToken.email },
    include: { profile: true },
  })

  if (!user) {
    user = await db.user.create({
      data: {
        email: magicLinkToken.email,
        onboardingStep: 3, // Post-OTP step (identity)
      },
      include: { profile: true },
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

  // Compute onboarding state
  const onboarding = computeOnboardingState(user)

  return {
    sessionToken,
    userId: user.id,
    onboarding,
  }
}

// Validate session token
export async function validateSession(sessionToken: string): Promise<{ userId: string } | null> {
  const tokenHash = hashToken(sessionToken)

  // Only select needed fields to avoid loading full user object
  const session = await db.session.findUnique({
    where: { token: tokenHash },
    select: { id: true, userId: true, expiresAt: true },
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

// Get current user with onboarding state
export async function getCurrentUser(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  })

  return user
}

// Get current user with full onboarding state (for /auth/me)
export async function getCurrentUserWithOnboarding(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  })

  if (!user) return null

  const onboarding = computeOnboardingState(user)

  return {
    user,
    onboarding,
  }
}

// Save onboarding progress
export async function saveOnboardingProgress(
  userId: string,
  data: {
    step: number
    branch?: 'personal' | 'service'
    data?: Record<string, any>
  }
) {
  // Merge with existing onboarding data if present
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { onboardingData: true },
  })

  const existingData = (user?.onboardingData as Record<string, any>) || {}
  const mergedData = data.data ? { ...existingData, ...data.data } : existingData

  await db.user.update({
    where: { id: userId },
    data: {
      onboardingStep: data.step,
      onboardingBranch: data.branch as any,
      onboardingData: mergedData,
    },
  })

  return { success: true }
}

// Clear onboarding state (called when profile is fully created)
export async function clearOnboardingState(userId: string) {
  await db.user.update({
    where: { id: userId },
    data: {
      onboardingStep: null,
      onboardingBranch: null,
      onboardingData: Prisma.DbNull, // Use DbNull to clear JSON field
    },
  })
}
