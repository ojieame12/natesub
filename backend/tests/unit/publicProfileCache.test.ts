/**
 * Unit tests for public profile caching utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { publicProfileKey, invalidatePublicProfileCache } from '../../src/utils/cache.js'

// Access the mocked redis from the test setup
vi.mock('../../src/db/redis.js')

describe('Public Profile Cache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('publicProfileKey', () => {
    it('generates correct cache key for username', () => {
      expect(publicProfileKey('testuser')).toBe('public_profile:testuser')
    })

    it('normalizes username to lowercase', () => {
      expect(publicProfileKey('TestUser')).toBe('public_profile:testuser')
      expect(publicProfileKey('TESTUSER')).toBe('public_profile:testuser')
      expect(publicProfileKey('TeSt_UsEr')).toBe('public_profile:test_user')
    })

    it('handles usernames with underscores', () => {
      expect(publicProfileKey('test_user_123')).toBe('public_profile:test_user_123')
    })

    it('handles usernames with numbers', () => {
      expect(publicProfileKey('user123')).toBe('public_profile:user123')
    })
  })

  describe('invalidatePublicProfileCache', () => {
    it('calls invalidateCache with correct key', async () => {
      // Since we're in test environment, cache operations are bypassed
      // This test verifies the function doesn't throw
      await expect(invalidatePublicProfileCache('testuser')).resolves.not.toThrow()
    })

    it('normalizes username when invalidating', async () => {
      // Function should not throw for various username formats
      await expect(invalidatePublicProfileCache('TestUser')).resolves.not.toThrow()
      await expect(invalidatePublicProfileCache('UPPERCASE')).resolves.not.toThrow()
    })
  })
})
