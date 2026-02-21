import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  generateCancelUrl,
  generateManageUrl,
  generatePortalUrl,
  generateExpressDashboardUrl,
  generateCancelToken,
  validateCancelToken,
  generateManageToken,
  validateManageToken,
} from '../../src/utils/cancelToken.js'
import { env } from '../../src/config/env.js'

describe('cancelToken URL generation', () => {
  const testSubscriptionId = '12345678-1234-1234-1234-123456789012'
  const testCustomerId = 'cus_test123'
  const testAccountId = 'acct_test123'

  describe('generateCancelUrl', () => {
    it('uses PUBLIC_PAGE_URL for subscriber-facing cancel links', () => {
      const url = generateCancelUrl(testSubscriptionId)
      expect(url).toContain(env.PUBLIC_PAGE_URL)
      expect(url).toContain('/unsubscribe/')
    })

    it('includes token in URL', () => {
      const url = generateCancelUrl(testSubscriptionId)
      const token = url.split('/unsubscribe/')[1]
      expect(token).toBeDefined()
      expect(token.length).toBeGreaterThan(10)
    })

    it('generates valid token that can be decoded', () => {
      const url = generateCancelUrl(testSubscriptionId)
      const token = url.split('/unsubscribe/')[1]
      const decoded = validateCancelToken(token)
      expect(decoded).not.toBeNull()
      expect(decoded?.subscriptionId).toBe(testSubscriptionId)
    })
  })

  describe('generateManageUrl', () => {
    it('uses PUBLIC_PAGE_URL for subscriber-facing manage links', () => {
      const url = generateManageUrl(testSubscriptionId)
      expect(url).toContain(env.PUBLIC_PAGE_URL)
      expect(url).toContain('/subscription/manage/')
    })

    it('includes token in URL', () => {
      const url = generateManageUrl(testSubscriptionId)
      const token = url.split('/subscription/manage/')[1]
      expect(token).toBeDefined()
      expect(token.length).toBeGreaterThan(10)
    })

    it('generates valid token that can be decoded', () => {
      const url = generateManageUrl(testSubscriptionId)
      const token = url.split('/subscription/manage/')[1]
      const decoded = validateManageToken(token)
      expect(decoded).not.toBeNull()
      expect(decoded?.subscriptionId).toBe(testSubscriptionId)
    })

    it('supports nonce for token revocation', () => {
      const nonce = 'test-nonce-123'
      const url = generateManageUrl(testSubscriptionId, nonce)
      const token = url.split('/subscription/manage/')[1]
      const decoded = validateManageToken(token)
      expect(decoded?.nonce).toBe(nonce)
    })
  })

  describe('generatePortalUrl', () => {
    it('uses PUBLIC_PAGE_URL for subscriber-facing portal links', () => {
      const url = generatePortalUrl(testCustomerId, testSubscriptionId)
      expect(url).toContain(env.PUBLIC_PAGE_URL)
      expect(url).toContain('/manage/')
    })

    it('includes token in URL', () => {
      const url = generatePortalUrl(testCustomerId, testSubscriptionId)
      const token = url.split('/manage/')[1]
      expect(token).toBeDefined()
      expect(token.length).toBeGreaterThan(10)
    })
  })

  describe('generateExpressDashboardUrl', () => {
    it('uses API_URL for creator-facing dashboard links (server-side redirect)', () => {
      const url = generateExpressDashboardUrl(testAccountId)
      expect(url).toContain(env.API_URL)
      expect(url).toContain('/my-subscriptions/express-dashboard/')
    })

    it('includes token in URL', () => {
      const url = generateExpressDashboardUrl(testAccountId)
      const token = url.split('/express-dashboard/')[1]
      expect(token).toBeDefined()
      expect(token.length).toBeGreaterThan(10)
    })
  })

  describe('URL domain consistency', () => {
    it('subscriber-facing URLs use PUBLIC_PAGE_URL', () => {
      const cancelUrl = generateCancelUrl(testSubscriptionId)
      const manageUrl = generateManageUrl(testSubscriptionId)
      const portalUrl = generatePortalUrl(testCustomerId, testSubscriptionId)

      // All subscriber-facing URLs should use PUBLIC_PAGE_URL
      expect(cancelUrl.startsWith(env.PUBLIC_PAGE_URL)).toBe(true)
      expect(manageUrl.startsWith(env.PUBLIC_PAGE_URL)).toBe(true)
      expect(portalUrl.startsWith(env.PUBLIC_PAGE_URL)).toBe(true)
    })

    it('creator-facing URLs use API_URL (server-side redirect)', () => {
      const dashboardUrl = generateExpressDashboardUrl(testAccountId)

      // Express dashboard URL hits the API directly (server-side Stripe redirect)
      expect(dashboardUrl.startsWith(env.API_URL)).toBe(true)
    })
  })
})

describe('cancelToken validation', () => {
  const testSubscriptionId = '12345678-1234-1234-1234-123456789012'

  describe('validateCancelToken', () => {
    it('returns null for invalid token', () => {
      expect(validateCancelToken('invalid')).toBeNull()
      expect(validateCancelToken('')).toBeNull()
      expect(validateCancelToken('abc123')).toBeNull()
    })

    it('returns null for malformed base64', () => {
      expect(validateCancelToken('!!!invalid-base64!!!')).toBeNull()
    })

    it('validates token signature', () => {
      const token = generateCancelToken(testSubscriptionId)
      const decoded = validateCancelToken(token)
      expect(decoded).not.toBeNull()
      expect(decoded?.subscriptionId).toBe(testSubscriptionId)
    })
  })

  describe('validateManageToken', () => {
    it('returns null for invalid token', () => {
      expect(validateManageToken('invalid')).toBeNull()
      expect(validateManageToken('')).toBeNull()
    })

    it('validates token with nonce', () => {
      const nonce = 'revocation-nonce'
      const token = generateManageToken(testSubscriptionId, nonce)
      const decoded = validateManageToken(token)
      expect(decoded).not.toBeNull()
      expect(decoded?.subscriptionId).toBe(testSubscriptionId)
      expect(decoded?.nonce).toBe(nonce)
    })

    it('validates token without nonce', () => {
      const token = generateManageToken(testSubscriptionId)
      const decoded = validateManageToken(token)
      expect(decoded).not.toBeNull()
      expect(decoded?.subscriptionId).toBe(testSubscriptionId)
      expect(decoded?.nonce).toBe('')
    })
  })
})
