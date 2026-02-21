/**
 * Cancel Token Utility
 *
 * Generates and validates signed tokens for 1-click subscription cancellation.
 * Tokens are used in pre-billing reminder emails (Visa-compliant).
 *
 * Token format: base64url(subscriptionId:nonce:expires:signature)
 * - subscriptionId: UUID of the subscription
 * - nonce: Random string for revocation (stored in DB, can be rotated)
 * - expires: Unix timestamp (seconds) when token expires
 * - signature: HMAC-SHA256 of subscriptionId:nonce:expires using SESSION_SECRET
 *
 * Tokens expire after 30 days (covers 7-day to 1-day reminder window).
 * Tokens can be revoked by rotating the subscription's manageTokenNonce.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { env } from '../config/env.js'

// Token validity: 30 days
const TOKEN_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Generate a random nonce for token revocation
 * Store this in the subscription record and include in tokens
 * Rotating this nonce invalidates all outstanding tokens
 */
export function generateTokenNonce(): string {
  return randomBytes(16).toString('base64url')
}

/**
 * Generate a signed cancel token for a subscription
 * @param subscriptionId - The subscription UUID
 * @param nonce - Optional nonce for revocation (if not provided, token cannot be revoked)
 * @returns Base64URL-encoded token string
 */
export function generateCancelToken(subscriptionId: string, nonce?: string | null): string {
  const expires = Math.floor((Date.now() + TOKEN_VALIDITY_MS) / 1000)
  // Use nonce if provided, otherwise use empty string (backwards compatible)
  const nonceValue = nonce || ''
  const payload = `${subscriptionId}:${nonceValue}:${expires}`
  const signature = createHmac('sha256', env.SESSION_SECRET)
    .update(payload)
    .digest('base64url')

  const token = Buffer.from(`${payload}:${signature}`).toString('base64url')
  return token
}

/**
 * Validate and decode a cancel token
 * @param token - Base64URL-encoded token string
 * @returns Object with subscriptionId and nonce if valid, null if invalid/expired
 * Note: Caller must verify nonce matches database if nonce-based revocation is enabled
 */
export function validateCancelToken(token: string): { subscriptionId: string; nonce: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const parts = decoded.split(':')

    // Support both old format (3 parts) and new format (4 parts with nonce)
    if (parts.length === 3) {
      // Old format: subscriptionId:expires:signature (no nonce)
      const [subscriptionId, expiresStr, providedSignature] = parts
      const expires = parseInt(expiresStr, 10)

      if (isNaN(expires) || expires < Math.floor(Date.now() / 1000)) {
        return null
      }

      const payload = `${subscriptionId}:${expires}`
      const expectedSignature = createHmac('sha256', env.SESSION_SECRET)
        .update(payload)
        .digest('base64url')

      if (!timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))) {
        return null
      }

      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subscriptionId)) {
        return null
      }

      return { subscriptionId, nonce: '' }
    }

    if (parts.length !== 4) {
      return null
    }

    // New format: subscriptionId:nonce:expires:signature
    const [subscriptionId, nonce, expiresStr, providedSignature] = parts
    const expires = parseInt(expiresStr, 10)

    // Check expiration
    if (isNaN(expires) || expires < Math.floor(Date.now() / 1000)) {
      return null
    }

    // Verify signature
    const payload = `${subscriptionId}:${nonce}:${expires}`
    const expectedSignature = createHmac('sha256', env.SESSION_SECRET)
      .update(payload)
      .digest('base64url')

    if (!timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))) {
      return null
    }

    // Validate UUID format (basic check)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subscriptionId)) {
      return null
    }

    return { subscriptionId, nonce }
  } catch {
    return null
  }
}

/**
 * Generate the public cancel URL for a subscription
 * @param subscriptionId - The subscription UUID
 * @param nonce - Optional nonce for revocation
 * @returns Full URL for 1-click cancellation
 */
export function generateCancelUrl(subscriptionId: string, nonce?: string | null): string {
  const token = generateCancelToken(subscriptionId, nonce)
  return `${env.PUBLIC_PAGE_URL}/unsubscribe/${token}`
}

