/**
 * Cancel Token Utility
 *
 * Generates and validates signed tokens for 1-click subscription cancellation.
 * Tokens are used in pre-billing reminder emails (Visa-compliant).
 *
 * Token format: base64url(subscriptionId:expires:signature)
 * - subscriptionId: UUID of the subscription
 * - expires: Unix timestamp (seconds) when token expires
 * - signature: HMAC-SHA256 of subscriptionId:expires using SESSION_SECRET
 *
 * Tokens expire after 30 days (covers 7-day to 1-day reminder window).
 */

import { createHmac } from 'crypto'
import { env } from '../config/env.js'

// Token validity: 30 days
const TOKEN_VALIDITY_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Generate a signed cancel token for a subscription
 * @param subscriptionId - The subscription UUID
 * @returns Base64URL-encoded token string
 */
export function generateCancelToken(subscriptionId: string): string {
  const expires = Math.floor((Date.now() + TOKEN_VALIDITY_MS) / 1000)
  const payload = `${subscriptionId}:${expires}`
  const signature = createHmac('sha256', env.SESSION_SECRET)
    .update(payload)
    .digest('base64url')

  const token = Buffer.from(`${payload}:${signature}`).toString('base64url')
  return token
}

/**
 * Validate and decode a cancel token
 * @param token - Base64URL-encoded token string
 * @returns Object with subscriptionId if valid, null if invalid/expired
 */
export function validateCancelToken(token: string): { subscriptionId: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const parts = decoded.split(':')

    if (parts.length !== 3) {
      return null
    }

    const [subscriptionId, expiresStr, providedSignature] = parts
    const expires = parseInt(expiresStr, 10)

    // Check expiration
    if (isNaN(expires) || expires < Math.floor(Date.now() / 1000)) {
      return null
    }

    // Verify signature
    const payload = `${subscriptionId}:${expires}`
    const expectedSignature = createHmac('sha256', env.SESSION_SECRET)
      .update(payload)
      .digest('base64url')

    if (providedSignature !== expectedSignature) {
      return null
    }

    // Validate UUID format (basic check)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subscriptionId)) {
      return null
    }

    return { subscriptionId }
  } catch {
    return null
  }
}

/**
 * Generate the public cancel URL for a subscription
 * @param subscriptionId - The subscription UUID
 * @returns Full URL for 1-click cancellation
 */
export function generateCancelUrl(subscriptionId: string): string {
  const token = generateCancelToken(subscriptionId)
  return `${env.APP_URL}/unsubscribe/${token}`
}
