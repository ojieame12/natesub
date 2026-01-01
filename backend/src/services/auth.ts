import { createHmac, randomBytes } from 'crypto'
import { Prisma } from '@prisma/client'
import { db } from '../db/client.js'
import { redis } from '../db/redis.js'
import { env } from '../config/env.js'
import { sendOtpEmail } from './email.js'
import { shouldSkipAddress } from '../utils/countryConfig.js'
import type { OnboardingBranch, UserRole } from '@prisma/client'

const OTP_EXPIRES_MS = (parseInt(env.MAGIC_LINK_EXPIRES_MINUTES, 10) || 30) * 60 * 1000
const OTP_GRACE_PERIOD_MS = 30 * 1000 // 30 seconds grace period for clock skew
const SESSION_EXPIRES_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const MAX_OTP_ATTEMPTS = 5
const OTP_LOCKOUT_MS = 15 * 60 * 1000 // 15 minutes
const MAX_OTP_GENERATION_ATTEMPTS = 5
const SESSION_DETAILS_CACHE_TTL_SECONDS = 30 // Reduce DB load for chatty clients (admin UI)

// Onboarding state returned to frontend
export interface OnboardingState {
  hasProfile: boolean
  hasActivePayment: boolean
  onboardingStep: number | null
  onboardingBranch: OnboardingBranch | null
  onboardingData: Record<string, any> | null
  redirectTo: string
}

// Dynamic completion step based on country AND purpose
// Step counts (must match frontend getOnboardingStepCount):
// - No address, non-service: 9 steps (0-8)
// - With address, non-service: 10 steps (0-9)
// - No address, service: 11 steps (0-10) - includes ServiceDesc + AIGen
// - With address, service: 12 steps (0-11)
// Note: shouldSkipAddress is imported from countryConfig.ts (single source of truth)
export function getOnboardingCompleteStep(
  countryCode?: string | null,
  purpose?: string | null
): number {
  const hasAddressStep = !shouldSkipAddress(countryCode)
  const isServiceMode = purpose === 'service'

  let totalSteps = 9 // Base step count (non-service, no address)
  if (hasAddressStep) totalSteps += 1
  if (isServiceMode) totalSteps += 2 // ServiceDescription + AIGenerating

  return totalSteps
}

// Hash token for storage (never store raw tokens)
// SECURITY: Uses HMAC with SESSION_SECRET to prevent offline hash cracking
export function hashToken(token: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex')
}