// ============================================
// PORTAL TOKEN - Direct access to Stripe Customer Portal
// ============================================

/**
 * Generate a signed portal token for direct Stripe portal access
 * Token encodes: customerId + subscriptionId for lookup
 * @param stripeCustomerId - Stripe customer ID (cus_xxx)
 * @param subscriptionId - Our subscription UUID (for return URL context)
 * @returns Base64URL-encoded token string
 */
export function generatePortalToken(stripeCustomerId: string, subscriptionId: string): string {
  const expires = Math.floor((Date.now() + TOKEN_VALIDITY_MS) / 1000)
  const payload = `portal:${stripeCustomerId}:${subscriptionId}:${expires}`
  const signature = createHmac('sha256', env.SESSION_SECRET)
    .update(payload)
    .digest('base64url')

  const token = Buffer.from(`${payload}:${signature}`).toString('base64url')
  return token
}

/**
 * Validate and decode a portal token
 * @param token - Base64URL-encoded token string
 * @returns Object with stripeCustomerId and subscriptionId if valid, null if invalid/expired
 */
export function validatePortalToken(token: string): { stripeCustomerId: string; subscriptionId: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const parts = decoded.split(':')

    // Format: portal:customerId:subscriptionId:expires:signature
    if (parts.length !== 5 || parts[0] !== 'portal') {
      return null
    }

    const [, stripeCustomerId, subscriptionId, expiresStr, providedSignature] = parts
    const expires = parseInt(expiresStr, 10)

    // Check expiration
    if (isNaN(expires) || expires < Math.floor(Date.now() / 1000)) {
      return null
    }

    // Verify signature
    const payload = `portal:${stripeCustomerId}:${subscriptionId}:${expires}`
    const expectedSignature = createHmac('sha256', env.SESSION_SECRET)
      .update(payload)
      .digest('base64url')

    if (!timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))) {
      return null
    }

    // Basic validation
    if (!stripeCustomerId.startsWith('cus_')) {
      return null
    }

    return { stripeCustomerId, subscriptionId }
  } catch {
    return null
  }
}

/**
 * Generate the public portal URL for direct Stripe Customer Portal access
 * @param stripeCustomerId - Stripe customer ID
 * @param subscriptionId - Our subscription UUID
 * @returns Full URL for direct portal access (no login required)
 */
export function generatePortalUrl(stripeCustomerId: string, subscriptionId: string): string {
  const token = generatePortalToken(stripeCustomerId, subscriptionId)
  return `${env.PUBLIC_PAGE_URL}/manage/${token}`
}

// ============================================
// EXPRESS DASHBOARD TOKEN - Direct access to Stripe Express Dashboard
// ============================================

/**
 * Generate a signed token for direct Stripe Express Dashboard access
 * Used in creator notification emails (new subscriber, etc.)
 * @param stripeAccountId - Stripe connected account ID (acct_xxx)
 * @returns Base64URL-encoded token string
 */
export function generateExpressDashboardToken(stripeAccountId: string): string {
  const expires = Math.floor((Date.now() + TOKEN_VALIDITY_MS) / 1000)
  const payload = `express:${stripeAccountId}:${expires}`
  const signature = createHmac('sha256', env.SESSION_SECRET)
    .update(payload)
    .digest('base64url')

  const token = Buffer.from(`${payload}:${signature}`).toString('base64url')
  return token
}

/**
 * Validate and decode an Express dashboard token
 * @param token - Base64URL-encoded token string
 * @returns Object with stripeAccountId if valid, null if invalid/expired
 */
