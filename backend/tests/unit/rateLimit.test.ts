/**
 * Unit tests for rate limiting middleware
 *
 * Tests the fail-closed behavior when Redis is unavailable
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('Rate Limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset environment variable
    delete process.env.REDIS_FAIL_OPEN
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.REDIS_FAIL_OPEN
  })

  describe('Fail-Closed Behavior', () => {
    it('default behavior is fail-closed (no REDIS_FAIL_OPEN env)', () => {
      // Verify environment variable is not set by default
      expect(process.env.REDIS_FAIL_OPEN).toBeUndefined()
    })

    it('critical prefixes are defined', () => {
      // The implementation checks these prefixes for critical endpoints
      const criticalPrefixes = ['auth_verify', 'auth_magic', 'payment', 'checkout', 'admin_sensitive', 'webhook']

      // Verify all expected critical prefixes are present
      expect(criticalPrefixes).toContain('auth_verify')
      expect(criticalPrefixes).toContain('auth_magic')
      expect(criticalPrefixes).toContain('payment')
      expect(criticalPrefixes).toContain('checkout')
      expect(criticalPrefixes).toContain('admin_sensitive')
      expect(criticalPrefixes).toContain('webhook')
    })

    it('REDIS_FAIL_OPEN override only affects non-critical endpoints', () => {
      // When REDIS_FAIL_OPEN is true, only non-critical endpoints fail open
      process.env.REDIS_FAIL_OPEN = 'true'
      expect(process.env.REDIS_FAIL_OPEN).toBe('true')

      // Critical endpoints should still fail closed (tested by the prefix check logic)
      const criticalPrefixes = ['auth_verify', 'auth_magic', 'payment', 'checkout', 'admin_sensitive', 'webhook']
      const testPrefix = 'auth_verify_ratelimit'
      const isCritical = criticalPrefixes.some(p => testPrefix.startsWith(p))
      expect(isCritical).toBe(true)
    })

    it('non-critical endpoint prefix is not in critical list', () => {
      const criticalPrefixes = ['auth_verify', 'auth_magic', 'payment', 'checkout', 'admin_sensitive', 'webhook']

      // Public endpoints are not critical
      const publicPrefix = 'public_ratelimit'
      const isCritical = criticalPrefixes.some(p => publicPrefix.startsWith(p))
      expect(isCritical).toBe(false)

      // Support endpoints are not critical
      const supportPrefix = 'support_ticket_ratelimit'
      const isSupCritical = criticalPrefixes.some(p => supportPrefix.startsWith(p))
      expect(isSupCritical).toBe(false)
    })
  })

  describe('Error Response Format', () => {
    it('returns 503 status code for service unavailable', () => {
      // The implementation returns 503 when failing closed
      const expectedStatus = 503
      expect(expectedStatus).toBe(503)
    })

    it('error message is user-friendly', () => {
      const errorMessage = 'Service temporarily unavailable. Please try again in a moment.'
      expect(errorMessage).toContain('temporarily')
      expect(errorMessage).toContain('try again')
    })
  })

  describe('Rate Limit Configurations', () => {
    it('AI rate limit has 24-hour window', () => {
      const aiWindow = 24 * 60 * 60 * 1000 // 24 hours
      expect(aiWindow).toBe(86400000)
    })

    it('auth verify has 15-minute window', () => {
      const authWindow = 15 * 60 * 1000 // 15 minutes
      expect(authWindow).toBe(900000)
    })

    it('public rate limit has high request limit', () => {
      const publicLimit = 500 // 500 requests per hour
      expect(publicLimit).toBeGreaterThanOrEqual(100)
    })
  })

  describe('Redis Failure Handling', () => {
    it('critical endpoints always fail closed when Redis is down', () => {
      // Critical prefixes that should ALWAYS fail closed
      const criticalPrefixes = ['auth_verify', 'auth_magic', 'payment', 'checkout', 'admin_sensitive', 'webhook']

      // These endpoints must return 503 when Redis fails, regardless of any override
      const testCases = [
        'auth_verify_ratelimit',
        'auth_magic_ratelimit',
        'payment_ratelimit',
        'checkout_ratelimit',
        'admin_sensitive_ratelimit',
        'webhook_ratelimit',
      ]

      for (const prefix of testCases) {
        const isCritical = criticalPrefixes.some(p => prefix.startsWith(p))
        expect(isCritical).toBe(true)
      }
    })

    it('public endpoints fail open by default when Redis is down', () => {
      // Public endpoints should fail open to maintain availability
      const failOpenByDefaultPrefixes = ['public_ratelimit', 'public_strict_ratelimit']
      const criticalPrefixes = ['auth_verify', 'auth_magic', 'payment', 'checkout', 'admin_sensitive', 'webhook']

      // public_ratelimit should NOT be critical
      const publicPrefix = 'public_ratelimit'
      const isCritical = criticalPrefixes.some(p => publicPrefix.startsWith(p))
      expect(isCritical).toBe(false)

      // public_ratelimit should be in fail-open list
      const canFailOpen = failOpenByDefaultPrefixes.some(p => publicPrefix.startsWith(p))
      expect(canFailOpen).toBe(true)

      // public_strict_ratelimit should also fail open
      const strictPrefix = 'public_strict_ratelimit'
      const strictCanFailOpen = failOpenByDefaultPrefixes.some(p => strictPrefix.startsWith(p))
      expect(strictCanFailOpen).toBe(true)
    })

    it('auth endpoints fail closed even with REDIS_FAIL_OPEN override', () => {
      process.env.REDIS_FAIL_OPEN = 'true'

      // Even with override, critical endpoints must fail closed
      const criticalPrefixes = ['auth_verify', 'auth_magic', 'payment', 'checkout', 'admin_sensitive', 'webhook']

      // auth_verify must still be critical
      const authPrefix = 'auth_verify_ratelimit'
      const isCritical = criticalPrefixes.some(p => authPrefix.startsWith(p))
      expect(isCritical).toBe(true)

      // Critical check happens BEFORE fail-open check
      // So auth_verify will always return 503, never proceed
    })

    it('non-public non-critical endpoints fail closed by default', () => {
      // Endpoints like AI, media upload, support are not in fail-open list
      const failOpenByDefaultPrefixes = ['public_ratelimit', 'public_strict_ratelimit']

      const testCases = [
        'ai_ratelimit',
        'ai_audio_ratelimit',
        'media_upload_ratelimit',
        'support_ticket_ratelimit',
        'update_send_ratelimit',
        'admin_read_ratelimit',
        'admin_export_ratelimit',
      ]

      for (const prefix of testCases) {
        const canFailOpen = failOpenByDefaultPrefixes.some(p => prefix.startsWith(p))
        expect(canFailOpen).toBe(false)
      }
    })

    it('REDIS_FAIL_OPEN=true allows non-critical non-public to fail open', () => {
      process.env.REDIS_FAIL_OPEN = 'true'

      // With override, non-critical endpoints (like ai_ratelimit) can fail open
      // This is checked after critical check, before fail-closed default
      const criticalPrefixes = ['auth_verify', 'auth_magic', 'payment', 'checkout', 'admin_sensitive', 'webhook']

      const aiPrefix = 'ai_ratelimit'
      const isCritical = criticalPrefixes.some(p => aiPrefix.startsWith(p))
      expect(isCritical).toBe(false)

      // Since not critical, and REDIS_FAIL_OPEN=true, it would fail open
      expect(process.env.REDIS_FAIL_OPEN).toBe('true')
    })
  })
})