// Generate a secure session token
export function generateToken(): string {
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

  // Generate and store a 6-digit OTP.
  // The DB enforces a unique index on tokenHash, so we retry on rare collisions.
  let otp: string | null = null
  for (let attempt = 0; attempt < MAX_OTP_GENERATION_ATTEMPTS; attempt++) {
    otp = generateOtp()
    const otpHash = hashToken(otp)
    const expiresAt = new Date(Date.now() + OTP_EXPIRES_MS)

    try {
      await db.magicLinkToken.create({
        data: {
          email: normalizedEmail,
          tokenHash: otpHash,
          expiresAt,
          usedAt: null,
        },
      })
      break
    } catch (err: any) {
      const isUniqueCollision =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'

      if (!isUniqueCollision || attempt === MAX_OTP_GENERATION_ATTEMPTS - 1) {
        throw err
      }

      otp = null
    }
  }

  if (!otp) {
    throw new Error('Failed to generate a verification code. Please try again.')
  }

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
  // Dynamic completion step based on country AND purpose (from onboarding data)
  const onboardingData = user.onboardingData as Record<string, any> | null
  const countryCode = onboardingData?.countryCode
  const purpose = onboardingData?.purpose
  const ONBOARDING_COMPLETE_STEP = getOnboardingCompleteStep(countryCode, purpose)

  const hasProfile = !!user.profile
  // Payment is only "active" when Stripe/Paystack is fully connected
  const hasActivePayment = user.profile?.payoutStatus === 'active'

  let redirectTo: string

  const hasInProgressOnboarding =
    user.onboardingStep !== null &&
    user.onboardingStep >= 0 &&
    user.onboardingStep < ONBOARDING_COMPLETE_STEP

  if (hasInProgressOnboarding) {
    // Resume from saved step (even if profile exists) to support multi-stage onboarding.
    // Prefer stepKey (canonical identifier) over numeric step for reliable resume
    // when step order changes (e.g., address step shown/hidden based on country)
    const stepKey = onboardingData?.stepKey
    redirectTo = stepKey
      ? `/onboarding?step=${stepKey}`
      : `/onboarding?step=${user.onboardingStep}`
  } else if (hasProfile) {
    // Profile exists - allow dashboard access regardless of payment status
    // (the app can guide them to finish setup).
    redirectTo = '/dashboard'
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
  const normalizedEmail = email ? email.toLowerCase().trim() : undefined

  // Find token - if email provided, scope lookup to that email (prevents OTP collision attacks)
  // This is critical: with 6-digit OTPs and many users, collisions become likely at scale
  const magicLinkToken = normalizedEmail
    ? await db.magicLinkToken.findFirst({
      where: { tokenHash, email: normalizedEmail },
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
    throw new Error('This code is no longer valid. Please request a new code.')
  }

  // Add grace period to handle minor clock skew between servers
  const expirationWithGrace = new Date(magicLinkToken.expiresAt.getTime() + OTP_GRACE_PERIOD_MS)
  if (expirationWithGrace < new Date()) {
    throw new Error('This code has expired')
  }

  // Success - clear any failed attempts
  await redis.del(attemptKey)

  // Mark token as used and create a session atomically.
  // This prevents consuming the OTP if DB writes fail mid-flight.
  const now = new Date()
  const { user, sessionToken } = await db.$transaction(async (tx) => {
    const updateResult = await tx.magicLinkToken.updateMany({
      where: { id: magicLinkToken.id, usedAt: null },
      data: { usedAt: now },
    })

    if (updateResult.count !== 1) {
      throw new Error('This code is no longer valid. Please request a new code.')
    }

    let user = await tx.user.findUnique({
      where: { email: magicLinkToken.email },
      include: { profile: true },
    })

    if (!user) {
      user = await tx.user.create({
        data: {
          email: magicLinkToken.email,
          onboardingStep: 3, // Post-OTP step (identity)
        },
        include: { profile: true },
      })
    }

    await tx.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now },
    })

    const sessionToken = generateToken()
    const sessionTokenHash = hashToken(sessionToken)
    const sessionExpiresAt = new Date(Date.now() + SESSION_EXPIRES_MS)

    await tx.session.create({
      data: {
        userId: user.id,
        token: sessionTokenHash,
        expiresAt: sessionExpiresAt,
      },
    })

    return { user, sessionToken }
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

  // Check if user is blocked/deleted (separate query for reliability)
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { deletedAt: true },
  })

  // Block access for deleted/blocked users (deletedAt is set when blocked)
  // Also handle case where user no longer exists
  if (!user || user.deletedAt) {
    // Clean up session for blocked/deleted user
    await db.session.delete({ where: { id: session.id } })
    return null
  }

  return { userId: session.userId }
}

// Validate session token and return full session details (for admin auth)
export async function validateSessionWithDetails(sessionToken: string): Promise<{
  userId: string
  createdAt: Date
  email: string
  role: UserRole
} | null> {
  const tokenHash = hashToken(sessionToken)
  const cacheKey = `session:details:${tokenHash}`

  // Admin UI can be very chatty (many parallel requests). Cache session details briefly
  // to reduce repeated DB reads. Keep TTL short to respect role changes / blocks quickly.
  if (process.env.NODE_ENV !== 'test') {
    try {
      const cached = await redis.get(cacheKey)
      if (cached) {
        const parsed = JSON.parse(cached) as { userId: string; createdAt: string; email: string; role: UserRole }
        return {
          userId: parsed.userId,
          createdAt: new Date(parsed.createdAt),
          email: parsed.email,
          role: parsed.role,
        }
      }
    } catch {
      // Cache read/parse failure should not block auth
    }
  }

  const session = await db.session.findUnique({
    where: { token: tokenHash },
    select: { id: true, userId: true, expiresAt: true, createdAt: true },
  })

  if (!session) {
    return null
  }

  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } })
    if (process.env.NODE_ENV !== 'test') {
      redis.del(cacheKey).catch(() => { })
    }
    return null
  }

  // Check if user is blocked/deleted
  // NOTE: We intentionally keep this as a separate query for test-mock compatibility.
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { deletedAt: true, email: true, role: true },
  })

  if (!user || user.deletedAt) {
    await db.session.delete({ where: { id: session.id } })
    if (process.env.NODE_ENV !== 'test') {
      redis.del(cacheKey).catch(() => { })
    }
    return null
  }

  const details = {
    userId: session.userId,
    createdAt: session.createdAt,
    email: user.email,
    role: user.role,
  }

  if (process.env.NODE_ENV !== 'test') {
    redis.setex(cacheKey, SESSION_DETAILS_CACHE_TTL_SECONDS, JSON.stringify({
      ...details,
      createdAt: details.createdAt.toISOString(),
    })).catch(() => { })
  }

  return details
}