export function validateExpressDashboardToken(token: string): { stripeAccountId: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const parts = decoded.split(':')

    // Format: express:accountId:expires:signature
    if (parts.length !== 4 || parts[0] !== 'express') {
      return null
    }

    const [, stripeAccountId, expiresStr, providedSignature] = parts
    const expires = parseInt(expiresStr, 10)

    // Check expiration
    if (isNaN(expires) || expires < Math.floor(Date.now() / 1000)) {
      return null
    }

    // Verify signature
    const payload = `express:${stripeAccountId}:${expires}`
    const expectedSignature = createHmac('sha256', env.SESSION_SECRET)
      .update(payload)
      .digest('base64url')

    if (!timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))) {
      return null
    }

    // Basic validation - Stripe account IDs start with acct_
    if (!stripeAccountId.startsWith('acct_')) {
      return null
    }

    return { stripeAccountId }
  } catch {
    return null
  }
}

/**
 * Generate the public URL for direct Stripe Express Dashboard access
 * @param stripeAccountId - Stripe connected account ID
 * @returns Full URL for direct dashboard access (no login required)
 */
export function generateExpressDashboardUrl(stripeAccountId: string): string {
  const token = generateExpressDashboardToken(stripeAccountId)
  return `${env.API_URL}/my-subscriptions/express-dashboard/${token}`
}

// ============================================
// MANAGE TOKEN - Public subscription management page
// ============================================

/**
 * Generate a signed token for the public subscription management page
 * Used in all subscriber emails for self-service management
 * @param subscriptionId - Our subscription UUID
 * @param nonce - Optional nonce for revocation
 * @returns Base64URL-encoded token string
 */
export function generateManageToken(subscriptionId: string, nonce?: string | null): string {
  const expires = Math.floor((Date.now() + TOKEN_VALIDITY_MS) / 1000)
  const nonceValue = nonce || ''
  const payload = `manage:${subscriptionId}:${nonceValue}:${expires}`
  const signature = createHmac('sha256', env.SESSION_SECRET)
    .update(payload)
    .digest('base64url')

  const token = Buffer.from(`${payload}:${signature}`).toString('base64url')
  return token
}

/**
 * Validate and decode a manage token
 * @param token - Base64URL-encoded token string
 * @returns Object with subscriptionId and nonce if valid, null if invalid/expired
 * Note: Caller must verify nonce matches database if nonce-based revocation is enabled
 */
export function validateManageToken(token: string): { subscriptionId: string; nonce: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const parts = decoded.split(':')

    // Support old format (4 parts) and new format (5 parts with nonce)
    if (parts.length === 4 && parts[0] === 'manage') {
      // Old format: manage:subscriptionId:expires:signature (no nonce)
      const [, subscriptionId, expiresStr, providedSignature] = parts
      const expires = parseInt(expiresStr, 10)

      if (isNaN(expires) || expires < Math.floor(Date.now() / 1000)) {
        return null
      }

      const payload = `manage:${subscriptionId}:${expires}`
      const expectedSignature = createHmac('sha256', env.SESSION_SECRET)
        .update(payload)
        .digest('base64url')

      if (!timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))) {
        return null
      }

      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subscriptionId)) {
        return null
      }

      return { subscriptionId, nonce: '' }
    }

    // New format: manage:subscriptionId:nonce:expires:signature
    if (parts.length !== 5 || parts[0] !== 'manage') {
      return null
    }

    const [, subscriptionId, nonce, expiresStr, providedSignature] = parts
    const expires = parseInt(expiresStr, 10)

    // Check expiration
    if (isNaN(expires) || expires < Math.floor(Date.now() / 1000)) {
      return null
    }

    // Verify signature
    const payload = `manage:${subscriptionId}:${nonce}:${expires}`
    const expectedSignature = createHmac('sha256', env.SESSION_SECRET)
      .update(payload)
      .digest('base64url')

    if (!timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))) {
      return null
    }

    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subscriptionId)) {
      return null
    }

    return { subscriptionId, nonce }
  } catch {
    return null
  }
}

/**
 * Generate the public management page URL for a subscription
 * @param subscriptionId - Our subscription UUID
 * @param nonce - Optional nonce for revocation
 * @returns Full URL for public subscription management
 */
export function generateManageUrl(subscriptionId: string, nonce?: string | null): string {
  const token = generateManageToken(subscriptionId, nonce)
  return `${env.PUBLIC_PAGE_URL}/subscription/manage/${token}`
}