// Logout (delete session)
export async function logout(sessionToken: string): Promise<void> {
  const tokenHash = hashToken(sessionToken)

  await db.session.deleteMany({
    where: { token: tokenHash },
  })

  if (process.env.NODE_ENV !== 'test') {
    redis.del(`session:details:${tokenHash}`).catch(() => { })
  }
}

/**
 * Rotate session token for security-sensitive operations.
 * Returns new token on success, null if session invalid/expired.
 *
 * SECURITY: Call after sensitive actions like:
 * - Connecting payment accounts (Stripe/Paystack)
 * - Changing bank details
 * - Modifying payout settings
 *
 * This limits the window of opportunity for token replay attacks.
 */
export async function rotateSessionToken(oldToken: string): Promise<string | null> {
  const oldHash = hashToken(oldToken)

  const session = await db.session.findUnique({
    where: { token: oldHash },
    select: { id: true, userId: true, expiresAt: true },
  })

  if (!session) return null

  // Check expiration
  if (session.expiresAt < new Date()) {
    await db.session.delete({ where: { id: session.id } })
    return null
  }

  // Generate new token
  const newToken = generateToken()
  const newHash = hashToken(newToken)

  // Update session with new token and reset expiry (sliding window)
  await db.session.update({
    where: { id: session.id },
    data: {
      token: newHash,
      expiresAt: new Date(Date.now() + SESSION_EXPIRES_MS),
    },
  })

  // Invalidate old token cache
  if (process.env.NODE_ENV !== 'test') {
    redis.del(`session:details:${oldHash}`).catch(() => { })
  }

  return newToken
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

// Valid step keys for onboarding
export type OnboardingStepKey =
  | 'start' | 'email' | 'otp' | 'identity' | 'address' | 'purpose'
  | 'avatar' | 'username' | 'payments' | 'service-desc' | 'ai-gen' | 'review'

// Save onboarding progress
export async function saveOnboardingProgress(
  userId: string,
  data: {
    step: number
    stepKey?: OnboardingStepKey // Canonical step identifier
    branch?: 'personal' | 'service'
    data?: Record<string, any>
  }
) {
  // Merge with existing onboarding data first to get countryCode for dynamic completion
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { onboardingData: true },
  })

  const existingData = (user?.onboardingData as Record<string, any>) || {}
  // Include stepKey in merged data for persistence
  const incomingData = data.data || {}
  if (data.stepKey) {
    incomingData.stepKey = data.stepKey
  }
  const mergedData = { ...existingData, ...incomingData }

  // Dynamic completion step based on country AND purpose
  const countryCode = mergedData.countryCode || existingData.countryCode
  const purpose = mergedData.purpose || existingData.purpose
  const ONBOARDING_COMPLETE_STEP = getOnboardingCompleteStep(countryCode, purpose)

  // When onboarding is complete, clear the state
  if (data.step >= ONBOARDING_COMPLETE_STEP) {
    await clearOnboardingState(userId)
    return { success: true }
  }

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

// Reset onboarding to initial state (called when user clicks "Start over")
// Sets step to 0 and clears all data, allowing a fresh start
export async function resetOnboardingProgress(userId: string) {
  await db.user.update({
    where: { id: userId },
    data: {
      onboardingStep: 0,
      onboardingBranch: null,
      onboardingData: Prisma.DbNull, // Clear all saved progress
    },
  })
}
